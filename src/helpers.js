// --- Environment-agnostic Globals ---
const BTOA = self.btoa;
const ATOB = self.atob;
const CRYPTO = self.crypto;
const TEXT_ENCODER = TextEncoder;
const TEXT_DECODER = TextDecoder;
const FETCH = self.fetch;
const INDEXED_DB = self.indexedDB;

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

const saveEncryptedSettingsDB = (encryptedSettings, userId) => performDBOperation(S3_CREDENTIALS_STORE, 'readwrite', 'put', { id: 's3-credentials', data: { encryptedSettings, userId } });
const getEncryptedSettingsDB = async () => {
	const result = await performDBOperation(S3_CREDENTIALS_STORE, 'readonly', 'get', 's3-credentials');
	return result ? result.data : null;
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

async function synchronizeImages(encryptedSettings, userId, nostrPrivateKey, nostrRelays) {
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
				await uploadImage(image, credentials, nostrPrivateKey, nostrRelays);
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
		const remoteImageMetas = await listImages(credentials, nostrPrivateKey, nostrRelays);
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

		for (const orphanId of remoteOrphanIds) {
			try {
				await deleteImageFromRemotes(orphanId, credentials, nostrPrivateKey, nostrRelays);
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

async function synchronize(isSilent, credentials, nostrPrivateKey, nostrRelays, gdriveStore, deletedNoteIds, lastSync, notes) {
	try {
		if (gdriveStore.connected && typeof syncNotesWithGoogleDrive === 'function') {
			await syncNotesWithGoogleDrive(isSilent, deletedNoteIds)
			return { success: true, gdrive: true };
		}

		if (!credentials.secretAccessKey) return {
			success: false,
			error: 'S3 credentials is missing',
		};

		// --- Step 1: Get remote state FIRST ---
		const remoteNoteMetadata = await listNotes(credentials, nostrPrivateKey, nostrRelays, lastSync);
		const remoteMetaMap = new Map(remoteNoteMetadata.map(m => [m.id, m]));

		// --- Step 2: Determine which notes to upload ---
		const localNotes = notes || await getNotesDB();
		const notesToUpload = localNotes.filter(localNote => {
			// Don't upload notes that are slated for deletion.
			if (deletedNoteIds.includes(localNote.id)) return false;

			const remoteMeta = remoteMetaMap.get(localNote.id);
			if (!remoteMeta) {
				// Note doesn't exist remotely, so it's new. Upload it.
				return true;
			}

			// Note exists remotely. Only upload if local is newer.
			const remoteDate = new Date(remoteMeta.updatedAt);
			const localDate = new Date(localNote.updatedAt);
			return localDate > remoteDate;
		});

		const uploadPromises = notesToUpload.map(note => uploadNote(note, credentials, nostrPrivateKey, nostrRelays));

		// --- Step 3: Determine which notes to delete from S3 ---
		const deletePromises = deletedNoteIds.map(noteId => deleteNoteFromRemotes(noteId, credentials, nostrPrivateKey, nostrRelays, gdriveStore));

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
		const uploadedNoteIds = new Set(notesToUpload.map(n => n.id));
		for (const localNoteId of allLocalNotesMap.keys()) {
			if (!remoteNoteIds.has(localNoteId) && !deletedNoteIds.includes(localNoteId) && !uploadedNoteIds.has(localNoteId)) {
				// This note exists locally but not remotely, and we didn't delete it.
				// It must have been deleted on another device. Delete it locally.
				notesToDeleteLocally.push(localNoteId);
			}
		}

		const downloadPromises = notesToDownload.map(remoteMeta => downloadNoteFromS3(remoteMeta.id, credentials));
		const downloadResults = await Promise.allSettled(downloadPromises);

		const updatedNotes = [];
		downloadResults.forEach((result, idx) => {
			if (result.status === 'fulfilled' && result.value) {
				updatedNotes.push(result.value);
			} else if (result.status === 'rejected') {
				console.log('Sync status S3 (specified key does not exist):', notesToDownload[idx].id, result.reason.message);
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

async function uploadNote(note, creds, nostrPrivateKey, nostrRelays) {
	await Promise.allSettled([
		uploadNoteToS3(note, creds),
		window.publishNoteToRelays(nostrRelays.split(',').map(r => r.trim()), nostrPrivateKey, note)
	]);
}

async function listNotes(creds, nostrPrivateKey, nostrRelays, sinceTimestamp) {
	const s3NotesPromise = listNotesInS3(creds, sinceTimestamp);

	let nostrNotesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrNotesPromise = window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey, sinceTimestamp);
	} else {
		nostrNotesPromise = Promise.resolve([]);
	}

	const [s3Notes, nostrNotes] = await Promise.all([s3NotesPromise, nostrNotesPromise]);

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

	return Array.from(mergedNotes.values());
}

async function deleteNoteFromRemotes(noteId, creds, nostrPrivateKey, nostrRelays, gdriveStore) {
	const promises = [];

	// Remote deletions
	if (gdriveStore.connected && typeof deleteNoteFromGoogleDrive === 'function') {
		promises.push(deleteNoteFromGoogleDrive(noteId));
	}

	if (creds?.secretAccessKey) {
		promises.push(deleteNoteFromS3(noteId, creds));
	}

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		promises.push(window.publishNoteDeletionToRelays(relays, nostrPrivateKey, noteId));
	}

	await Promise.all(promises);
}

async function deleteImageFromRemotes(imageId, creds, nostrPrivateKey, nostrRelays) {
	const promises = [];

	if (creds?.secretAccessKey) {
		// Assuming a deleteImageFromS3 function exists or will be created in s3.js
		promises.push(deleteImageFromS3(imageId, creds));
	}

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		// Assuming a function to publish deletion events for images exists, similar to note deletion
		promises.push(window.publishImageDeletionToRelays(relays, nostrPrivateKey, imageId));
	}

	await Promise.all(promises);
}

async function uploadImage(imageRecord, creds, nostrPrivateKey, nostrRelays) {
	const promises = [];

	if (creds?.secretAccessKey) {
		promises.push(uploadImageToS3(imageRecord, creds));
	}

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		// a signed URL is not available with V2 of the SDK, so we'll just publish the record without the URL
		promises.push(window.publishImageToRelays(relays, nostrPrivateKey, imageRecord));
	}

	await Promise.all(promises);
}

async function listImages(creds, nostrPrivateKey, nostrRelays) {
	const s3ImagesPromise = listImagesInS3(creds);

	let nostrImagesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrImagesPromise = window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey);
	} else {
		nostrImagesPromise = Promise.resolve([]);
	}

	const [s3Images, nostrImageRecords] = await Promise.all([s3ImagesPromise, nostrImagesPromise]);

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
