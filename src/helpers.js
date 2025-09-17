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


// --- S3 Functions (Client-side AWS SDK v2) ---
// Assumes AWS SDK is loaded globally
const getS3ClientV2 = async (creds) => {
	const maxWaitTime = 30000; // 30 seconds
	const interval = 1000; // 1 second
	let elapsedTime = 0;

	while (!self.AWS && elapsedTime < maxWaitTime) {
		await new Promise(resolve => setTimeout(resolve, interval));
		elapsedTime += interval;
	}

	if (!self.AWS) {
		throw new Error('AWS SDK failed to load within 30 seconds.');
	}

	// The AWS object will be in the global scope (window or self)
	return new self.AWS.S3({
		region: creds.region || 'us-east-1',
		endpoint: creds.endpoint,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		s3ForcePathStyle: !!creds.endpoint,
	});
};

const getS3ObjectKey = (noteId, creds) => {
	const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
	return noteId.includes('images/') ? `${path}${noteId}` : `${path}${noteId}.json` ;
};

const uploadNoteToS3V2 = async (note, creds, nostrPrivateKey, nostrRelays) => {
	if (!creds?.secretAccessKey) return new Promise(resolve => resolve());

	const s3 = await getS3ClientV2(creds);
	const noteJson = JSON.stringify(note, null, 2);

	const params = {
		Bucket: creds.bucket,
		Key: getS3ObjectKey(note.id, creds),
		Body: noteJson,
		ContentType: 'application/json',
	};

	const s3Promise = s3.upload(params).promise();

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		await Promise.all([s3Promise, window.publishNoteToRelays(relays, nostrPrivateKey, note)]);
	} else {
		await s3Promise;
	}
};

const listNotesInS3V2 = async (creds, nostrPrivateKey, nostrRelays) => {
	if (!creds?.secretAccessKey) return [];

	const s3 = await getS3ClientV2(creds);
	const prefix = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
	let allNoteMetadata = [];
	let continuationToken = undefined;

	// 1. Fetch from S3
	do {
		const params = {
			Bucket: creds.bucket,
			Prefix: prefix,
			ContinuationToken: continuationToken,
		};

		try {
			const data = await s3.listObjectsV2(params).promise();
			const s3NoteMetadata = data.Contents?.map(item => {
				if (!item.Key || item.Key.endsWith('/') || item.Key.includes('/images/')) return null;

				return {
					id: item.Key.replace(prefix, '').replace('.json', ''),
					lastModified: item.LastModified,
					source: 's3'
				};
			}).filter(item => !!item) || [];

			allNoteMetadata = allNoteMetadata.concat(s3NoteMetadata);
			continuationToken = data.NextContinuationToken;
		} catch (err) {
			console.error("S3 List Error:", err);
			throw new Error(`Failed to list notes in S3: ${err.code} - ${err.message}`);
		}
	} while (continuationToken);

	const mergedNotes = new Map(); // id -> {noteMetadata}

	// Add S3 notes to the map
	allNoteMetadata.forEach(note => mergedNotes.set(note.id, note));

	// 2. Fetch from Nostr if configured
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		try {
			const nostrNotes = await window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey);
			nostrNotes.forEach(note => {
				const existingNote = mergedNotes.get(note.id);
				const nostrLastModified = new Date(note.updatedAt || note.createdAt);

				if (!existingNote) {
					// Note only exists on Nostr, add it
					mergedNotes.set(note.id, { ...note, lastModified: nostrLastModified, source: 'nostr' });
				} else {
					// Note exists on both, resolve conflict
					const s3LastModified = new Date(existingNote.lastModified);

					if (nostrLastModified > s3LastModified) {
						// Nostr is newer, prioritize Nostr
						mergedNotes.set(note.id, { ...note, lastModified: nostrLastModified, source: 'nostr' });
					}
					// If S3 is newer or equal, S3 is already in the map, so do nothing (prioritize S3 on equal timestamp)
				}
			});
		} catch (error) {
			console.error("Nostr List Error:", error);
			// Continue with S3 notes even if Nostr fails
		}
	}

	return Array.from(mergedNotes.values());
};

