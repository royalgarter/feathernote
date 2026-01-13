// --- Environment-agnostic Globals ---
const BTOA = self.btoa;
const ATOB = self.atob;
const CRYPTO = self.crypto;
const TEXT_ENCODER = TextEncoder;
const TEXT_DECODER = TextDecoder;
const FETCH = self.fetch;
const INDEXED_DB = self.indexedDB;

const promiseTimeout = (p, ms=30e3) => Promise.race([
	p,
	new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
]);

const pad = (num) => num.toString().padStart(2, '0');

const loadScript = (src, id) => {
	return new Promise((resolve, reject) => {
		if (document.getElementById(id)) return resolve();
		const script = document.createElement('script');
		script.src = src;
		script.id = id;
		script.async = true;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
};

const loadStyle = (href, id) => {
	return new Promise((resolve, reject) => {
		if (document.getElementById(id)) return resolve();
		const link = document.createElement('link');
		link.href = href;
		link.id = id;
		link.rel = 'stylesheet';
		link.onload = resolve;
		link.onerror = reject;
		document.head.appendChild(link);
	});
};

// --- Crypto Helpers ---

// Helper function to convert buffer to base64
function bufferToBase64(buffer) {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return BTOA(binary);
}

// Helper function to convert base64 to buffer
function base64ToBuffer(base64) {
	const binary_string = ATOB(base64);
	const len = binary_string.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary_string.charCodeAt(i);
	}
	return bytes.buffer;
}

// Derives a key from a user ID using PBKDF2.
async function getKey(userId='anonymous', salt) {
	const enc = new TEXT_ENCODER();
	const keyMaterial = await CRYPTO.subtle.importKey(
		'raw',
		enc.encode(userId),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);
	return CRYPTO.subtle.deriveKey(
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
async function encryptSettings(settings, userId, nostrPrivateKey) {
	const salt = CRYPTO.getRandomValues(new Uint8Array(16));
	const key = await getKey(userId, salt);
	const iv = CRYPTO.getRandomValues(new Uint8Array(12));
	const enc = new TEXT_ENCODER();

	const settingsToEncrypt = { ...settings, nostrPrivateKey };
	const encodedSettings = enc.encode(JSON.stringify(settingsToEncrypt));

	const encryptedContent = await CRYPTO.subtle.encrypt(
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

		const decryptedContent = await CRYPTO.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: iv,
			},
			key,
			content
		);

		const dec = new TEXT_DECODER();
		const credentials = JSON.parse(dec.decode(decryptedContent));

		credentials.region = credentials.region || credentials.s3Region;
		credentials.bucket = credentials.bucket || credentials.s3Bucket;
		credentials.endpoint = credentials.endpoint || credentials.s3Endpoint;
		credentials.subfolder = credentials.subfolder || credentials.s3Subfolder;
		credentials.nostrPrivateKey = credentials.nostrPrivateKey || '';
		credentials.aiApiKey = credentials.aiApiKey || '';
		credentials.aiApiRoute = credentials.aiApiRoute || '';
		credentials.aiModel = credentials.aiModel || '';

		return credentials;
	} catch (error) {
		console.error('Decryption failed:', error);
		return null;
	}
}

// --- IndexedDB Functions ---
const DB_NAME = 'FeatherNoteDB';
const DB_VERSION = 4;
const NOTE_STORE = 'notes';
const SHARED_CONTENT_STORE = 'shared-content';
const IMAGE_STORE = 'images';
const S3_CREDENTIALS_STORE = 's3-credentials';

let dbPromise;

const initDB = () => {
	if (dbPromise) {
		return dbPromise;
	}

	dbPromise = new Promise((resolve, reject) => {
		const request = INDEXED_DB.open(DB_NAME, DB_VERSION);

		request.onerror = (event) => {
			console.error('Error opening database:', event.target.error);
			dbPromise = null;
			reject('Error opening database');
		};

		request.onsuccess = (event) => {
			const db = event.target.result;
			db.onclose = () => {
				console.log('Database connection closed.');
				dbPromise = null;
			};
			resolve(db);
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
				if (!transaction) return;
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

			if (event.oldVersion < 3) {
				if (!db.objectStoreNames.contains(IMAGE_STORE)) {
					db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
					console.log(`Object store '${IMAGE_STORE}' created.`);
				}
				if (!db.objectStoreNames.contains(S3_CREDENTIALS_STORE)) {
					db.createObjectStore(S3_CREDENTIALS_STORE, { keyPath: 'id' });
					console.log(`Object store '${S3_CREDENTIALS_STORE}' created.`);
				}
			}
		};
	});
	return dbPromise;
};

// Generic DB operation function to reduce boilerplate
async function performDBOperation(storeName, mode, operation, ...args) {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction([storeName], mode);
			const store = transaction.objectStore(storeName);
			const request = store[operation](...args);

			request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
			request.onerror = (event) => {
				console.error(`Error performing ${operation} on ${storeName}:`, event.target.error);
				reject(`Error performing ${operation} on ${storeName}`);
			};
		} catch (ex) {
			reject(ex);
		}
	});
}

