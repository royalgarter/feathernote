require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const multer = require('multer');
const { marked } = require('marked');
const openKv = (process.env.PUBLISH_USE_DENOKV === 'true') ? require('@deno/kv').openKv : null;

const getAppVersion = async () => {
    try {
        const hash = crypto.createHash('sha1');
        const keyFiles = ['index.html', 'index.js', 'helpers.js', 'serviceworker.js', 'manifest.json'];
        
        for (const fileName of keyFiles) {
            const filePath = path.join(__dirname, fileName);
            const content = await fs.promises.readFile(filePath);
            hash.update(content);
        }
        
        return hash.digest('hex').slice(0, 7);
    } catch (error) {
        console.error('Failed to generate version hash:', error);
        return 'unknown';
    }
};

let appVersion;
(async () => {
    appVersion = await getAppVersion();

    if (process.argv[2] === '--version') {
        console.log(appVersion);
        process.exit(0);
    }

    console.log(`App Version: ${appVersion}`);
})();

const app = express();
const port = process.env.PORT || 7347;
const upload = multer();
const DENO_KV_SIZE_LIMIT = 65536;

// Create a directory for published notes if it doesn't exist
const publishedNotesDir = path.join(__dirname, 'published_notes');
if (!fs.existsSync(publishedNotesDir)) {
    fs.mkdirSync(publishedNotesDir);
}

app.use(express.json()); // Middleware to parse JSON request bodies

app.get('/api/proxy', async (req, res) => {
    const urlToFetch = req.query.url;
    if (!urlToFetch) {
        return res.status(400).json({ error: 'URL parameter is required.' });
    }

    try {
        // Use the built-in fetch in modern Node.js
        const response = await fetch(urlToFetch, {
            headers: { 'User-Agent': 'FeatherNote/1.0' } // Set a user-agent
        });

        if (!response.ok) {
            // Forward the status and statusText from the target server
            return res.status(response.status).send(response.statusText);
        }

        const html = await response.text();
        res.send(html);
    } catch (error) {
        console.error(`Proxy error for ${urlToFetch}:`, error);
        res.status(500).json({ error: 'Failed to fetch the URL through proxy.' });
    }
});

// Serve static files from the 'src' directory
app.use(express.static(path.join(__dirname)));

// --- Share/Publish Endpoints ---

app.post('/api/publish', async (req, res) => {
    const { title, content } = req.body;
    if (!content) {
        return res.status(400).json({ error: 'Content cannot be empty.' });
    }

    const noteId = crypto.randomBytes(8).toString('hex');
    const noteData = { title: title || 'Untitled Note', content };
    const noteString = JSON.stringify(noteData);
    const noteSize = new TextEncoder().encode(noteString).length;

    try {
        // Prioritize Deno KV if enabled and the note is within the size limit
        if (process.env.PUBLISH_USE_DENOKV === 'true' && noteSize <= DENO_KV_SIZE_LIMIT) {
            if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
                throw new Error('Deno KV environment variables are not set.');
            }
            const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
            await kv.set(['published_notes', noteId], noteData);
        } else {
            // Fallback to filesystem for large notes or if Deno KV is not configured
            const filePath = path.join(publishedNotesDir, `${noteId}.json`);
            fs.writeFileSync(filePath, noteString);
        }
        res.json({ url: `/publish/${noteId}` });
    } catch (err) {
        console.error('Failed to save note:', err);
        res.status(500).json({ error: 'Failed to save note.' });
    }
});

