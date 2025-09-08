document.addEventListener('alpine:init', () => {
    // Helper function to convert buffer to base64
    function bufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    // Helper function to convert base64 to buffer
    function base64ToBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Derives a key from a user ID using PBKDF2. This is more secure than using the ID directly.
    async function getKey(userId, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(userId),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        return window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Encrypts a JSON-stringifiable object.
    async function encryptSettings(settings, userId) {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const key = await getKey(userId, salt);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encodedSettings = enc.encode(JSON.stringify(settings));

        const encryptedContent = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            key,
            encodedSettings
        );

        const encryptedPackage = {
            salt: bufferToBase64(salt),
            iv: bufferToBase64(iv),
            content: bufferToBase64(encryptedContent)
        };

        console.log('encrypt', settings, encryptedPackage);
        
        return JSON.stringify(encryptedPackage);
    }

    // Decrypts the string back into an object.
    async function decryptSettings(encryptedString, userId) {
        try {
            const { salt: saltB64, iv: ivB64, content: contentB64 } = JSON.parse(encryptedString);

            const salt = base64ToBuffer(saltB64);
            const iv = base64ToBuffer(ivB64);
            const content = base64ToBuffer(contentB64);
            
            const key = await getKey(userId, salt);

            const decryptedContent = await window.crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                },
                key,
                content
            );

            const dec = new TextDecoder();

            const credentials = JSON.parse(dec.decode(decryptedContent));

            credentials.region = credentials.region || credentials.s3Region;
            credentials.bucket = credentials.bucket || credentials.s3Bucket;
            credentials.endpoint = credentials.endpoint || credentials.s3Endpoint;
            credentials.subfolder = credentials.subfolder || credentials.s3Subfolder;

            // console.log('decrypt', credentials);

            return credentials;
        } catch (error) {
            console.error('Decryption failed:', error);
            return null;
        }
    }

    // --- S3 Functions (Client-side AWS SDK v2) ---
    const getS3ClientV2 = (creds) => {
        // AWS.config.update is generally not recommended for client-side in a single-page app
        // as it's global. Instead, pass credentials directly to the S3 constructor.
        return new AWS.S3({
            region: creds.region || 'us-east-1',
            endpoint: creds.endpoint,
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            s3ForcePathStyle: !!creds.endpoint, // Required for custom endpoints like R2
        });
    };

    const getS3ObjectKey = (noteId, creds) => {
        const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
        return `${path}${noteId}.json`;
    };

    const uploadNoteToS3V2 = async (note, creds) => {
        const s3 = getS3ClientV2(creds);
        const noteJson = JSON.stringify(note, null, 2);

        const params = {
            Bucket: creds.bucket,
            Key: getS3ObjectKey(note.id, creds),
            Body: noteJson,
            ContentType: 'application/json',
        };

        return new Promise((resolve, reject) => {
            s3.upload(params, (err, data) => {
                if (err) {
                    console.error(`S3 Upload Error for note ${note.id}:`, err);
                    reject(new Error(`Failed to upload to S3: ${err.code} - ${err.message}`));
                } else {
                    resolve(data);
                }
            });
        });
    };

    const listNotesInS3V2 = async (creds) => {
        const s3 = getS3ClientV2(creds);
        const prefix = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
        const params = {
            Bucket: creds.bucket,
            Prefix: prefix,
        };

        return new Promise((resolve, reject) => {
            s3.listObjectsV2(params, (err, data) => {
                if (err) {
                    console.error("S3 List Error:", err);
                    reject(new Error(`Failed to list notes in S3: ${err.code} - ${err.message}`));
                } else {
                    const noteMetadata = data.Contents?.map(item => {
                        if (!item.Key || item.Key.endsWith('/')) return null;
                        return {
                            id: item.Key.replace(prefix, '').replace('.json', ''),
                            lastModified: item.LastModified // S3's LastModified timestamp
                        };
                    }).filter(item => !!item) || [];
                    resolve(noteMetadata);
                }
            });
        });
    };

    const downloadNoteFromS3V2 = async (noteId, creds) => {
        const s3 = getS3ClientV2(creds);
        const key = getS3ObjectKey(noteId, creds);
        const params = {
            Bucket: creds.bucket,
            Key: key,
        };

        return new Promise((resolve, reject) => {
            s3.getObject(params, (err, data) => {
                if (err) {
                    console.error(`S3 Download Error for note ${noteId}:`, err);
                    reject(new Error(`Failed to download note from S3: ${err.code} - ${err.message}`));
                } else {
                    if (data.Body) {
                        // AWS SDK v2 returns Body as a Buffer in Node.js, but a Blob/Uint8Array in browser
                        // For browser, we need to convert it to text
                        const str = new TextDecoder().decode(data.Body);
                        resolve(JSON.parse(str));
                    } else {
                        reject(new Error('Downloaded note has no body'));
                    }
                }
            });
        });
    };

    const deleteNoteFromS3V2 = async (noteId, creds) => {
        const s3 = getS3ClientV2(creds);
        const key = getS3ObjectKey(noteId, creds);
        const params = {
            Bucket: creds.bucket,
            Key: key,
        };

        return new Promise((resolve, reject) => {
            s3.deleteObject(params, (err, data) => {
                if (err) {
                    console.error(`S3 Delete Error for note ${noteId}:`, err);
                    reject(new Error(`Failed to delete note from S3: ${err.code} - ${err.message}`));
                } else {
                    console.log(`S3 Deleted note ${noteId}:`, data);
                    resolve(data);
                }
            });
        });
    };

    // --- New API Functions (Client-side) ---
    async function apiSyncNotes(encryptedSettings, userId, localNotes, deletedNoteIds, lastSync) {
        try {
            const credentials = await decryptSettings(encryptedSettings, userId);

            if (!credentials || !credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
                return { success: false, error: 'Invalid or incomplete S3 credentials.' };
            }

            const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
            
            // Step 1: Handle local deletions. These take precedence.
            let deletedCount = 0;
            if (deletedNoteIds && deletedNoteIds.length > 0) {
                const deletePromises = deletedNoteIds.map(noteId => deleteNoteFromS3V2(noteId, credentials));
                await Promise.all(deletePromises);
                deletedCount = deletedNoteIds.length;
            }

            // Step 2: Get remote state
            const remoteNoteMetadata = await listNotesInS3V2(credentials);
            const remoteNoteMetaMap = new Map(remoteNoteMetadata.map(m => [m.id, m]));

            const notesToUpload = [];
            const notesToDownload = [];

            const allNoteIds = new Set([...localNotesMap.keys(), ...remoteNoteMetaMap.keys()]);

            // Step 3: Compare local and remote states to build upload/download queues
            for (const noteId of allNoteIds) {
                if (deletedNoteIds && deletedNoteIds.includes(noteId)) {
                    continue; // Already processed as a deletion
                }

                const localNote = localNotesMap.get(noteId);
                const remoteMeta = remoteNoteMetaMap.get(noteId);

                if (localNote && !remoteMeta) {
                    // Note exists only locally, so upload it.
                    notesToUpload.push(localNote);
                } else if (!localNote && remoteMeta) {
                    // Note exists only remotely, so download it.
                    notesToDownload.push(noteId);
                } else if (localNote && remoteMeta) {
                    // Note exists in both. Conflict resolution time.
                    const localDate = new Date(localNote.updatedAt);
                    const remoteDate = new Date(remoteMeta.lastModified);

                    // Use a 2-second buffer to avoid sync loops due to small clock differences.
                    if (localDate.getTime() > remoteDate.getTime() + 2000) {
                        notesToUpload.push(localNote);
                    } else if (remoteDate.getTime() > localDate.getTime() + 2000) {
                        notesToDownload.push(noteId);
                    }
                }
            }

            // Step 4: Execute downloads
            const downloadedNotes = [];
            if (notesToDownload.length > 0) {
                const downloadPromises = notesToDownload.map(async (noteId) => {
                    const remoteNote = await downloadNoteFromS3V2(noteId, credentials);
                    if (remoteNote) {
                        // Final check on internal timestamp before accepting
                        const localNote = localNotesMap.get(noteId);
                        if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
                            downloadedNotes.push(remoteNote);
                        }
                    }
                });
                await Promise.all(downloadPromises);
            }
            
            // Step 5: Execute uploads
            if (notesToUpload.length > 0) {
                const uploadPromises = notesToUpload.map(note => uploadNoteToS3V2(note, credentials));
                await Promise.all(uploadPromises);
            }

            return {
                success: true,
                uploadedCount: notesToUpload.length,
                downloadedCount: downloadedNotes.length,
                deletedCount,
                updatedNotes: downloadedNotes,
                remoteNoteIds: Array.from(remoteNoteMetaMap.keys())
            };

        } catch (error) {
            console.error('Client-side sync error:', error);
            let errorMessage = 'An unknown error occurred during sync.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            return { success: false, error: errorMessage };
        }
    }

    async function apiDeleteNote(encryptedSettings, userId, noteId) {
        try {
            const credentials = await decryptSettings(encryptedSettings, userId);

            if (!credentials || !credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
                return { success: false, error: 'Invalid or incomplete S3 credentials.' };
            }

            await deleteNoteFromS3V2(noteId, credentials);

            return { success: true, message: `Note ${noteId} deleted from S3.` };

        } catch (error) {
            console.error('Client-side delete error:', error);
            let errorMessage = 'An unknown error occurred during deletion.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            return { success: false, error: errorMessage };
        }
    }

    // --- JWT Verification ---
    // Simple JWT Decoder
    function jwtDecode(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            console.error("Error decoding JWT payload:", e);
            return null;
        }
    }

    // Function to verify the signature of a Google ID token
    async function verifyGoogleJwt(token, clientId) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                throw new Error("Invalid JWT: The token must have 3 parts.");
            }
            const [headerB64, payloadB64, signatureB64] = parts;
            const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
            const payload = jwtDecode(token);

            // Step 1: Verify issuer
            if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
                throw new Error(`Invalid issuer: ${payload.iss}`);
            }

            // Step 2: Verify audience
            if (payload.aud !== clientId) {
                throw new Error("Invalid audience.");
            }

            // Step 3: Verify expiration time
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) {
                throw new Error("Token has expired.");
            }

            // Step 4: Fetch Google's public keys
            const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
            if (!response.ok) {
                throw new Error("Failed to fetch Google's public keys.");
            }
            const certs = await response.json();
            const jwk = certs.keys.find(key => key.kid === header.kid);

            if (!jwk) {
                throw new Error("No matching public key found for the token's kid.");
            }

            // Step 5: Import the public key
            const key = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );

            // Step 6: Verify the signature
            const encoder = new TextEncoder();
            const data = encoder.encode(`${headerB64}.${payloadB64}`);
            const signature = base64ToBuffer(signatureB64.replace(/-/g, '+').replace(/_/g, '/'));

            const isValid = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                key,
                signature,
                data
            );

            return isValid ? payload : null;

        } catch (error) {
            console.error("JWT verification failed:", error);
            return null;
        }
    }

    // IndexedDB Functions
    const DB_NAME = 'FeatherNoteDB';
    const DB_VERSION = 2;
    const NOTE_STORE = 'notes';
    const SHARED_CONTENT_STORE = 'shared-content';

    let dbPromise;

    const initDB = () => {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            console.log('Attempting to open IndexedDB...');
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('Error opening database:', event.target.error);
                dbPromise = null; // Reset promise on error
                reject('Error opening database');
            };

            request.onsuccess = (event) => {
                console.log('IndexedDB opened successfully.');
                resolve(event.target.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('IndexedDB upgrade needed. Creating object stores...');
                if (!db.objectStoreNames.contains(NOTE_STORE)) {
                    db.createObjectStore(NOTE_STORE, { keyPath: 'id' });
                    console.log(`Object store '${NOTE_STORE}' created.`);
                }
                if (!db.objectStoreNames.contains(SHARED_CONTENT_STORE)) {
                    db.createObjectStore(SHARED_CONTENT_STORE, { keyPath: 'id', autoIncrement: true });
                    console.log(`Object store '${SHARED_CONTENT_STORE}' created.`);
                }

                if (event.oldVersion < 2) {
                    const transaction = event.target.transaction;
                    const noteStore = transaction.objectStore(NOTE_STORE);
                    noteStore.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const note = cursor.value;
                            if (!note.tags) {
                                note.tags = [];
                            }
                            cursor.update(note);
                            cursor.continue();
                        }
                    };
                }
            };
        });
        return dbPromise;
    };

    const getNotesDB = async () => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NOTE_STORE], 'readonly');
            const store = transaction.objectStore(NOTE_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error('Error fetching notes from DB:', event.target.error);
                reject('Error fetching notes');
            };
        });
    };

    const getNoteDB = async (id) => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction([NOTE_STORE], 'readonly');
                const store = transaction.objectStore(NOTE_STORE);
                const request = store.get(id);

                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = (event) => {
                    console.error('Error fetching note from DB:', event.target.error);
                    reject('Error fetching note');
                };
            } catch (ex) {
                reject(ex);
            }
        });
    };

    const addNoteDB = async (note) => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NOTE_STORE], 'readwrite');
            const store = transaction.objectStore(NOTE_STORE);
            const request = store.add(note);

            request.onsuccess = () => {
                resolve(note);
            };
            request.onerror = (event) => {
                console.error('Error adding note to DB:', event.target.error);
                reject('Error adding note');
            };
        });
    };

    const updateNoteDB = async (note) => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NOTE_STORE], 'readwrite');
            const store = transaction.objectStore(NOTE_STORE);
            const request = store.put(note);

            request.onsuccess = () => {
                resolve(note);
            };
            request.onerror = (event) => {
                console.error('Update note error in DB:', event.target.error);
                reject('Error updating note');
            };
        });
    };

    const deleteNoteDB = async (id) => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NOTE_STORE], 'readwrite');
            const store = transaction.objectStore(NOTE_STORE);
            const request = store.delete(id);

            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => {
                console.error('Error deleting note from DB:', event.target.error);
                reject('Error deleting note');
            };
        });
    };

    const getSharedContentDB = async () => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([SHARED_CONTENT_STORE], 'readonly');
            const store = transaction.objectStore(SHARED_CONTENT_STORE);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error('Error fetching shared content from DB:', event.target.error);
                reject('Error fetching shared content');
            };
        });
    };

    const clearSharedContentDB = async () => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([SHARED_CONTENT_STORE], 'readwrite');
            const store = transaction.objectStore(SHARED_CONTENT_STORE);
            const request = store.clear();
        
            request.onsuccess = () => {
                resolve();
            };
            request.onerror = (event) => {
                console.error('Error clearing shared content from DB:', event.target.error);
                reject('Error clearing shared content');
            };
        });
    };

    Alpine.data('mainApp', () => ({
        // --- App Data ---
        toasts: [],
        toastIdCounter: 0,

        // --- Auth Data ---
        user: null,
        isGsiLoaded: false,
        GOOGLE_CLIENT_ID: "547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com",

        // --- Note Manager Data ---
        notes: [],
        searchTag: '',
        suggestions: [], // New property
        loading: true,
        miniSearch: null,
        isSyncing: false,
        syncIntervalId: null,
        editingNoteId: null, // New state to track which note is being edited
        deletedNoteIds: [],
        lastSync: null,

        // --- Note Editor Data ---
        noteEditorNoteId: null,
        noteEditorTitle: '',
        noteEditorContent: '',
        noteEditorTags: '',
        noteEditorReminder: '',

        // --- Notification Data ---
        notificationsEnabled: false,
        notificationPermissionStatus: 'default',
        scheduledNotifications: {},

        get filteredNotes() {
            if (!this.searchTag.trim()) {
                return this.notes;
            }
            // Use minisearch for filtering
            const searchResults = this.miniSearch ? this.miniSearch.search(this.searchTag, {
                prefix: true, // Search for prefixes
                fuzzy: 0.2, // Allow some fuzziness
                combineWith: 'AND' // All terms must match
            }) : this.notes.filter(x => x.tags.includes(this.searchTag) || x.title.includes(this.searchTag));
            // minisearch returns an array of objects with 'id' and other stored fields.
            // We need to return the original note objects, so map them back.
            const resultIds = new Set(searchResults.map(result => result.id));
            return this.notes.filter(note => resultIds.has(note.id));
        },


        // --- Main App Init ---
        init() {
            // App Init
            this.$nextTick(() => {
                this.processSharedContent();
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.processSharedContent();
                }
            });

            // Notifications Init
            this.initNotifications();

            // Register Service Worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/serviceworker.js')
                    .then(registration => {
                        console.log('Service Worker registered with scope:', registration.scope);
                    })
                    .catch(error => {
                        console.error('Service Worker registration failed:', error);
                    });
            }

            // Auth Init
            const storedUser = localStorage.getItem('feathernote-user');
            if (storedUser) {
                this.user = JSON.parse(storedUser);
            }

            // Only append GSI script if it's not already in the DOM
            if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.defer = true;
                script.onload = () => {
                    this.isGsiLoaded = true;
                };
                document.body.appendChild(script);
            }

            // Note Manager Init
            const lastSync = localStorage.getItem('feathernote-lastSync');
            if (lastSync) {
                this.lastSync = lastSync;
            }
            this.miniSearch = window.MiniSearch ? new MiniSearch({
                fields: ['title', 'content', 'tags'], // Fields to search!
                storeFields: ['id', 'title', 'content', 'createdAt', 'updatedAt', 'reminder', 'tags'] // Fields to return
            }) : null;
            this.fetchNotes();
            this.syncNotes();
            this.syncIntervalId = setInterval(() => {
                this.syncNotes(true); // Run a silent sync
            }, 2 * 60 * 1000); // Every 2 minutes

            this.$watch('notes', (newNotes) => {
                this.updateAppBadge();
                this.miniSearch?.removeAll();
                this.miniSearch?.addAll(newNotes);
            });
            this.$watch('searchTag', () => this.generateSuggestions());

            // this.$watch('$el', (el) => {
            //     if (!el) {
            //         clearInterval(this.syncIntervalId);
            //     }
            // });

            if (window.location.hash === '#new_note') {
                this.createNewNote();
            } else if (window.location.hash === '#search') {
                this.$nextTick(() => document.getElementById('searchInput')?.focus());
            }
        },

        // --- App Methods ---
        formatDate(isoString) {
            return new Date(isoString).toLocaleString();
        },
        getNotePreview(content) {
            return content ? `${content.substring(0, 200)}...` : 'No content preview';
        },

        showToast({ title, description, variant = 'default', duration = 3000 }) {
            const id = `toast-${this.toastIdCounter++}`;
            const newToast = { id, title, description, variant, show: true };
            this.toasts.push(newToast);

            console.log(description);

            setTimeout(() => {
                this.dismissToast(id);
            }, duration);
        },

        dismissToast(id) {
            this.toasts = this.toasts.map(toast =>
                toast.id === id ? { ...toast, show: false } : toast
            );
            setTimeout(() => {
                this.toasts = this.toasts.filter(toast => toast.id !== id);
            }, 300);
        },

        // --- Auth Methods ---
        async handleCredentialResponse(response) {
            try {
                const decoded = await verifyGoogleJwt(response.credential, this.GOOGLE_CLIENT_ID);

                if (!decoded) {
                    throw new Error("Invalid JWT signature or claims.");
                }

                const newUser = {
                    id: decoded.sub,
                    name: decoded.name,
                    email: decoded.email,
                    picture: decoded.picture,
                };
                this.user = newUser;
                localStorage.setItem('feathernote-user', JSON.stringify(newUser));
                localStorage.setItem('feathernote-has-logged-in', 'true');
                this.showToast({ title: 'Signed In', description: `Welcome, ${newUser.name}!` });
            } catch (error) {
                console.error("Error processing credential:", error);
                this.showToast({ variant: 'error', title: 'Sign In Failed', description: 'Could not verify Google credential. ' + error.message });
            }
        },

        initializeGoogleOneTap() {
            if (window.google && window.google.accounts) {
                window.google.accounts.id.initialize({
                    client_id: this.GOOGLE_CLIENT_ID,
                    callback: (response) => this.handleCredentialResponse(response),
                    auto_select: false,
                    use_fedcm_for_prompt: true,
                });
            } else {
                console.error("Google Identity Services script not loaded or not ready.");
            }
        },

        signIn() {
            if (!this.GOOGLE_CLIENT_ID) {
                this.showToast({ variant: 'error', title: 'Configuration Error', description: 'Google Client ID is not configured.' });
                return;
            }
            if (this.isGsiLoaded && window.google) {
                this.initializeGoogleOneTap();
                window.google.accounts.id.prompt();
            } else {
                this.showToast({ variant: 'error', title: 'Sign In Error', description: 'Google Identity Services not loaded or ready. Please try again.' });
            }
        },

        signOut() {
            this.user = null;
            localStorage.removeItem('feathernote-user');
            localStorage.removeItem('feathernote-has-logged-in');
            if (window.google && window.google.accounts) {
                window.google.accounts.id.disableAutoSelect();
            }
            this.showToast({ title: 'Signed Out', description: 'You have been signed out.' });
        },



        // --- Notification Methods (Local) ---
        initNotifications() {
            if (!('Notification' in window) || !navigator.serviceWorker) {
                console.warn('Notifications API not supported.');
                return;
            }
            this.notificationPermissionStatus = Notification.permission;
            this.notificationsEnabled = this.notificationPermissionStatus === 'granted';
        },

        async togglePushNotifications() { // Name kept for consistency in UI
            if (this.notificationPermissionStatus !== 'granted') {
                this.notificationPermissionStatus = await Notification.requestPermission();
                this.notificationsEnabled = this.notificationPermissionStatus === 'granted';
                if (this.notificationsEnabled) {
                    this.showToast({ title: 'Notifications Enabled', description: 'You can now set reminders on notes.' });
                    this.scheduleAllFutureReminders();
                } else {
                    this.showToast({ variant: 'error', title: 'Notifications Disabled', description: 'Permission was not granted.' });
                }
            } else {
                this.showToast({ title: 'Permissions', description: 'To disable notifications, manage permissions in your browser settings.' });
            }
        },

        scheduleNotification(note) {
            this.cancelNotification(note.id);

            if (!note.reminder || this.notificationPermissionStatus !== 'granted') {
                return;
            }

            const reminderTime = new Date(note.reminder).getTime();
            const now = new Date().getTime();
            const delay = reminderTime - now;

            if (delay > 0) {
                const timeoutId = setTimeout(() => {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification(note.title, {
                            body: note.content.substring(0, 100),
                            icon: '/favicon.png',
                            badge: '/favicon.png',
                            data: { url: `/#note/${note.id}` }
                        });
                    });
                }, delay);

                this.scheduledNotifications[note.id] = timeoutId;
                console.log(`Reminder scheduled for note ${note.id} in ${delay}ms`);
            }
        },

        cancelNotification(noteId) {
            if (this.scheduledNotifications[noteId]) {
                clearTimeout(this.scheduledNotifications[noteId]);
                delete this.scheduledNotifications[noteId];
                console.log(`Cancelled reminder for note ${noteId}`);
            }
        },

        scheduleAllFutureReminders() {
            if (this.notificationPermissionStatus !== 'granted') return;
            this.notes.forEach(note => this.scheduleNotification(note));
        },

        // --- App Badging Methods ---
        async updateAppBadge() {
            if ('setAppBadge' in navigator) {
                const reminderNotesCount = this.notes.filter(note => !!note.reminder).length;
                if (reminderNotesCount > 0) {
                    await navigator.setAppBadge(reminderNotesCount);
                    console.log(`App badge set to ${reminderNotesCount}`);
                } else {
                    await navigator.clearAppBadge();
                    // console.log('App badge cleared.');
                }
            }
        },

        // --- Note Manager Methods ---
        async generateSuggestions() {
            if (this.searchTag.trim() === '') {
                this.suggestions = [];
                return;
            }
            this.suggestions = this.miniSearch?.autoSuggest(this.searchTag, {
                prefix: true,
                fuzzy: 0.2,
                combineWith: 'AND'
            }) || [];
        },
        async fetchNotes() {
            this.loading = true;
            try {
                const notesFromDB = await getNotesDB();
                this.notes = notesFromDB;
                this.scheduleAllFutureReminders();
            } catch (error) {
                console.error('Error in fetchNotes:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not load notes.' });
            } finally {
                this.loading = false;
            }
        },

        async addNote(title, content, reminder, tags) {
            try {
                const now = new Date().toISOString();
                const newNote = {
                    id: crypto.randomUUID(),
                    title,
                    content,
                    createdAt: now,
                    updatedAt: now,
                    reminder: reminder || undefined,
                    tags: tags || [],
                };
                await addNoteDB(newNote);
                this.notes.unshift(newNote);
                this.scheduleNotification(newNote);
                // this.showToast({ title: 'Note Added', description: 'New note created.' });
                this.syncNotes(false, 1, [newNote]);
                return newNote;
            } catch (error) {
                console.error('Error in addNote:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not create note.' });
                return null;
            }
        },

        async updateNote(id, updates) {
            try {
                const noteToUpdate = await getNoteDB(id);
                if (!noteToUpdate) throw new Error('Note not found');

                const updatedNote = { ...noteToUpdate, ...updates, updatedAt: new Date().toISOString() };
                await updateNoteDB(updatedNote);
                this.notes = this.notes.map(note => note.id === id ? updatedNote : note);
                this.scheduleNotification(updatedNote);
                this.showToast({ title: 'Note Updated', description: 'Note saved successfully.' });
                this.syncNotes(false, 1, [updatedNote]);
            } catch (error) {
                console.error('Error in updateNote:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not update note.' });
            }
        },

        async deleteNote(id) {
            try {
                this.cancelNotification(id);
                await deleteNoteDB(id);
                await this.deleteNoteFromS3(id);
                this.notes = this.notes.filter((note) => note.id !== id);
                this.deletedNoteIds.push(id);
                this.showToast({ title: 'Note Deleted', description: 'Your note has been successfully deleted.' });
            } catch (error) {
                console.error('Error in deleteNote:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not delete note.' });
            }
        },

        async deleteNoteFromS3(noteId) {
            const userId = this.user ? this.user.id : null;
            const isS3Configured = localStorage.getItem('s3Configured') === 'true';

            if (!isS3Configured) {
                this.showToast({ title: 'Sync Not Configured', description: 'S3 sync is not configured.' });
                return;
            }

            try {
                const encryptedSettings = localStorage.getItem(`feathernote-settings-${userId}`);
                if (!encryptedSettings) {
                    throw new Error('S3 credentials not found in local storage.');
                }

                const result = await apiDeleteNote(
                    encryptedSettings,
                    userId,
                    noteId
                );

                console.dir({deleteNoteFromS3: result})

                if (result.success) {
                    this.showToast({ title: 'Note Deleted from S3', description: `Note ${noteId} has been deleted from S3.` });
                } else {
                    throw new Error(result.error || 'Server responded with an error.');
                }

            } catch (error) {
                console.error('Error deleting note from S3:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not delete note from S3.' });
            }
        },

        async getNote(id) {
            try {
                return await getNoteDB(id);
            } catch (error) {
                console.error('Error in getNote:', error);
                this.showToast({ variant: 'error', title: 'Error', description: 'Could not fetch note.' });
                return undefined;
            }
        },

        async syncNotes(isSilent = false, iterator = 0, notes = null) {
            const userId = this.user ? this.user.id : null;
            const isS3Configured = localStorage.getItem('s3Configured') === 'true';

            if (!isS3Configured) {
                if (!isSilent) {
                    this.showToast({ title: 'Sync Not Configured', description: 'S3 sync is not configured.' });
                }
                return;
            }

            if (this.isSyncing) {
                iterator++;
                // setTimeout(() => this.syncNotes(true, iterator, notes), 5e3 * iterator);
                return;
            }

            this.isSyncing = true;
            try {
                const encryptedSettings = localStorage.getItem(`feathernote-settings-${userId}`);
                if (!encryptedSettings) {
                    throw new Error('S3 credentials not found in local storage.');
                }


                let localNotes = notes || await getNotesDB();

                // The 'notes' parameter is for targeted sync of specific notes.
                // For a general background sync, we now send all notes to the sync API
                // to allow for proper conflict resolution. The old implementation could
                // cause data loss by uploading notes without checking for remote changes first.

                localNotes = localNotes.filter(x => !this.deletedNoteIds.find(deleting => x.id == deleting));

                const result = await apiSyncNotes(
                    encryptedSettings,
                    userId,
                    localNotes,
                    this.deletedNoteIds,
                    this.lastSync
                );

                if (result.success) {
                    let downloadedCount = 0;
                    for (const remoteNote of result.updatedNotes) {
                        const localNote = await getNoteDB(remoteNote.id);
                        if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
                            await updateNoteDB(remoteNote);
                            downloadedCount++;
                        }
                    }

                    // NEW LOGIC: Handle notes deleted remotely
                    const remoteNoteIdsSet = new Set(result.remoteNoteIds);
                    const notesToDeleteLocally = [];
                    for (const localNote of this.notes) { // Use this.notes which is the current state
                        if (!remoteNoteIdsSet.has(localNote.id)) {
                            notesToDeleteLocally.push(localNote.id);
                        }
                    }

                    for (const noteIdToDelete of notesToDeleteLocally) {
                        await deleteNoteDB(noteIdToDelete);
                        // No need to call deleteNoteFromS3 here, it's already deleted from S3
                        // and we are just reflecting that deletion locally.
                    }

                    await this.fetchNotes(); // Refresh notes from DB after all updates/deletions
                    this.deletedNoteIds = []; // Clear deleted notes after successful sync

                    this.lastSync = new Date().toISOString();
                    localStorage.setItem('feathernote-lastSync', this.lastSync);

                    if (!isSilent) {
                        this.showToast({
                            title: 'Sync Successful',
                            description: `Uploaded: ${result.uploadedCount}, Downloaded/Updated: ${downloadedCount}, Deleted: ${result.deletedCount}, Remotely Deleted: ${notesToDeleteLocally.length}.`, // Add remotely deleted count
                        });
                    }
                } else {
                    throw new Error(result.error || 'Server responded with an error.');
                }

            } catch (error) {
                if (isSilent) {
                    console.error('Silent sync failed:', error);
                    return;
                }

                let errorMessage = 'An unknown error occurred.';
                let errorTitle = 'Incomplete Sync';

                if (error instanceof TypeError) {
                    errorTitle = 'Network Error';
                    errorMessage = `Could not connect to the server. Please check your internet connection or server status. This could also be a CORS issue.`;
                } else if (error instanceof Error) {
                    errorMessage = error.message;
                }

                this.showToast({
                    title: errorTitle,
                    description: errorMessage,
                    duration: 5000,
                });
            } finally {
                this.isSyncing = false;
            }
        },

        async processSharedContent() {
            // await navigator.locks.request('shared-content-lock', async lock => {
                try {
                    const sharedItems = await getSharedContentDB();

                    if (sharedItems.length > 0) {
                        console.dir({sharedItems});
                        for (const item of sharedItems) {
                            await this.addNote(item.title || ('Share ' + new Date().toString().substr(0, 21)), item.content);
                        }

                        await clearSharedContentDB();

                        this.showToast({
                            title: 'Shared Content Imported',
                            description: `${sharedItems.length} item(s) have been added to your notes.`,
                        });

                        await this.fetchNotes();
                        this.syncNotes(true);
                    }
                } catch (error) {
                    console.error('Failed to process shared content', error);
                    this.showToast({ variant: 'error', title: 'Error', description: 'Could not import shared content.' });
                }
            // });
        },

        prepareEasyMDE(id) {
            this.$nextTick(() => {
                window.easyMDEInstance = window.easyMDEInstance || new EasyMDE({
                    element: document.getElementById('note-content'),
                    unorderedListStyle: "-",
                    lineNumbers: true,
                    spellChecker: false,
                    nativeSpellcheck: false,
                    autosave: {
                        enabled: true,
                        uniqueId: id,
                        delay: 1000,
                        submit_delay: 5000,
                        timeFormat: {
                            locale: 'en-US',
                            format: {
                                year: 'numeric',
                                month: 'long',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            },
                        },
                        text: "Autosaved: "
                    },
                    forceSync: true,
                    previewImagesInEditor: true,
                });
            });
        },

        createNewNote() {
            this.editingNoteId = new Date().toString().substr(0, 18);
            this.noteEditorNoteId = null;
            this.noteEditorTitle = '';
            this.noteEditorContent = '';
            this.noteEditorReminder = '';
            this.noteEditorTags = '';

            this.$nextTick(() => document.getElementById('note-title').setAttribute('placeholder', 'Note at ' + new Date().toString().substr(0, 21)));

            this.prepareEasyMDE(this.editingNoteId);
            window.location.hash = '#new_note';
        },

        async editNote(id) {
            this.editingNoteId = id;
            await this.loadNoteIntoEditor(id);
        },

        // --- Note Editor Methods (moved from noteEditor component) ---
        async loadNoteIntoEditor(id) {
            this.noteEditorNoteId = id;
            if (!this.noteEditorNoteId) return;
            const note = await this.getNote(this.noteEditorNoteId);
            if (note) {
                this.noteEditorTitle = note.title;
                this.noteEditorContent = note.content;
                this.noteEditorReminder = note.reminder || '';
                this.noteEditorTags = note.tags ? note.tags.join(', ') : '';
            } else {
                this.showToast({ variant: 'error', title: 'Error', description: 'Note not found.' });
                this.editingNoteId = null;
            }

            this.prepareEasyMDE(id);
        },

        async saveNote() {
            let finalTitle = this.noteEditorTitle.trim();
            if (!finalTitle) {
                // If title is empty or just whitespace, use a default title
                finalTitle = 'Note at ' + new Date().toString().substr(0, 21); // Use a more readable format
            }

            const tags = this.noteEditorTags.split(',').map(tag => tag.trim()).filter(tag => tag);

            const noteData = {
                title: finalTitle,
                content: window.easyMDEInstance?.value() || this.noteEditorContent,
                reminder: this.noteEditorReminder.trim() !== '' ? this.noteEditorReminder : undefined,
                tags: tags,
            };

            if (this.noteEditorNoteId && this.noteEditorNoteId !== 'new') {
                await this.updateNote(this.noteEditorNoteId, noteData);
            } else {
                const newNote = await this.addNote(noteData.title, noteData.content, noteData.reminder, noteData.tags);
                if (newNote) {
                    this.noteEditorNoteId = newNote.id;
                }
            }

            this.cancelEdit();
            this.fetchNotes();
        },

        cancelEdit() {
            window.easyMDEInstance?.toTextArea?.();
            window.easyMDEInstance = null;

            this.editingNoteId = null;
            window.location.hash = '';
        },

        // --- Settings Dialog Data & Methods (moved from settingsDialog component) ---
        settingsDialogIsOpen: false,
        s3Region: '',
        s3Bucket: '',
        s3Subfolder: '',
        s3Endpoint: '',
        accessKeyId: '',
        secretAccessKey: '',
        isManualSyncing: false,
        exportString: '',
        importString: '',
        showImportModal: false,
        showExportModal: false,

        // initSettingsDialog() {
        //     this.$watch('settingsDialogIsOpen', (value) => {
        //         if (value) {
        //             this.loadSettingsFromStorage();
        //         }
        //     });
        // },

        get userId() {
            return this.user ? this.user.id : null;
        },

        get isSyncConfigured() {
            return true;
        },

        get isSyncButtonDisabled() {
            return !this.isSyncConfigured || this.isManualSyncing || this.isSyncing;
        },

        async loadSettingsFromStorage() {
            const key = `feathernote-settings-${this.userId}`;
            const encryptedSettings = localStorage.getItem(key);

            if (!encryptedSettings) return;

            decryptSettings(encryptedSettings, this.userId)
                .then(decrypted => {
                    if (!decrypted) return;

                    this.s3Bucket = decrypted.s3Bucket || '';
                    this.s3Region = decrypted.s3Region || '';
                    this.s3Endpoint = decrypted.s3Endpoint || '';
                    this.s3Subfolder = decrypted.s3Subfolder || '';
                    this.accessKeyId = decrypted.accessKeyId || '';
                    this.secretAccessKey = decrypted.secretAccessKey || '';
                })
                .catch(error => {
                    this.showToast({ title: 'Settings Decryption Error', description: error.message });
                });
        },

        async handleSave() {
            const key = `feathernote-settings-${this.userId}`;

            // Get existing settings to preserve the secret key if not changed
            const existingEncrypted = localStorage.getItem(key);
            let existingSettings = {};
            if (existingEncrypted) {
                const decrypted = await decryptSettings(existingEncrypted, this.userId);
                if(decrypted) existingSettings = decrypted;
            }

            const settingsToStore = {
                s3Bucket: this.s3Bucket,
                s3Region: this.s3Region,
                s3Endpoint: this.s3Endpoint,
                s3Subfolder: this.s3Subfolder,
                accessKeyId: this.accessKeyId,
                secretAccessKey: existingSettings.secretAccessKey || ''
            };

            if (this.secretAccessKey) {
                // Only update the secret key if a new one is entered
                settingsToStore.secretAccessKey = this.secretAccessKey;
            }

            const encryptedSettings = await encryptSettings(settingsToStore, this.userId);
            localStorage.setItem(key, encryptedSettings);
            localStorage.setItem('s3Configured', 'true');

            this.showToast({ title: 'Settings Saved', description: 'Your encrypted S3 credentials have been updated.' });
            // this.settingsDialogIsOpen = false;
            this.syncNotes(true);
        },

        async handleSync() {
            this.isManualSyncing = true;
            await this.syncNotes(false);
            this.isManualSyncing = false;
        },

        async handleExport() {
            const key = `feathernote-settings-${this.userId}`;
            const encryptedString = localStorage.getItem(key);
            if (encryptedString) {
                this.exportString = encryptedString;
            } else {
                this.showToast({ variant: 'error', title: 'Nothing to Export', description: 'No saved settings found.' });
            }
            this.showExportModal = true; // Ensure the modal opens
            this.$nextTick(() => document.querySelector('[x-model="exportString"]').scrollIntoView());
        },

        copyExportStringToClipboard() {
            var copyText = document.querySelector('[x-model="exportString"]');
            copyText.select();
            copyText.setSelectionRange(0, 99999);

            navigator.clipboard.writeText(this.exportString);
            this.showToast({ title: 'Copied!', description: 'Encrypted settings string copied to clipboard.' });
        },

        async openImport() {
            this.importString = '';
            this.showImportModal = true;
            this.$nextTick(() => document.querySelector('[x-model="importString"]').scrollIntoView());
        },

        async handleImport() {
            const key = `feathernote-settings-${this.userId}`;

            try {
                const parsed = JSON.parse(this.importString?.trim());
                if (parsed.salt && parsed.iv && parsed.content) {
                    localStorage.setItem(key, this.importString);
                    await this.loadSettingsFromStorage();
                    this.showToast({ title: 'Settings Imported', description: 'Your encrypted S3 credentials have been imported.' });
                    await this.handleSave();
                    this.importString = '';
                    this.showImportModal = false; // Close the modal after successful import
                } else {
                    throw new Error('Invalid or incomplete settings data.');
                }
            } catch (error) {
                console.error(error);
                this.showToast({ variant: 'error', title: 'Import Failed', description: 'The provided string is not a valid encrypted settings configuration.' });
            }
        }
    }));
});