const saveEncryptedSettingsDB = (encryptedSettings, userId) => {
	localStorage.setItem('s3-credentials', JSON.stringify({ encryptedSettings, userId }));
	performDBOperation(S3_CREDENTIALS_STORE, 'readwrite', 'put', { id: 's3-credentials', data: { encryptedSettings, userId } });
};
const getEncryptedSettingsDB = async () => {
	try {
		const result = await performDBOperation(S3_CREDENTIALS_STORE, 'readonly', 'get', 's3-credentials');
		if (result && result.data) {
			// If we get data from IndexedDB, make sure localStorage is also up-to-date.
			localStorage.setItem('s3-credentials', JSON.stringify(result.data));
			return result.data;
		}
	} catch (error) {
		console.warn('Could not fetch settings from IndexedDB, falling back to localStorage.', error);
	}

	// If IndexedDB fails or returns no data, try localStorage.
	const fromStorage = localStorage.getItem('s3-credentials');
	if (fromStorage) {
		try {
			return JSON.parse(fromStorage);
		} catch (error) {
			console.error('Could not parse settings from localStorage.', error);
			return null;
		}
	}

	return null;
};

const addImageDB = (image) => performDBOperation(IMAGE_STORE, 'readwrite', 'add', image);
const getImageDB = (id) => performDBOperation(IMAGE_STORE, 'readonly', 'get', id);
const updateImageDB = (image) => performDBOperation(IMAGE_STORE, 'readwrite', 'put', image);
const deleteImageDB = (id) => performDBOperation(IMAGE_STORE, 'readwrite', 'delete', id);
const getUnsyncedImagesDB = async () => {
	const allImages = await performDBOperation(IMAGE_STORE, 'readonly', 'getAll');
	return allImages.filter(img => !img.synced);
};

const getNotesDB = () => performDBOperation(NOTE_STORE, 'readonly', 'getAll');
const getNoteDB = (id) => performDBOperation(NOTE_STORE, 'readonly', 'get', id);
const addNoteDB = (note) => performDBOperation(NOTE_STORE, 'readwrite', 'add', note);
const updateNoteDB = (note) => performDBOperation(NOTE_STORE, 'readwrite', 'put', note);
const deleteNoteDB = (id) => performDBOperation(NOTE_STORE, 'readwrite', 'delete', id);

const getSharedContentDB = () => performDBOperation(SHARED_CONTENT_STORE, 'readonly', 'getAll');
const addSharedContentDB = (item) => performDBOperation(SHARED_CONTENT_STORE, 'readwrite', 'add', item);
const clearSharedContentDB = () => performDBOperation(SHARED_CONTENT_STORE, 'readwrite', 'clear');