const downloadNoteFromS3V2 = async (noteId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3ClientV2(creds);
	const key = getS3ObjectKey(noteId, creds);
	const params = {
		Bucket: creds.bucket,
		Key: key,
	};

	const data = await s3.getObject(params).promise();
	if (data.Body) {
		const str = new TEXT_DECODER().decode(data.Body);
		return JSON.parse(str);
	} else {
		throw new Error('Downloaded note has no body');
	}
};

const getNoteMetadataFromS3V2 = async (noteId, creds) => {
	try {
		if (!creds?.secretAccessKey) return;

		const s3 = await getS3ClientV2(creds);
		const key = getS3ObjectKey(noteId, creds);
		const params = {
			Bucket: creds.bucket,
			Key: key,
		};

		const data = await s3.headObject(params).promise();
		return {
			lastModified: data.LastModified,
			source: 's3'
		};
	} catch (error) {
		if (error.code === 'NotFound') {
			// The object does not exist in S3.
			return null;
		}
		// For other errors, log and re-throw to allow for more specific handling upstream.
		console.error(`S3 HeadObject Error for note ${noteId}:`, error);
		throw new Error(`Failed to get note metadata from S3: ${error.code || error.message}`);
	}
};

const deleteNoteFromS3V2 = async (noteId, creds, nostrPrivateKey, nostrRelays) => {
	if (!creds?.secretAccessKey) return new Promise(resolve => resolve());

	const s3 = await getS3ClientV2(creds);
	const key = getS3ObjectKey(noteId, creds);
	const params = {
		Bucket: creds.bucket,
		Key: key,
	};

	const s3Promise = s3.deleteObject(params).promise();

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		await Promise.all([s3Promise, window.publishNoteDeletionToRelays(relays, nostrPrivateKey, noteId)]);
	} else {
		await s3Promise;
	}
};

// --- S3 Functions for Images ---
const getImageS3ObjectKey = (imageId, imageType, creds) => {
	const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
	const extension = imageType.split('/')[1] || 'bin';
	return `${path}images/${imageId}.${extension}`;
};

const uploadImageToS3V2 = async (imageRecord, creds, nostrPrivateKey, nostrRelays) => {
	if (!creds?.secretAccessKey) return new Promise(resolve => resolve());

	const s3 = await getS3ClientV2(creds);
	const key = getImageS3ObjectKey(imageRecord.id, imageRecord.blob.type, creds);

	const params = {
		Bucket: creds.bucket,
		Key: key,
		Body: imageRecord.blob,
		ContentType: imageRecord.blob.type,
	};
	const s3Promise = s3.upload(params).promise();

	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		const imageUrl = s3.getSignedUrl('getObject', { Bucket: creds.bucket, Key: key });
		const imageRecordWithUrl = { ...imageRecord, url: imageUrl };
		await Promise.all([s3Promise, window.publishImageToRelays(relays, nostrPrivateKey, imageRecordWithUrl)]);
	} else {
		await s3Promise;
	}
};

const downloadImageFromS3V2 = async (imageId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3ClientV2(creds);
	const prefix = `${creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : ''}images/${imageId}`;

	try {
		const listParams = {
			Bucket: creds.bucket,
			Prefix: prefix,
			MaxKeys: 1,
		};
		const listData = await s3.listObjectsV2(listParams).promise();

		if (listData.Contents && listData.Contents.length > 0) {
			const exactKey = listData.Contents[0].Key;
			const getParams = {
				Bucket: creds.bucket,
				Key: exactKey,
			};
			const data = await s3.getObject(getParams).promise();

			if (data.Body) {
				const contentType = data.ContentType || 'application/octet-stream';
				return new Blob([data.Body], { type: contentType });
			} else {
				throw new Error('Downloaded image has no body');
			}
		} else {
			throw new Error(`Image with ID ${imageId} not found in S3.`);
		}
	} catch (error) {
		console.error(`S3 Download Error for image ${imageId}:`, error);
		throw new Error(`Failed to download image from S3: ${error.code || error.message}`);
	}
};

