const express = require('express');
const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 7347;
const upload = multer();

app.use(express.json()); // Middleware to parse JSON request bodies

// Serve static files from the 'v2' directory
app.use(express.static(path.join(__dirname)));

// --- Crypto Functions for server-side decryption ---

// Helper function to convert base64 to a Buffer
function base64ToBuffer(base64) {
    return Buffer.from(base64, 'base64');
}

// Derives a key from a user ID using PBKDF2.
function getKey(userId, salt) {
    return new Promise((resolve, reject) => {
        const enc = new TextEncoder(); // Use TextEncoder for consistency
        const userIdBuffer = enc.encode(userId); // Encode userId to a Buffer
        crypto.pbkdf2(userIdBuffer, salt, 100000, 32, 'sha256', (err, derivedKey) => {
            if (err) reject(err);
            resolve(derivedKey);
        });
    });
}

// Decrypts the string back into an object.
async function decryptSettings(encryptedString, userId) {
    try {
        const { salt: saltB64, iv: ivB64, content: contentB64 } = JSON.parse(encryptedString);

        const salt = base64ToBuffer(saltB64);
        const iv = base64ToBuffer(ivB64);
        const encryptedContent = base64ToBuffer(contentB64);

        const key = await getKey(userId, salt);

        // The encrypted content from the browser includes the auth tag, so we need to separate it.
        const tagLength = 16; // AES-GCM auth tag is 128 bits (16 bytes)
        const ciphertext = encryptedContent.slice(0, -tagLength);
        const authTag = encryptedContent.slice(-tagLength);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
        decrypted += decipher.final('utf8');

        let credentials = JSON.parse(decrypted);

        credentials.region = credentials.region || credentials.s3Region;
        credentials.bucket = credentials.bucket || credentials.s3Bucket;
        credentials.endpoint = credentials.endpoint || credentials.s3Endpoint;
        credentials.subfolder = credentials.subfolder || credentials.s3Subfolder;

        return credentials;
    } catch (error) {
        console.error('Server-side decryption failed:', error);
        return null;
    }
}

// --- S3 Functions (Copied from client-side) ---
const getS3Client = (creds) => {
    return new S3Client({
        region: creds.region || 'us-east-1',
        endpoint: creds.endpoint,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
        },
        forcePathStyle: !!creds.endpoint, 
    });
};

const getS3ObjectKey = (noteId, creds) => {
    const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
    return `${path}${noteId}.json`;
}