async function synchronize({notes, deletedNoteIds, isSilent, credentials, nostrPrivateKey, nostrRelays, gdriveStore, lastSync, gitCredentials}) {
	try {
		// Initialize Git if configured
		if (gitCredentials?.repoUrl) {
			if (typeof window.initGit === 'function') {
				await window.initGit(gitCredentials);
			}
		}

		if (!credentials.secretAccessKey && !gitCredentials?.repoUrl && !gdriveStore?.connected) return {
			success: false,
			error: 'No sync provider configured (S3, Git, or GDrive)',
		};

		// --- Step 1: Get remote state FIRST ---
		const { mergedNotes: remoteNoteMetadata, s3Ids, gitIds, nostrIds, gdriveIds, gdriveMap } = await listNotes({credentials, nostrPrivateKey, nostrRelays, lastSync, gitCredentials, gdriveStore});
		const remoteMetaMap = new Map(remoteNoteMetadata.map(m => [m.id, m]));

		// --- Step 2: Determine which notes to upload ---
		const localNotes = notes || await getNotesDB();
		const notesToUpload = localNotes.filter(localNote => {
			// Don't upload notes that are slated for deletion.
			if (deletedNoteIds.includes(localNote.id)) return false;

			const remoteMeta = remoteMetaMap.get(localNote.id);
			if (!remoteMeta) {
				// Note doesn't exist remotely at all, so it's new.
				return true;
			}

			const remoteDate = new Date(remoteMeta.updatedAt);
			const localDate = new Date(localNote.updatedAt);

			// If it's missing from any of our active sync providers, we need to upload.
			if (gitCredentials?.repoUrl && !gitIds.has(localNote.id)) return true;
			if (credentials.secretAccessKey && !s3Ids.has(localNote.id)) return true;
			if (nostrPrivateKey && !nostrIds.has(localNote.id)) return true;
			if (gdriveStore?.connected && !gdriveIds.has(localNote.id)) return true;

			// If the remote version is strictly newer, don't push the local version yet.
			// We'll download the remote version later in this sync cycle.
			if (localDate < remoteDate) return false;

			// Note exists remotely. Only upload if local is newer than the newest remote.
			return localDate > remoteDate;
		});

		const uploadPromises = notesToUpload.map(note => uploadNote({
			note, credentials, nostrPrivateKey, nostrRelays, gitCredentials, gdriveStore,
			s3Ids, gitIds, nostrIds, gdriveIds, remoteMetaMap, gdriveMap
		}));

		// --- Step 3: Determine which notes to delete from Remotes ---
		const deletePromises = deletedNoteIds.map(noteId => {
			const remoteMeta = remoteMetaMap.get(noteId);
			const gdriveMeta = gdriveMap?.get(noteId);
			return deleteNoteFromRemotes({
				noteId, credentials, nostrPrivateKey, nostrRelays, gdriveStore, gitCredentials, remoteMeta: gdriveMeta || remoteMeta
			});
		});

		// --- Step 4: Execute uploads and deletes ---
		const uploadAndDeletePromises = [...uploadPromises, ...deletePromises];
		const uploadAndDeleteResults = await Promise.allSettled(uploadAndDeletePromises);

		let successfulUploadedCount = 0;
		const successfulDeletedIds = [];
		uploadAndDeleteResults.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (index < uploadPromises.length) {
					successfulUploadedCount++;
				} else {
					// The index of the deletedId corresponds to the index in the deletePromises array
					const deletedIdIndex = index - uploadPromises.length;
					successfulDeletedIds.push(deletedNoteIds[deletedIdIndex]);
				}
			} else {
				console.error('Sync error during upload/delete:', result.reason);
			}
		});
		const successfulDeletedCount = successfulDeletedIds.length;
		
		// Commit and Push Git if we made changes (Uploads or Deletes)
		if (gitCredentials?.repoUrl && (successfulUploadedCount > 0 || successfulDeletedCount > 0)) {
			if (typeof window.finishGitSync === 'function') {
				await window.finishGitSync(gitCredentials);
			}
		}


		// --- Step 5: Determine which notes to download or delete locally ---
		const notesToDownload = [];
		const notesToDeleteLocally = [];
		const allLocalNotesMap = new Map(localNotes.map(n => [n.id, n]));

		// Find notes updated remotely
		for (const remoteMeta of remoteNoteMetadata) {
			const localNote = allLocalNotesMap.get(remoteMeta.id);
			if (!localNote) {
				// Note exists on remote but not local, and isn't in the local delete list. Download it.
				if (!deletedNoteIds.includes(remoteMeta.id)) {
					notesToDownload.push(remoteMeta);
				}
			} else {
				// Note exists on both. Download if remote is newer.
				const remoteDate = new Date(remoteMeta.updatedAt);
				const localDate = new Date(localNote.updatedAt);
				if (remoteDate > localDate) {
					notesToDownload.push(remoteMeta);
				}
			}
		}

		// Find notes deleted remotely
		const remoteNoteIds = new Set(remoteNoteMetadata.map(m => m.id));
		const locallyDeletedNoteIds = new Set(deletedNoteIds);
		const uploadedNoteIds = new Set(notesToUpload.map(n => n.id));

		// Create a set of all local note IDs for easier checking
		const localNoteIds = new Set(allLocalNotesMap.keys());

		// Identify notes that should be deleted locally:
		// - Exist locally
		// - Don't exist remotely
		// - Weren't already marked for local deletion
		// - Weren't just uploaded (which would mean they now exist remotely)
		const remotelyDeletedNoteIds = [...localNoteIds].filter(noteId => 
			!remoteNoteIds.has(noteId) && 
			!locallyDeletedNoteIds.has(noteId) && 
			!uploadedNoteIds.has(noteId)
		);

		notesToDeleteLocally.push(...remotelyDeletedNoteIds);

		const downloadPromises = notesToDownload.map(remoteMeta => {
			if (remoteMeta.source === 'git') {
				// We already have the content from listNotesInGit? 
				// listNotesInGit returns full note objects with content!
				// So we don't need to download again. We just return it.
				return Promise.resolve(remoteMeta);
			} else if (remoteMeta.source === 'nostr') {
				return Promise.resolve(remoteMeta); // Nostr also returns full event/note
			} else if (remoteMeta.source === 'gdrive') {
				return window.downloadNoteFromGDrive(remoteMeta.fileId, remoteMeta.id);
			} else {
				return downloadNoteFromS3(remoteMeta.id, credentials);
			}
		});
		const downloadResults = await Promise.allSettled(downloadPromises);

		const updatedNotes = [];
		downloadResults.forEach((result, idx) => {
			if (result.status === 'fulfilled' && result.value) {
				updatedNotes.push(result.value);
			} else if (result.status === 'rejected') {
				console.log('Sync download error:', notesToDownload[idx].id, result.reason.message);
				// If a note was listed in metadata but fails to download with NoSuchKey,
				// it means it was deleted between the list and get operations.
				// We should treat it as a remote deletion.
				if (result.reason && result.reason.code === 'NoSuchKey') {
					notesToDeleteLocally.push(notesToDownload[idx].id);
				}
			}
		});

		return {
			success: true,
			uploadedCount: successfulUploadedCount,
			deletedCount: successfulDeletedCount,
			successfulDeletedIds, // downloaded notes
			updatedNotes, // downloaded notes
			notesToDeleteLocally,
			finalRemoteIds: Array.from(remoteNoteIds)
		};
	} catch (error) {
		console.error('synchronize error:', error);
		return { success: false, error: error.message };
	}
}

