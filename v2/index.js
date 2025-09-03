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
            return JSON.parse(dec.decode(decryptedContent));
        } catch (error) {
            console.error('Decryption failed:', error);
            return null;
        }
    }

    // Simple JWT Decoder (for Google ID Token)
    function jwtDecode(token) {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    }

    // IndexedDB Functions
    const DB_NAME = 'FeatherNoteDB';
    const DB_VERSION = 1;
    const NOTE_STORE = 'notes';
    const SHARED_CONTENT_STORE = 'shared-content';

    let dbInstance;

    const initDB = () => {
        return new Promise((resolve, reject) => {
            if (dbInstance) {
                console.log('IndexedDB already initialized.');
                return resolve(dbInstance);
            }

            console.log('Attempting to open IndexedDB...');
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('Error opening database:', event.target.error);
                reject('Error opening database');
            };

            request.onsuccess = (event) => {
                dbInstance = event.target.result;
                console.log('IndexedDB opened successfully.');
                resolve(dbInstance);
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
            };
        });
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

    Alpine.data('app', () => ({
        toasts: [],
        toastIdCounter: 0,

        initApp() {
            // Call processSharedContent from noteManager after all components are initialized
            this.$nextTick(() => {
                if (this.$root.noteManager) {
                    this.$root.noteManager.processSharedContent();
                }
            });

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
        },

        formatDate(isoString) {
            return new Date(isoString).toLocaleString();
        },
        getNotePreview(content) {
            return content ? `${content.substring(0, 100)}...` : 'No content preview';
        },

        showToast({ title, description, variant = 'default', duration = 3000 }) {
            const id = `toast-${this.toastIdCounter++}`;
            const newToast = { id, title, description, variant, show: true };
            this.toasts.push(newToast);

            setTimeout(() => {
                this.dismissToast(id);
            }, duration);
        },

        dismissToast(id) {
            this.toasts = this.toasts.map(toast =>
                toast.id === id ? { ...toast, show: false } : toast
            );
            // Remove from DOM after animation (if any)
            setTimeout(() => {
                this.toasts = this.toasts.filter(toast => toast.id !== id);
            }, 300); // Adjust this duration to match your CSS transition for fade-out
        }
    }));

    Alpine.data('settingsDialog', () => ({
        isOpen: false,
        s3Bucket: '',
        s3Region: '',
        s3Endpoint: '',
        s3Subfolder: '',
        accessKeyId: '',
        secretAccessKey: '',
        isManualSyncing: false,
        exportString: '',
        importString: '',
        showImportModal: false,
        showExportModal: false,

        init() {
            this.$watch('isOpen', (value) => {
                if (value) {
                    this.loadSettingsFromStorage();
                }
            });
        },

        get userId() {
            return this.$root.auth && this.$root.auth.user ? this.$root.auth.user.id : null;
        },

        get isSyncConfigured() {
            return !!(this.$root.auth && this.$root.auth.user);
        },

        get isSyncButtonDisabled() {
            return !this.isSyncConfigured || this.isManualSyncing || (this.$root.noteManager && this.$root.noteManager.isSyncing);
        },

        async loadSettingsFromStorage() {
            if (!this.userId) return;
            const key = `feathernote-settings-${this.userId}`;
            const encryptedSettings = localStorage.getItem(key);
            if (encryptedSettings) {
                const decrypted = await decryptSettings(encryptedSettings, this.userId);
                if (decrypted) {
                    this.s3Bucket = decrypted.s3Bucket || '';
                    this.s3Region = decrypted.s3Region || '';
                    this.s3Endpoint = decrypted.s3Endpoint || '';
                    this.s3Subfolder = decrypted.s3Subfolder || '';
                    this.accessKeyId = decrypted.accessKeyId || '';
                    this.secretAccessKey = ''; // Always require re-entry of secret key
                }
            }
        },

        async handleSave() {
            if (!this.userId) {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Not Logged In', description: 'You must be logged in to save settings.' });
                return;
            }
            const key = `feathernote-settings-${this.userId}`;

            const settingsToStore = {
                s3Bucket: this.s3Bucket,
                s3Region: this.s3Region,
                s3Endpoint: this.s3Endpoint,
                s3Subfolder: this.s3Subfolder,
                accessKeyId: this.accessKeyId,
            };
            if (this.secretAccessKey) {
                settingsToStore.secretAccessKey = this.secretAccessKey;
            }

            const encryptedSettings = await encryptSettings(settingsToStore, this.userId);
            localStorage.setItem(key, encryptedSettings);
            localStorage.setItem('s3Configured', 'true');
            
            this.$dispatch('show-toast', { title: 'Settings Saved', description: 'Your encrypted S3 credentials have been updated.' });
            this.isOpen = false;
        },

        async handleSync() {
            this.isManualSyncing = true;
            // Call the noteManager's syncNotes function
            if (this.$root.noteManager) {
                await this.$root.noteManager.syncNotes(false);
            }
            this.isManualSyncing = false;
        },

        async handleExport() {
            if (!this.userId) return;
            const key = `feathernote-settings-${this.userId}`;
            const encryptedString = localStorage.getItem(key);
            if (encryptedString) {
                this.exportString = encryptedString;
            } else {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Nothing to Export', description: 'No saved settings found.' });
            }
        },

        copyExportStringToClipboard() {
            navigator.clipboard.writeText(this.exportString);
            this.$dispatch('show-toast', { title: 'Copied!', description: 'Encrypted settings string copied to clipboard.' });
        },

        async handleImport() {
            if (!this.userId) {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Not Logged In', description: 'You must be logged in to import settings.' });
                return;
            }
            const key = `feathernote-settings-${this.userId}`;

            try {
                const parsed = JSON.parse(this.importString);
                if (parsed.salt && parsed.iv && parsed.content) {
                    localStorage.setItem(key, this.importString);
                    await this.loadSettingsFromStorage();
                    this.importString = '';
                    this.$dispatch('show-toast', { title: 'Settings Imported', description: 'Your encrypted S3 credentials have been imported.' });
                    this.isOpen = false;
                } else {
                    throw new Error('Invalid or incomplete settings data.');
                }
            } catch (error) {
                console.error(error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Import Failed', description: 'The provided string is not a valid encrypted settings configuration.' });
            }
        }
    }));

    Alpine.data('auth', () => ({
        user: null,
        isGsiLoaded: false,
        GOOGLE_CLIENT_ID: "547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com",

        init() {
            const storedUser = localStorage.getItem('feathernote-user');
            if (storedUser) {
                this.user = JSON.parse(storedUser);
            }

            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                this.isGsiLoaded = true;
                // Do not call initializeGoogleOneTap here directly. Let signIn handle it.
            };
            document.body.appendChild(script);
        },

        handleCredentialResponse(response) {
            try {
                const decoded = jwtDecode(response.credential);
                const newUser = {
                    id: decoded.sub,
                    name: decoded.name,
                    email: decoded.email,
                    picture: decoded.picture,
                };
                this.user = newUser;
                localStorage.setItem('feathernote-user', JSON.stringify(newUser));
                localStorage.setItem('feathernote-has-logged-in', 'true');
                this.$dispatch('show-toast', { title: 'Signed In', description: `Welcome, ${newUser.name}!` });
            } catch (error) {
                console.error("Error decoding JWT:", error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Sign In Failed', description: 'Could not process Google credential.' });
            }
        },

        initializeGoogleOneTap() {
            // This function is now called only when needed (e.g., by signIn)
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
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Configuration Error', description: 'Google Client ID is not configured.' });
                return;
            }
            // Ensure GSI is initialized before prompting
            if (this.isGsiLoaded && window.google) {
                this.initializeGoogleOneTap(); // Initialize here before prompt
                window.google.accounts.id.prompt();
            } else {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Sign In Error', description: 'Google Identity Services not loaded or ready. Please try again.' });
            }
        },

        signOut() {
            this.user = null;
            localStorage.removeItem('feathernote-user');
            localStorage.removeItem('feathernote-has-logged-in');
            if (window.google && window.google.accounts) {
                window.google.accounts.id.disableAutoSelect();
            }
            this.$dispatch('show-toast', { title: 'Signed Out', description: 'You have been signed out.' });
            // Optionally reload or redirect
            // window.location.reload();
        }
    }));

    Alpine.data('noteManager', () => ({
        notes: [],
        loading: true,
        isSyncing: false,
        syncIntervalId: null,
        editingNoteId: null, // New state to track which note is being edited

        init() {
            this.fetchNotes();
            // Set up silent sync interval
            this.syncIntervalId = setInterval(() => {
                this.syncNotes(true); // Run a silent sync
            }, 2 * 60 * 1000); // Every 2 minutes

            // Cleanup on component destroy (if Alpine supports it, or on page unload)
            this.$watch('$el', (el) => {
                if (!el) {
                    clearInterval(this.syncIntervalId);
                }
            });
        },

        async fetchNotes() {
            this.loading = true;
            try {
                const notesFromDB = await getNotesDB();
                this.notes = notesFromDB;
            } catch (error) {
                console.error('Error in fetchNotes:', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not load notes.' });
            } finally {
                this.loading = false;
            }
        },

        async addNote(title, content, reminder) {
            try {
                const now = new Date().toISOString();
                const newNote = {
                    id: crypto.randomUUID(),
                    title,
                    content,
                    createdAt: now,
                    updatedAt: now,
                    reminder: reminder || undefined,
                };
                await addNoteDB(newNote);
                this.notes.unshift(newNote); // Add to the beginning
                this.$dispatch('show-toast', { title: 'Note Added', description: 'New note created.' });
                return newNote;
            } catch (error) {
                console.error('Error in addNote:', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not create note.' });
                return null;
            }
        },

        async updateNote(id, updates) {
            try {
                const noteToUpdate = await getNoteDB(id);
                if (!noteToUpdate) throw new Error('Note not found');

                const updatedNote = { ...noteToUpdate, ...updates, updatedAt: new Date().toISOString() };
                await updateNoteDB(updatedNote);
                // Update the note in the local notes array
                this.notes = this.notes.map(note => note.id === id ? updatedNote : note);
                this.$dispatch('show-toast', { title: 'Note Updated', description: 'Note saved successfully.' });
            } catch (error) {
                console.error('Error in updateNote:', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not update note.' });
            }
        },

        async deleteNote(id) {
            try {
                await deleteNoteDB(id);
                this.notes = this.notes.filter((note) => note.id !== id);
                this.$dispatch('show-toast', { title: 'Note Deleted', description: 'Your note has been successfully deleted.' });
            } catch (error) {
                console.error('Error in deleteNote:', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not delete note.' });
            }
        },

        async getNote(id) {
            try {
                return await getNoteDB(id);
            } catch (error) {
                console.error('Error in getNote:', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not fetch note.' });
                return undefined;
            }
        },

        async syncNotes(isSilent = false) {
            const userId = this.$root.auth.user ? this.$root.auth.user.id : null;
            const isS3Configured = localStorage.getItem('s3Configured') === 'true';

            if (!isS3Configured || !userId) {
                if (!isSilent) {
                    this.$dispatch('show-toast', { variant: 'destructive', title: 'Sync Not Configured', description: 'S3 sync is not configured or you are not logged in.' });
                }
                return;
            }

            this.isSyncing = true;
            try {
                const encryptedSettings = localStorage.getItem(`feathernote-settings-${userId}`);
                if (!encryptedSettings) {
                    throw new Error('S3 credentials not found in local storage.');
                }

                const response = await fetch('/api/sync-notes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        encryptedSettings,
                        userId,
                        localNotes: await getNotesDB(), // Send all local notes for comparison
                    }),
                });

                const result = await response.json();

                if (response.ok) {
                    // Update local IndexedDB with updatedNotes from server
                    for (const note of result.updatedNotes) {
                        await updateNoteDB(note);
                    }
                    // Re-fetch notes to update UI with latest from DB
                    await this.fetchNotes();

                    if (!isSilent) {
                        this.$dispatch('show-toast', {
                            title: 'Sync Successful',
                            description: `Uploaded: ${result.uploadedCount}, Downloaded/Updated: ${result.downloadedCount}.`,
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
                let errorTitle = 'Sync Failed';
                if (error instanceof Error) {
                    if (error.message.includes('Failed to fetch')) {
                        errorTitle = 'Network Error';
                        errorMessage = `Could not connect to the server. Please check your internet connection or server status.`;
                    } else if (error.message.includes('CORS')) {
                        errorTitle = 'CORS Policy Error';
                        errorMessage = `Could not connect to S3. This is likely a CORS issue. Please configure your S3 bucket's CORS policy to allow PUT, GET and LIST requests from this app's origin (${window.location.origin}).`;
                    } else {
                        errorMessage = error.message;
                    }
                }
                this.$dispatch('show-toast', {
                    variant: 'destructive',
                    title: errorTitle,
                    description: errorMessage,
                    duration: 9000,
                });
            } finally {
                this.isSyncing = false;
            }
        },

        async processSharedContent() {
            try {
                const sharedItems = await getSharedContentDB();
                if (sharedItems.length > 0) {
                    for (const item of sharedItems) {
                        await this.addNote('Shared Note', item.content);
                    }
                    await clearSharedContentDB();
                    await this.fetchNotes(); // Refresh notes list
                    this.$dispatch('show-toast', {
                        title: 'Content Imported',
                        description: `${sharedItems.length} item(s) have been added to your notes.`,
                    });
                }
            } catch (error) {
                console.error('Failed to process shared content', error);
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Could not import shared content.' });
            }
        },

        // New methods for note editing flow
        createNewNote() {
            this.editingNoteId = 'new'; // Use a special ID for new notes
            // Reset noteEditor state for a new note
            this.$nextTick(() => {
                if (this.$root.noteEditor) {
                    this.$root.noteEditor.noteId = null;
                    this.$root.noteEditor.title = '';
                    this.$root.noteEditor.content = '';
                    this.$root.noteEditor.reminder = ''; // Clear reminder for new note
                }
            });
        },

        async editNote(id) {
            this.editingNoteId = id;
            // Load note into noteEditor state
            this.$nextTick(async () => {
                if (this.$root.noteEditor) {
                    await this.$root.noteEditor.loadNote(id);
                }
            });
        }
    }));

    Alpine.data('noteEditor', () => ({
        noteId: null,
        title: '',
        content: '',
        reminder: '', // New reminder property

        // initEditor() is now called by noteManager.editNote or createNewNote
        async loadNote(id) {
            this.noteId = id; // Ensure noteId is set for load
            if (!this.noteId) return;
            const note = await this.$root.noteManager.getNote(this.noteId);
            if (note) {
                this.title = note.title;
                this.content = note.content;
                this.reminder = note.reminder || ''; // Populate reminder
            } else {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Error', description: 'Note not found.' });
                // If note not found, go back to list view
                this.$root.noteManager.editingNoteId = null;
            }
        },

        async saveNote() {
            if (!this.title.trim()) {
                this.$dispatch('show-toast', { variant: 'destructive', title: 'Validation Error', description: 'Note title cannot be empty.' });
                return;
            }

            const noteData = {
                title: this.title,
                content: this.content,
                reminder: this.reminder.trim() !== '' ? this.reminder : undefined, // Only save if not empty
            };

            if (this.noteId && this.noteId !== 'new') {
                // Update existing note
                await this.$root.noteManager.updateNote(this.noteId, noteData);
            } else {
                // Add new note
                const newNote = await this.$root.noteManager.addNote(noteData.title, noteData.content, noteData.reminder);
                if (newNote) {
                    this.noteId = newNote.id; // Set ID for newly created note
                }
            }
            this.$root.noteManager.editingNoteId = null; // Go back to list view after saving
        },

        cancelEdit() {
            this.$root.noteManager.editingNoteId = null; // Go back to list view
        }
    }));
});