const uploadNoteToS3 = async (note, creds) => {
    const s3Client = getS3Client(creds);
    const noteJson = JSON.stringify(note, null, 2);
    
    const command = new PutObjectCommand({
        Bucket: creds.bucket,
        Key: getS3ObjectKey(note.id, creds),
        Body: noteJson,
        ContentType: 'application/json',
    });

    try {
        const response = await s3Client.send(command);
        return response;
    } catch (error) {
        console.error(`S3 Upload Error for note ${note.id}:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to upload to S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 upload.');
    }
};

const listNotesInS3 = async (creds) => {
    const s3Client = getS3Client(creds);
    const prefix = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
    const command = new ListObjectsV2Command({
        Bucket: creds.bucket,
        Prefix: prefix
    });

    try {
        const response = await s3Client.send(command);
        const noteIds = response.Contents?.map(item => {
            if (!item.Key) return null;
            if (item.Key.endsWith('/')) return null; 
            return item.Key.replace(prefix, '').replace('.json', '');
        }).filter(id => !!id); 
        return noteIds || [];
    } catch (error) {
        console.error("S3 List Error:", error);
        if (error instanceof Error) {
            throw new Error(`Failed to list notes in S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 list operation.');
    }
};

const downloadNoteFromS3 = async (noteId, creds) => {
    const s3Client = getS3Client(creds);
    const key = getS3ObjectKey(noteId, creds);
    const command = new GetObjectCommand({
        Bucket: creds.bucket,
        Key: key,
    });

    try {
        const response = await s3Client.send(command);
        if (response.Body) {
            const str = await response.Body.transformToString();
            return JSON.parse(str);
        }
        throw new Error('Downloaded note has no body');
    } catch (error) {
        console.error(`S3 Download Error for note ${noteId}:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to download note from S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 download.');
    }
};

const deleteNoteFromS3 = async (noteId, creds) => {
    const s3Client = getS3Client(creds);
    const key = getS3ObjectKey(noteId, creds);
    const command = new DeleteObjectCommand({
        Bucket: creds.bucket,
        Key: key,
    });

    try {
        const response = await s3Client.send(command);

        if (response.ok) {
            console.log(`S3 Deleted note ${noteId}:`, await response.json());
        }

        return response;
    } catch (error) {
        console.error(`S3 Delete Error for note ${noteId}:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to delete note from S3: ${error.name} - ${error.message}`);
        }
        throw new Error('An unknown error occurred during S3 delete.');
    }
};

// Route for the main application page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle shared content from PWA
app.post('/_share-target', upload.none(), (req, res) => {
    // The service worker will handle this, but we have a server-side route as a fallback.
    // In a real app, you might save this to a temporary session or user-specific store.
    console.log('Shared content received on server:', req.body);
    res.redirect('/');
});

// --- API Endpoints ---
app.post('/api/sync-notes', async (req, res) => {
    let { encryptedSettings, userId, localNotes, deletedNoteIds, lastSync } = req.body;

    userId = userId || 'null'; // Debug for localhost

    if (!encryptedSettings || !userId || !localNotes) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const credentials = await decryptSettings(encryptedSettings, userId);

        if (!credentials || !credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
            return res.status(400).json({ error: 'Invalid or incomplete S3 credentials.' });
        }

        const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
        const remoteNoteIds = await listNotesInS3(credentials);
        
        let uploadedCount = 0;
        let downloadedCount = 0;
        let deletedCount = 0;
        let updatedNotes = [];

        // Delete notes from S3 that were deleted locally
        if (deletedNoteIds && deletedNoteIds.length > 0) {
            for (const noteId of deletedNoteIds) {
                await deleteNoteFromS3(noteId, credentials);
                deletedCount++;
            }
        }
        
        // Upload local notes that are new or updated
        for (const localNote of localNotes) {
            await uploadNoteToS3(localNote, credentials);
            uploadedCount++;
        }

        // Download remote notes that are new or updated
        for (const noteId of remoteNoteIds) {
            if (deletedNoteIds && deletedNoteIds.includes(noteId)) {
                continue; // Skip notes that were just deleted
            }
            const localNote = localNotesMap.get(noteId);
            const remoteNote = await downloadNoteFromS3(noteId, credentials);
            if (remoteNote) {
                if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
                    if (!lastSync || new Date(remoteNote.updatedAt) > new Date(lastSync)) {
                        updatedNotes.push(remoteNote);
                        downloadedCount++;
                    }
                }
            }
        }

        res.json({ success: true, uploadedCount, downloadedCount, deletedCount, updatedNotes });

    } catch (error) {
        console.error('Server-side sync error:', error);
        let errorMessage = 'An unknown error occurred during sync.';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: errorMessage });
    }
});

app.post('/api/delete-note', async (req, res) => {
    let { encryptedSettings, userId, noteId } = req.body;

    userId = userId || 'null'; // Debug for localhost

    if (!encryptedSettings || !userId || !noteId) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const credentials = await decryptSettings(encryptedSettings, userId);

        if (!credentials || !credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
            return res.status(400).json({ error: 'Invalid or incomplete S3 credentials.' });
        }

        await deleteNoteFromS3(noteId, credentials);

        res.json({ success: true, message: `Note ${noteId} deleted from S3.` });

    } catch (error) {
        console.error('Server-side delete error:', error);
        let errorMessage = 'An unknown error occurred during deletion.';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        res.status(500).json({ error: errorMessage });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