const listImagesInS3V2 = async (creds, nostrPrivateKey, nostrRelays) => {
	if (!creds?.secretAccessKey) return [];

	const s3 = await getS3ClientV2(creds);
	const prefix = `${creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : ''}images/`;
	let allImageMetadata = [];
	let continuationToken = undefined;

	// 1. Fetch from S3
	do {
		const params = {
			Bucket: creds.bucket,
			Prefix: prefix,
			ContinuationToken: continuationToken,
		};

		try {
			const data = await s3.listObjectsV2(params).promise();
			const s3ImageMetadata = data.Contents?.map(item => {
				if (!item.Key || item.Key.endsWith('/')) return null;

				return {
					id: item.Key.replace(prefix, '').split('.')[0],
					lastModified: item.LastModified,
					source: 's3'
				};
			}).filter(item => !!item) || [];

			allImageMetadata = allImageMetadata.concat(s3ImageMetadata);
			continuationToken = data.NextContinuationToken;
		} catch (err) {
			console.error("S3 List Images Error:", err);
			throw new Error(`Failed to list images in S3: ${err.code} - ${err.message}`);
		}
	} while (continuationToken);

	const mergedImages = new Map(); // id -> {imageMetadata}

	// Add S3 images to the map
	allImageMetadata.forEach(image => mergedImages.set(image.id, image));

	// 2. Fetch from Nostr if configured
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		try {
			const nostrImageRecords = await window.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey);
			nostrImageRecords.forEach(imageRecord => {
				if (!imageRecord.id) return; // Skip if no ID

				const existingImage = mergedImages.get(imageRecord.id);
				const nostrLastModified = new Date(imageRecord.updatedAt || imageRecord.createdAt);

				if (!existingImage) {
					// Image only exists on Nostr, add it
					mergedImages.set(imageRecord.id, { ...imageRecord, lastModified: nostrLastModified, source: 'nostr' });
				} else {
					// Image exists on both, resolve conflict
					const s3LastModified = new Date(existingImage.lastModified);

					if (nostrLastModified > s3LastModified) {
						// Nostr is newer, prioritize Nostr
						mergedImages.set(imageRecord.id, { ...imageRecord, lastModified: nostrLastModified, source: 'nostr' });
					}
					// If S3 is newer or equal, S3 is already in the map, so do nothing (prioritize S3 on equal timestamp)
				}
			});
		} catch (error) {
			console.error("Nostr List Images Error:", error);
			// Continue with S3 images even if Nostr fails
		}
	}

	return Array.from(mergedImages.values());
};


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

async function apiSyncImages(encryptedSettings, userId, nostrPrivateKey, nostrRelays) {
	try {
		const credentials = await decryptSettings(encryptedSettings, userId);
		if (!credentials) {
			throw new Error('Failed to decrypt credentials.');
		}

		// 1. Upload unsynced local images to S3
		let uploadedImageCount = 0;
		const unsyncedImages = await getUnsyncedImagesDB();
		for (const image of unsyncedImages) {
			await uploadImageToS3V2(image, credentials, nostrPrivateKey, nostrRelays);
			try {
				console.log(`Attempting to mark image ${image.id} as synced.`);
				await updateImageDB({ ...image, synced: true }); // Mark as synced in DB
				console.log(`Image ${image.id} successfully marked as synced.`);
			} catch (dbError) {
				console.error(`Failed to mark image ${image.id} as synced in DB:`, dbError);
				// Optionally, re-throw or handle this error to prevent further sync issues
			}
			uploadedImageCount++;
		}

		// 2. Download missing images from S3
		let downloadedImageCount = 0;
		const allNotes = await getNotesDB();
		const remoteImageKeys = await listImagesInS3V2(credentials, nostrPrivateKey, nostrRelays);
		const remoteImageIds = new Set(remoteImageKeys.map(x => x.id));

		const imageIdRegex = /\/images\/([a-f0-9-]+)/g;
		const referencedImageIds = new Set();

		for (const note of allNotes) {
			let match;
			while ((match = imageIdRegex.exec(note.content)) !== null) {
				referencedImageIds.add(match[1]);
			}
		}

		for (const imageId of referencedImageIds) {
			const localImage = await getImageDB(imageId);
			if (!localImage && remoteImageIds.has(imageId)) {
				console.log(`Image ${imageId} not found locally, downloading from S3...`);
				try {
					const imageBlob = await downloadImageFromS3V2(imageId, credentials);
					if (imageBlob) {
						await addImageDB({ id: imageId, blob: imageBlob, synced: true });
						downloadedImageCount++;
					}
				} catch (downloadError) {
					console.error(`Failed to download image ${imageId} from S3:`, downloadError);
				}
			}
		}

		return { success: true, uploadedImageCount, downloadedImageCount };
	} catch (error) {
		console.error('apiSyncImages error:', error);
		return { success: false, error: error.message };
	}
}