async function synchronizeImages({encryptedSettings, userId, nostrPrivateKey, nostrRelays}) {
	try {
		const credentials = await decryptSettings(encryptedSettings, userId);
		if (!credentials) {
			throw new Error('Failed to decrypt credentials.');
		}

		// 1. Upload unsynced local images
		let uploadedImageCount = 0;
		const unsyncedImages = await getUnsyncedImagesDB();
		for (const image of unsyncedImages) {
			try {
				await uploadImage({image, credentials, nostrPrivateKey, nostrRelays});
				await updateImageDB({ ...image, synced: true });
				uploadedImageCount++;
			} catch (uploadError) {
				console.error(`Failed to upload or mark image ${image.id} as synced:`, uploadError);
			}
		}

		// 2. Determine all referenced image IDs from all notes
		const allNotes = await getNotesDB();
		const imageIdRegex = /\/images\/([a-f0-9-]+)/g;
		const referencedImageIds = new Set();
		for (const note of allNotes) {
			let match;
			while ((match = imageIdRegex.exec(note.content)) !== null) {
				referencedImageIds.add(match[1]);
			}
		}

		// 3. Download missing referenced images
		let downloadedImageCount = 0;
		const remoteImageMetas = await listImages({credentials, nostrPrivateKey, nostrRelays});
		const remoteImageIds = new Set(remoteImageMetas.map(x => x.id));

		for (const imageId of referencedImageIds) {
			const localImage = await getImageDB(imageId);
			if (!localImage && remoteImageIds.has(imageId)) {
				console.log(`Image ${imageId} not found locally, downloading...`);
				try {
					const imageBlob = await downloadImageFromS3(imageId, credentials);
					if (imageBlob) {
						await addImageDB({ id: imageId, blob: imageBlob, synced: true });
						downloadedImageCount++;
					}
				} catch (downloadError) {
					console.error(`Failed to download image ${imageId}:`, downloadError);
				}
			}
		}

		// 4. Garbage Collect Orphaned Images
		let deletedOrphanCount = 0;

		// GC Local (IndexedDB)
		const allLocalImages = await performDBOperation(IMAGE_STORE, 'readonly', 'getAll');
		const localOrphanIds = allLocalImages
			.filter(img => !referencedImageIds.has(img.id))
			.map(img => img.id);

		for (const orphanId of localOrphanIds) {
			await deleteImageDB(orphanId);
			deletedOrphanCount++;
		}

		// GC Remote (S3/Nostr)
		const remoteOrphanIds = remoteImageMetas
			.filter(meta => !referencedImageIds.has(meta.id))
			.map(meta => meta.id);

		for (const imageId of remoteOrphanIds) {
			try {
				await deleteImageFromRemotes({imageId, credentials, nostrPrivateKey, nostrRelays});
				// We count this even if only one of the remotes succeeds.
				// To avoid double counting with local, we only increment if it wasn't a local orphan.
				if (!localOrphanIds.includes(orphanId)) {
					deletedOrphanCount++;
				}
			} catch (err) {
				console.error(`Failed to delete remote orphan image ${orphanId}:`, err);
			}
		}

		return { success: true, uploadedImageCount, downloadedImageCount, deletedOrphanCount };
	} catch (error) {
		console.error('synchronizeImages error:', error);
		return { success: false, error: error.message };
	}
}