app.get('/publish/:noteId', async (req, res) => {
    const { noteId } = req.params;
    if (!/^[a-f0-9]{16}$/.test(noteId)) {
        return res.status(400).send('Invalid note ID format.');
    }

    try {
        let note = null;

        // First, try to fetch from Deno KV if it's enabled
        if (process.env.PUBLISH_USE_DENOKV === 'true') {
            if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
                throw new Error('Deno KV environment variables are not set.');
            }
            const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
            const result = await kv.get(['published_notes', noteId]);
            if (result.value) {
                note = result.value;
            }
        }

        // If not found in Deno KV, or if Deno KV is not enabled, try the filesystem
        if (!note) {
            const filePath = path.join(publishedNotesDir, `${noteId}.json`);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                note = JSON.parse(data);
            }
        }

        // If note is still not found, return 404
        if (!note) {
            return res.status(404).send('Note not found.');
        }

        const htmlContent = marked.parse(note.content);
        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${note.title}</title>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
                <style>
                    body { padding: 2rem; }
                    article { white-space: pre-wrap; }
                </style>
            </head>
            <body>
                <main class="container">
                    <h1>${note.title}</h1>
                    <article>
                        ${htmlContent}
                    </article>
                </main>
            </body>
            </html>
        `;
        res.send(html);
    } catch (err) {
        console.error('Failed to retrieve note:', err);
        res.status(500).send('Failed to retrieve note.');
    }
});

app.get('/about', (req, res) => {
    const readmePath = path.join(__dirname, '..', 'README.md');
    fs.readFile(readmePath, 'utf8', (err, markdown) => {
        if (err) {
            console.error('Failed to read README.md:', err);
            return res.status(500).send('Could not load about page.');
        }
        const htmlContent = marked.parse(markdown);
        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>About FeatherNote</title>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
                <style>
                    body { padding: 2rem; }
                    main.container { max-width: 960px; }
                    article img { max-width: 100%; }
                </style>
            </head>
            <body>
                <main class="container">
                    <article>
                        ${htmlContent}
                    </article>
                </main>
            </body>
            </html>
        `;
        res.send(html);
    });
});


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
    let allNoteMetadata = [];
    let continuationToken = undefined;

    do {
        const command = new ListObjectsV2Command({
            Bucket: creds.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        });

        try {
            const response = await s3Client.send(command);
            const noteMetadata = response.Contents?.map(item => {
                if (!item.Key || item.Key.endsWith('/')) return null;
                return {
                    id: item.Key.replace(prefix, '').replace('.json', ''),
                    lastModified: item.LastModified // S3's LastModified timestamp
                };
            }).filter(item => !!item) || [];
            
            allNoteMetadata = allNoteMetadata.concat(noteMetadata);
            continuationToken = response.NextContinuationToken;
        } catch (error) {
            console.error("S3 List Error:", error);
            if (error instanceof Error) {
                throw new Error(`Failed to list notes in S3: ${error.name} - ${error.message}`);
            }
            throw new Error('An unknown error occurred during S3 list operation.');
        }
    } while (continuationToken);

    return allNoteMetadata;
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

        console.log(`S3 Deleted note ${noteId}:`, response);

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
app.post('/share', upload.none(), (req, res) => {
    // The service worker will handle this, but we have a server-side route as a fallback.
    // In a real app, you might save this to a temporary session or user-specific store.
    console.log('Shared content received on server:', req.body);
    res.redirect('/');
});

// --- API Endpoints ---
app.post('/api/sync-notes', async (req, res) => {
    return res.status(400).json({ error: 'This route is deprecated. Using the client-side S3 instead.'});

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
        const remoteNoteMetadata = await listNotesInS3(credentials);
        const remoteNoteIdsSet = new Set(remoteNoteMetadata.map(item => item.id)); // For client-side deletion check
        
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
        for (const remoteMeta of remoteNoteMetadata) {
            const noteId = remoteMeta.id;
            const s3LastModified = new Date(remoteMeta.lastModified); // Convert to Date object

            if (deletedNoteIds && deletedNoteIds.includes(noteId)) {
                continue; // Skip notes that were just deleted
            }

            // Only download if the S3 object is newer than the client's last sync
            if (!lastSync || s3LastModified > new Date(lastSync)) {
                const localNote = localNotesMap.get(noteId);
                const remoteNote = await downloadNoteFromS3(noteId, credentials);
                if (remoteNote) {
                    // Also check the note's internal updatedAt, in case S3 LastModified is not perfectly aligned
                    if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
                        updatedNotes.push(remoteNote);
                        downloadedCount++;
                    }
                }
            }
        }

        res.json({ success: true, uploadedCount, downloadedCount, deletedCount, updatedNotes, remoteNoteIds: Array.from(remoteNoteIdsSet) });

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
    return res.status(400).json({ error: 'This route is deprecated. Using the client-side S3 instead.'});

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

app.get('/api/version', (req, res) => {
    res.json({ version: appVersion || 'unknown' });
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
