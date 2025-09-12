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
async function getKey(userId, salt) {
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

const deleteNoteFromS3V2 = async (noteId, creds, nostrPrivateKey, nostrRelays) => {
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