async function uploadNote({note, credentials, nostrPrivateKey, nostrRelays, gitCredentials, gdriveStore, s3Ids, gitIds, nostrIds, gdriveIds, remoteMetaMap, gdriveMap}) {
	const localDate = new Date(note.updatedAt);
	const remoteMeta = remoteMetaMap?.get(note.id);
	const gdriveMeta = gdriveMap?.get(note.id);
	const isNewerLocally = remoteMeta && localDate > new Date(remoteMeta.updatedAt);

	await Promise.allSettled([
		(credentials.secretAccessKey && (isNewerLocally || !s3Ids?.has(note.id))) ? uploadNoteToS3(note, credentials) : null,
		(nostrPrivateKey && (isNewerLocally || !nostrIds?.has(note.id))) ? window.publishNoteToRelays(nostrRelays.split(',').map(r => r.trim()), nostrPrivateKey, note) : null,
		(gitCredentials?.repoUrl && typeof window.uploadNoteToGit === 'function' && (isNewerLocally || !gitIds?.has(note.id))) ? window.uploadNoteToGit(note, gitCredentials) : null,
		(gdriveStore?.connected && typeof window.uploadNoteToGoogleDrive === 'function' && (isNewerLocally || !gdriveIds?.has(note.id))) ? window.uploadNoteToGoogleDrive(note, gdriveMeta) : null,
	].filter(x => x));
}

async function uploadImage({image, credentials, nostrPrivateKey, nostrRelays}) {
	const promises = [];

	if (credentials?.secretAccessKey) {
		promises.push(uploadImageToS3(image, credentials));
	}

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		// a signed URL is not available with V2 of the SDK, so we'll just publish the record without the URL
		promises.push(window.publishImageToRelays(relays, nostrPrivateKey, image));
	}

	await Promise.allSettled(promises);
}