async function apiSyncNotes(encryptedSettings, userId, localNotes, deletedNoteIds, lastSync, nostrPrivateKey, nostrRelays) {
	try {
		const credentials = await decryptSettings(encryptedSettings, userId);
		if (!credentials) {
			throw new Error('Failed to decrypt credentials.');
		}

		if (!credentials.secretAccessKey) return {
			success: false,
			error: 'S3 credentials is missing',
		};

		// --- Step 1: Get remote state FIRST ---
		const remoteNoteMetadata = await listNotesInS3V2(credentials, nostrPrivateKey, nostrRelays);
		const remoteMetaMap = new Map(remoteNoteMetadata.map(m => [m.id, m]));

		// --- Step 2: Determine which notes to upload ---
		const notesToUpload = localNotes.filter(localNote => {
			// Don't upload notes that are slated for deletion.
			if (deletedNoteIds.includes(localNote.id)) return false;

			const remoteMeta = remoteMetaMap.get(localNote.id);
			if (!remoteMeta) {
				// Note doesn't exist remotely, so it's new. Upload it.
				return true;
			}

			// Note exists remotely. Only upload if local is newer.
			const remoteDate = new Date(remoteMeta.lastModified);
			const localDate = new Date(localNote.updatedAt);
			return localDate > remoteDate;
		});

		const uploadPromises = notesToUpload.map(note => uploadNoteToS3V2(note, credentials, nostrPrivateKey, nostrRelays));

		// --- Step 3: Determine which notes to delete from S3 ---
		const deletePromises = deletedNoteIds.map(noteId => deleteNoteFromS3V2(noteId, credentials, nostrPrivateKey, nostrRelays));

		// --- Step 4: Execute uploads and deletes ---
		const uploadAndDeletePromises = [...uploadPromises, ...deletePromises];
		const uploadAndDeleteResults = await Promise.allSettled(uploadAndDeletePromises);

		let successfulUploadedCount = 0;
		let successfulDeletedCount = 0;
		uploadAndDeleteResults.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (index < uploadPromises.length) {
					successfulUploadedCount++;
				} else {
					successfulDeletedCount++;
				}
			} else {
				console.error('Sync error during upload/delete:', result.reason);
			}
		});


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
				const remoteDate = new Date(remoteMeta.lastModified);
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

		const downloadPromises = notesToDownload.map(remoteMeta => downloadNoteFromS3V2(remoteMeta.id, credentials));
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
			updatedNotes, // downloaded notes
			notesToDeleteLocally,
			finalRemoteIds: Array.from(remoteNoteIds)
		};

	} catch (error) {
		console.error('apiSyncNotes error:', error);
		return { success: false, error: error.message };
	}
}

async function apiDeleteNote(encryptedSettings, userId, noteId, nostrPrivateKey, nostrRelays) {
	try {
		const credentials = await decryptSettings(encryptedSettings, userId);
		if (!credentials) {
			throw new Error('Failed to decrypt credentials.');
		}
		await deleteNoteFromS3V2(noteId, credentials, nostrPrivateKey, nostrRelays);
		return { success: true };
	} catch (error) {
		console.error('apiDeleteNote error:', error);
		return { success: false, error: error.message };
	}
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