async function listNotes({credentials, nostrPrivateKey, nostrRelays, lastSync, gitCredentials, gdriveStore}) {
	const s3NotesPromise = listNotesInS3(credentials, lastSync);

	let nostrNotesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrNotesPromise = window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey, lastSync);
	} else {
		nostrNotesPromise = Promise.resolve([]);
	}

	let gitNotesPromise;
	if (gitCredentials?.repoUrl && typeof window.listNotesInGit === 'function') {
		gitNotesPromise = window.listNotesInGit(gitCredentials);
	} else {
		gitNotesPromise = Promise.resolve([]);
	}

	let gdriveNotesPromise;
	if (gdriveStore?.connected && typeof window.listNotesInGDrive === 'function') {
		gdriveNotesPromise = window.listNotesInGDrive();
	} else {
		gdriveNotesPromise = Promise.resolve([]);
	}

	const [s3Res, nostrRes, gitRes, gdriveRes] = await Promise.allSettled([
		promiseTimeout(s3NotesPromise),
		promiseTimeout(nostrNotesPromise),
		promiseTimeout(gitNotesPromise),
		promiseTimeout(gdriveNotesPromise)
	]);

	const s3Notes = s3Res.status === 'fulfilled' ? s3Res.value : [];
	const nostrNotes = nostrRes.status === 'fulfilled' ? nostrRes.value : [];
	const gitNotes = gitRes.status === 'fulfilled' ? gitRes.value : [];
	const gdriveNotes = gdriveRes.status === 'fulfilled' ? gdriveRes.value : [];

	const mergedNotes = new Map();

	s3Notes.forEach(note => mergedNotes.set(note.id, note));

	nostrNotes.forEach(note => {
		const existingNote = mergedNotes.get(note.id);
		const nostrLastModified = new Date(note.updatedAt || note.createdAt);

		if (!existingNote) {
			mergedNotes.set(note.id, { ...note, updatedAt: nostrLastModified, source: 'nostr' });
		} else {
			const s3LastModified = new Date(existingNote.updatedAt);
			if (nostrLastModified > s3LastModified) {
				mergedNotes.set(note.id, { ...note, updatedAt: nostrLastModified, source: 'nostr' });
			}
		}
	});

	gitNotes.forEach(note => {
		const existingNote = mergedNotes.get(note.id);
		const gitLastModified = new Date(note.updatedAt || note.createdAt);

		if (!existingNote) {
			mergedNotes.set(note.id, { ...note, updatedAt: gitLastModified, source: 'git' });
		} else {
			const existingLastModified = new Date(existingNote.updatedAt);
			if (gitLastModified > existingLastModified) {
				mergedNotes.set(note.id, { ...note, updatedAt: gitLastModified, source: 'git' });
			}
		}
	});

	gdriveNotes.forEach(note => {
		const existingNote = mergedNotes.get(note.id);
		const gdriveLastModified = new Date(note.updatedAt || note.createdAt);

		if (!existingNote) {
			mergedNotes.set(note.id, { ...note, updatedAt: gdriveLastModified, source: 'gdrive', fileId: note.fileId });
		} else {
			const existingLastModified = new Date(existingNote.updatedAt);
			if (gdriveLastModified > existingLastModified) {
				mergedNotes.set(note.id, { ...note, updatedAt: gdriveLastModified, source: 'gdrive', fileId: note.fileId });
			}
		}
	});

	return {
		mergedNotes: Array.from(mergedNotes.values()),
		s3Ids: new Set(s3Notes.map(n => n.id)),
		gitIds: new Set(gitNotes.map(n => n.id)),
		nostrIds: new Set(nostrNotes.map(n => n.id)),
		gdriveIds: new Set(gdriveNotes.map(n => n.id)),
		gdriveMap: new Map(gdriveNotes.map(n => [n.id, n]))
	};
}

async function listImages({credentials, nostrPrivateKey, nostrRelays}) {
	const s3ImagesPromise = listImagesInS3(credentials);

	let nostrImagesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrImagesPromise = window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey);
	} else {
		nostrImagesPromise = Promise.resolve([]);
	}

	const [s3Res, nostrRes] = await Promise.allSettled([
		promiseTimeout(s3ImagesPromise),
		promiseTimeout(nostrImagesPromise)
	]);

	const s3Images = s3Res.status === 'fulfilled' ? s3Res.value : [];
	const nostrImageRecords = nostrRes.status === 'fulfilled' ? nostrRes.value : [];

	const mergedImages = new Map();

	s3Images.forEach(image => mergedImages.set(image.id, image));

	nostrImageRecords.forEach(imageRecord => {
		if (!imageRecord.id) return;

		const existingImage = mergedImages.get(imageRecord.id);
		const nostrLastModified = new Date(imageRecord.updatedAt || imageRecord.createdAt);

		if (!existingImage) {
			mergedImages.set(imageRecord.id, { ...imageRecord, lastModified: nostrLastModified, source: 'nostr' });
		} else {
			const s3LastModified = new Date(existingImage.lastModified);
			if (nostrLastModified > s3LastModified) {
				mergedImages.set(imageRecord.id, { ...imageRecord, lastModified: nostrLastModified, source: 'nostr' });
			}
		}
	});

	return Array.from(mergedImages.values());
}

async function deleteNoteFromRemotes({noteId, credentials, nostrPrivateKey, nostrRelays, gdriveStore, gitCredentials, remoteMeta}) {
	const promises = [];

	// Remote deletions
	if (gdriveStore.connected && typeof window.deleteNoteFromGoogleDrive === 'function') {
		promises.push(window.deleteNoteFromGoogleDrive(noteId, remoteMeta));
	}

	if (credentials?.secretAccessKey) {
		promises.push(deleteNoteFromS3(noteId, credentials));
	}

	if ( nostrPrivateKey && nostrRelays ) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		promises.push(window.publishNoteDeletionToRelays(relays, nostrPrivateKey, noteId));
	}

	if (gitCredentials?.repoUrl && typeof window.deleteNoteFromGit === 'function') {
		promises.push(window.deleteNoteFromGit(noteId, gitCredentials));
	}

	await Promise.allSettled(promises);
}

async function deleteImageFromRemotes({imageId, credentials, nostrPrivateKey, nostrRelays}) {
	const promises = [];

	if (credentials?.secretAccessKey) {
		// Assuming a deleteImageFromS3 function exists or will be created in s3.js
		promises.push(deleteImageFromS3(imageId, credentials));
	}

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		// Assuming a function to publish deletion events for images exists, similar to note deletion
		promises.push(window.publishImageDeletionToRelays(relays, nostrPrivateKey, imageId));
	}

	await Promise.allSettled(promises);
}

async function verifyGoogleJwt(token, clientId) {
	try {
		const base64Url = token.split('.')[1];
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
			return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
		}).join(''));

		const decoded = JSON.parse(jsonPayload);

		// Basic check: ensure client ID matches (audience claim 'aud')
		if (decoded.aud !== clientId) {
			throw new Error('Invalid client ID in JWT.');
		}

		return decoded;
	} catch (error) {
		console.error('Error verifying JWT:', error);
		throw new Error('JWT verification failed: ' + error.message);
	}
}

function removeTrackingParams(url) {
	const trackingParams = [
		'utm_source',
		'utm_medium',
		'utm_campaign',
		'utm_term',
		'utm_content',
		'fbclid',
		'gclid',
		'msclkid',
		'mc_cid',
		'mc_eid',
	];

	try {
		const urlObject = new URL(url);
		let hasChanged = false;

		trackingParams.forEach(param => {
			if (urlObject.searchParams.has(param)) {
				urlObject.searchParams.delete(param);
				hasChanged = true;
			}
		});

		return hasChanged ? urlObject.toString() : url;
	} catch (error) {
		console.error('Invalid URL:', error);
		return url;
	}
}

function generateUniqueId(title) {
	return [
		title?.toLowerCase()?.replace(/[^a-z0-9\s]/g,'')?.replace(/\s/g, '-')?.slice(0, 80) || '',
		Date.now().toString(36).substr(4),
		Math.random().toString(36).substring(2, 6),
	].join('').trim();
}