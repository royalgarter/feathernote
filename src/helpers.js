// --- Environment-agnostic Globals ---
_GLOBAL = _GLOBAL || (typeof window !== 'undefined' ? window : self);

const BTOA = _GLOBAL.btoa;
const ATOB = _GLOBAL.atob;
const CRYPTO = _GLOBAL.crypto;
const TEXT_ENCODER = TextEncoder;
const TEXT_DECODER = TextDecoder;
const FETCH = _GLOBAL.fetch;
const INDEXED_DB = _GLOBAL.indexedDB;

const promiseTimeout = (p, ms=30e3) => Promise.race([
	p,
	new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
]);

const pad = (num) => num.toString().padStart(2, '0');

const loadScript = (src, id) => {
	if (typeof document === 'undefined') return Promise.resolve();
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
	if (typeof document === 'undefined') return Promise.resolve();
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

function hashColor(text) {
	return ((hashText(text) || 128) % 256) + 0;
}

function hashText(text) {
	if (!text?.length) return 0;

	let hash = 5381; // djb2 hash function initial value
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) + hash) + text.charCodeAt(i); // hash * 33 + char
	}
	hash = Math.abs(hash); // Ensure hash is positive

	return hash;
}

async function calculateHash(text) {
	const enc = new TEXT_ENCODER();
	const data = enc.encode(text);
	const hashBuffer = await CRYPTO.subtle.digest('SHA-256', data);
	return bufferToBase64(hashBuffer);
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
const DB_VERSION = 5;
const NOTE_STORE = 'notes';
const SHARED_CONTENT_STORE = 'shared-content';
const IMAGE_STORE = 'images';
const S3_CREDENTIALS_STORE = 's3-credentials';
const META_STORE = 'meta';

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

			if (event.oldVersion < 5) {
				if (!db.objectStoreNames.contains(META_STORE)) {
					db.createObjectStore(META_STORE, { keyPath: 'id' });
					console.log(`Object store '${META_STORE}' created.`);
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
	if (typeof localStorage !== 'undefined') localStorage.setItem('s3-credentials', JSON.stringify({ encryptedSettings, userId }));
	performDBOperation(S3_CREDENTIALS_STORE, 'readwrite', 'put', { id: 's3-credentials', data: { encryptedSettings, userId } });
};
const getEncryptedSettingsDB = async () => {
	try {
		const result = await performDBOperation(S3_CREDENTIALS_STORE, 'readonly', 'get', 's3-credentials');
		if (result && result.data) {
			// If we get data from IndexedDB, make sure localStorage is also up-to-date.
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('s3-credentials', JSON.stringify(result.data));
			}
			return result.data;
		}
	} catch (error) {
		console.warn('Could not fetch settings from IndexedDB, falling back to localStorage.', error);
	}

	// If IndexedDB fails or returns no data, try localStorage.
	if (typeof localStorage !== 'undefined') {
		const fromStorage = localStorage.getItem('s3-credentials');
		if (fromStorage) {
			try {
				return JSON.parse(fromStorage);
			} catch (error) {
				console.error('Could not parse settings from localStorage.', error);
				return null;
			}
		}
	}

	return null;
};

const getMetaDB = (id) => performDBOperation(META_STORE, 'readonly', 'get', id).then(res => res ? res.value : null);
const setMetaDB = (id, value) => performDBOperation(META_STORE, 'readwrite', 'put', { id, value });

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
const getNoteByTitleDB = async (title) => {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([NOTE_STORE], 'readonly');
		const store = transaction.objectStore(NOTE_STORE);
		const request = store.openCursor();
		request.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				if (cursor.value.title === title) {
					resolve(cursor.value);
				} else {
					cursor.continue();
				}
			} else {
				resolve(null);
			}
		};
		request.onerror = (event) => reject(event.target.error);
	});
};
const addNoteDB = (note) => performDBOperation(NOTE_STORE, 'readwrite', 'add', note);
const updateNoteDB = (note) => performDBOperation(NOTE_STORE, 'readwrite', 'put', note);
const deleteNoteDB = (id) => performDBOperation(NOTE_STORE, 'readwrite', 'delete', id);

const getSharedContentDB = () => performDBOperation(SHARED_CONTENT_STORE, 'readonly', 'getAll');
const addSharedContentDB = (item) => performDBOperation(SHARED_CONTENT_STORE, 'readwrite', 'add', item);
const clearSharedContentDB = () => performDBOperation(SHARED_CONTENT_STORE, 'readwrite', 'clear');

async function syncDeletedNoteIds({deletedNoteIds, credentials, gitCredentials, gdriveStore}) {
	const remoteLists = [];

	// --- Download Phase ---
	if (credentials?.secretAccessKey) {
		remoteLists.push(await downloadDeletedNotesFromS3(credentials));
	}
	if (gitCredentials?.repoUrl) {
		remoteLists.push(await _GLOBAL.downloadDeletedNotesFromGit(gitCredentials));
	}
	if (gdriveStore?.connected) {
		remoteLists.push(await _GLOBAL.downloadDeletedNotesFromGoogleDrive());
	}
	if (credentials?.pinataJwt || credentials?.pinataApiKey) {
		remoteLists.push(await window.downloadDeletedNotesFromIPFS(credentials));
	}

	// --- Merge Phase ---
	// 1. Find the master list (most recent)
	let masterList = { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };
	if (remoteLists.length > 0) {
		masterList = remoteLists.reduce((newest, current) => {
			return new Date(current.updatedAt) > new Date(newest.updatedAt) ? current : newest;
		});
	}

	// 2. Merge local and other remote IDs into the master list
	const initialMasterIds = new Set(masterList.ids);
	let finalIds = new Set(initialMasterIds);
	
	// Add local IDs
	deletedNoteIds.forEach(id => finalIds.add(id));
	
	// Add IDs from other non-master remote lists
	remoteLists.forEach(list => {
		if (list !== masterList) {
			list.ids.forEach(id => finalIds.add(id));
		}
	});

	const finalIdArray = Array.from(finalIds).slice(-100);

	// --- Upload Phase ---
	// 3. Only upload if the list has actually changed
	const hasChanged = finalIdArray.length !== initialMasterIds.size || !finalIdArray.every(id => initialMasterIds.has(id));

	if (hasChanged) {
		console.log('Deleted notes list has changed, uploading to all providers.');
		const uploadPromises = [];
		if (credentials?.secretAccessKey) {
			uploadPromises.push(uploadDeletedNotesToS3(finalIdArray, credentials));
		}
		if (gitCredentials?.repoUrl) {
			uploadPromises.push(_GLOBAL.uploadDeletedNotesToGit(finalIdArray, gitCredentials));
		}
		if (gdriveStore?.connected) {
			uploadPromises.push(_GLOBAL.uploadDeletedNotesToGoogleDrive(finalIdArray));
		}
		if (credentials?.pinataJwt || credentials?.pinataApiKey) {
			uploadPromises.push(window.uploadDeletedNotesToIPFS(finalIdArray, credentials));
		}
		await Promise.allSettled(uploadPromises);
	} else {
		console.log('Deleted notes list is already in sync. No upload needed.');
	}

	return { finalIdArray, hasChanged };
}

async function synchronize({notes, deletedNoteIds, isSilent, credentials, nostrPrivateKey, nostrRelays, gdriveStore, lastSync, gitCredentials}) {
	try {
		// Initialize Git if configured
		if (gitCredentials?.repoUrl) {
			if (typeof _GLOBAL.initGit === 'function') {
				await _GLOBAL.initGit(gitCredentials);
			}
		}

		if (!credentials.secretAccessKey && !gitCredentials?.repoUrl && !gdriveStore?.connected && !credentials.pinataJwt && !credentials.pinataApiKey) return {
			success: false,
			error: 'No sync provider configured (S3, Git, IPFS, or GDrive)',
		};

		// --- Step 0: Sync Deleted IDs ---
		const { finalIdArray: effectiveDeletedNoteIds, hasChanged: deletedListChanged } = await syncDeletedNoteIds({deletedNoteIds, credentials, gitCredentials, gdriveStore});

		// --- Step 1: Get remote state FIRST ---
		const { mergedNotes: remoteNoteMetadata, s3Ids, gitIds, nostrIds, gdriveIds, ipfsIds, s3Map, gitMap, nostrMap, gdriveMap, ipfsMap, listingSucceeded } = await listNotes({credentials, nostrPrivateKey, nostrRelays, lastSync, gitCredentials, gdriveStore});
		const remoteMetaMap = new Map(remoteNoteMetadata.map(m => [m.id, m]));

		// --- Step 2: Determine which notes to upload ---
		const isPartialSync = Array.isArray(notes);
		const localNotes = notes || await getNotesDB();
		const notesToUpload = localNotes.filter(localNote => {
			// Don't upload notes that are slated for deletion.
			if (effectiveDeletedNoteIds.includes(localNote.id)) return false;

			const remoteMeta = remoteMetaMap.get(localNote.id);
			const localDate = new Date(localNote.updatedAt);
			const remoteDate = remoteMeta ? new Date(remoteMeta.updatedAt) : null;

			// If any remote is strictly newer, don't push the local version yet.
			// We'll download the remote version later in this sync cycle.
			if (remoteDate && localDate < remoteDate) return false;

			// We upload if it's missing from ANY active sync provider OR if local is newer than ANY provider's version.
			// (Note: Since localDate >= remoteDate, and remoteDate is the newest remote, 
			// if localDate > remoteDate, it's newer than ALL remotes. 
			// if localDate == remoteDate, it might still be newer than SOME remotes if they are inconsistent).

			if (gitCredentials?.repoUrl) {
				const gitMeta = gitMap.get(localNote.id);
				if (!gitMeta || localDate > new Date(gitMeta.updatedAt || gitMeta.createdAt)) return true;
			}
			if (credentials.secretAccessKey) {
				const s3Meta = s3Map.get(localNote.id);
				if (!s3Meta || localDate > new Date(s3Meta.updatedAt)) return true;
			}
			if (nostrPrivateKey) {
				const nostrMeta = nostrMap.get(localNote.id);
				if (!nostrMeta || localDate > new Date(nostrMeta.updatedAt || nostrMeta.createdAt)) return true;
			}
			if (gdriveStore?.connected) {
				const gdriveMeta = gdriveMap.get(localNote.id);
				if (!gdriveMeta || localDate > new Date(gdriveMeta.updatedAt || gdriveMeta.createdAt)) return true;
			}
			if (credentials.pinataJwt || credentials.pinataApiKey) {
				const ipfsMeta = ipfsMap.get(localNote.id);
				if (!ipfsMeta || localDate > new Date(ipfsMeta.updatedAt)) return true;
			}

			return false;
		});

		const uploadPromises = notesToUpload.map(note => uploadNote({
			note, credentials, nostrPrivateKey, nostrRelays, gitCredentials, gdriveStore,
			s3Map, gitMap, nostrMap, gdriveMap, ipfsMap
		}));


		// --- Step 3: Determine which notes to delete from Remotes ---
		const deletePromises = effectiveDeletedNoteIds.map(noteId => {
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
					successfulDeletedIds.push(effectiveDeletedNoteIds[deletedIdIndex]);
				}
			} else {
				console.error('Sync error during upload/delete:', result.reason);
			}
		});
		const successfulDeletedCount = successfulDeletedIds.length;
		
		// Finish Git Sync (Commit and Push) if configured
		if (gitCredentials?.repoUrl) {
			if (typeof _GLOBAL.finishGitSync === 'function') {
				// This will check for staged changes, commit if necessary, and push
				await _GLOBAL.finishGitSync(gitCredentials);
			}
		}


		// --- Step 5: Determine which notes to download or delete locally ---
		const notesToDownload = [];
		const notesToDeleteLocally = [];
		const allLocalNotesMap = new Map(localNotes.map(n => [n.id, n]));

		// Find notes updated remotely
		for (const remoteMeta of remoteNoteMetadata) {
			if (isPartialSync && !allLocalNotesMap.has(remoteMeta.id)) continue;

			const localNote = allLocalNotesMap.get(remoteMeta.id);
			if (!localNote) {
				// Note exists on remote but not local, and isn't in the local delete list. Download it.
				if (!effectiveDeletedNoteIds.includes(remoteMeta.id)) {
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
		
		if (!isPartialSync) {
			const locallyDeletedNoteIds = new Set(effectiveDeletedNoteIds);
			const uploadedNoteIds = new Set(notesToUpload.map(n => n.id));

			// Create a set of all local note IDs for easier checking
			const localNoteIds = new Set(allLocalNotesMap.keys());

			// Identify notes that should be deleted locally:
			const idsToDeleteLocally = [...localNoteIds].filter(noteId => {
				// 1. If it's in our known deleted list (synced via deleted-notes.json), it must go.
				if (locallyDeletedNoteIds.has(noteId)) return true;

				// 2. If it's gone from ALL remotes AND we successfully listed all remotes AND it's not a new local note.
				if (listingSucceeded && !remoteNoteIds.has(noteId) && !uploadedNoteIds.has(noteId)) {
					return true;
				}

				return false;
			});

			notesToDeleteLocally.push(...idsToDeleteLocally);
		}

		const downloadPromises = notesToDownload.map(remoteMeta => {
			if (remoteMeta.source === 'git') {
				// We already have the content from listNotesInGit? 
				// listNotesInGit returns full note objects with content!
				// So we don't need to download again. We just return it.
				return Promise.resolve(remoteMeta);
			} else if (remoteMeta.source === 'nostr') {
				return Promise.resolve(remoteMeta); // Nostr also returns full event/note
			} else if (remoteMeta.source === 'gdrive') {
				return _GLOBAL.downloadNoteFromGDrive(remoteMeta.fileId, remoteMeta.id);
			} else if (remoteMeta.source === 'ipfs') {
				return _GLOBAL.downloadNoteFromIPFS(remoteMeta, credentials);
			} else {
				return downloadNoteFromS3(remoteMeta, credentials);
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
			finalRemoteIds: Array.from(remoteNoteIds),
			effectiveDeletedNoteIds
		};
	} catch (error) {
		console.error('synchronize error:', error);
		return { success: false, error: error.message };
	}
}

async function synchronizeImages({encryptedSettings, userId, nostrPrivateKey, nostrRelays}) {
	try {
		let credentials = await decryptSettings(encryptedSettings, userId);
		if (!credentials) {
			throw new Error('Failed to decrypt credentials.');
		}

		// 1. Upload unsynced local images
		let uploadedImageCount = 0;
		let unsyncedImages = await getUnsyncedImagesDB();
		for (let image of unsyncedImages) {
			try {
				await uploadImage({image, credentials, nostrPrivateKey, nostrRelays});
				await updateImageDB({ ...image, synced: true });
				uploadedImageCount++;
			} catch (uploadError) {
				console.error(`Failed to upload or mark image ${image.id} as synced:`, uploadError);
			}
		}

		// 2. Determine all referenced image IDs from all notes
		let allNotes = await getNotesDB();
		let imageIdRegex = /\/images\/([\w-]+)/g;
		let referencedImageIds = new Set();
		for (let note of allNotes) {
			let match;
			while ((match = imageIdRegex.exec(note.content)) !== null) {
				referencedImageIds.add(match[1]);
			}
		}

		// 3. Download missing referenced images
		let downloadedImageCount = 0;
		let remoteImageMetas = await listImages({credentials, nostrPrivateKey, nostrRelays});
		let remoteImageIds = new Set(remoteImageMetas.map(x => x.id));

		for (let imageId of referencedImageIds) {
			let localImage = await getImageDB(imageId);
			if (!localImage && remoteImageIds.has(imageId)) {
				console.log(`Image ${imageId} not found locally, downloading...`);
				try {
					let imageBlob = await downloadImageFromS3(imageId, credentials);
					if (imageBlob) {
						console.log(`Image ${imageId} downloaded`);
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
		let allLocalImages = await performDBOperation(IMAGE_STORE, 'readonly', 'getAll');
		let localOrphanIds = allLocalImages
			.filter(img => !referencedImageIds.has(img.id))
			.map(img => img.id);

		for (let orphanId of localOrphanIds) {
			await deleteImageDB(orphanId);
			deletedOrphanCount++;
		}

		// GC Remote (S3/Nostr)
		let remoteOrphanIds = remoteImageMetas
			.filter(meta => !referencedImageIds.has(meta.id))
			.map(meta => meta.id);

		remoteOrphanIds = []; // Temporary disable clean orphan images
		for (let imageId of remoteOrphanIds) {
			try {
				await deleteImageFromRemotes({imageId, credentials, nostrPrivateKey, nostrRelays});
				// We count this even if only one of the remotes succeeds.
				// To avoid double counting with local, we only increment if it wasn't a local orphan.
				if (!localOrphanIds.includes(imageId)) {
					deletedOrphanCount++;
				}
			} catch (err) {
				console.error(`Failed to delete remote orphan image ${imageId}:`, err);
			}
		}

		return { success: true, uploadedImageCount, downloadedImageCount, deletedOrphanCount };
	} catch (error) {
		console.error('synchronizeImages error:', error);
		return { success: false, error: error.message };
	}
}

async function uploadNote({note, credentials, nostrPrivateKey, nostrRelays, gitCredentials, gdriveStore, s3Map, gitMap, nostrMap, gdriveMap, ipfsMap}) {
	const localDate = new Date(note.updatedAt);

	const shouldUploadToS3 = credentials.secretAccessKey && (!s3Map.has(note.id) || localDate > new Date(s3Map.get(note.id).updatedAt));
	const shouldUploadToNostr = nostrPrivateKey && (!nostrMap.has(note.id) || localDate > new Date(nostrMap.get(note.id).updatedAt || nostrMap.get(note.id).createdAt));
	const shouldUploadToGit = gitCredentials?.repoUrl && typeof _GLOBAL.uploadNoteToGit === 'function' && (!gitMap.has(note.id) || localDate > new Date(gitMap.get(note.id).updatedAt || gitMap.get(note.id).createdAt));
	const shouldUploadToGDrive = gdriveStore?.connected && typeof _GLOBAL.uploadNoteToGoogleDrive === 'function' && (!gdriveMap.has(note.id) || localDate > new Date(gdriveMap.get(note.id).updatedAt || gdriveMap.get(note.id).createdAt));
	const shouldUploadToIPFS = (credentials.pinataJwt || credentials.pinataApiKey) && typeof _GLOBAL.uploadNoteToIPFS === 'function' && (!ipfsMap.has(note.id) || localDate > new Date(ipfsMap.get(note.id).updatedAt));

	await Promise.allSettled([
		shouldUploadToS3 ? uploadNoteToS3(note, credentials) : null,
		shouldUploadToNostr ? _GLOBAL.publishNoteToRelays(nostrRelays.split(',').map(r => r.trim()), nostrPrivateKey, note) : null,
		shouldUploadToGit ? _GLOBAL.uploadNoteToGit(note, gitCredentials) : null,
		shouldUploadToGDrive ? _GLOBAL.uploadNoteToGoogleDrive(note, gdriveMap.get(note.id)) : null,
		shouldUploadToIPFS ? _GLOBAL.uploadNoteToIPFS(note, credentials) : null,
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
		promises.push(_GLOBAL.publishImageToRelays(relays, nostrPrivateKey, image));
	}

	await Promise.all(promises);
}

async function listNotes({credentials, nostrPrivateKey, nostrRelays, lastSync, gitCredentials, gdriveStore}) {
	const s3NotesPromise = listNotesInS3(credentials, lastSync);

	let nostrNotesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrNotesPromise = _GLOBAL.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey, lastSync);
	} else {
		nostrNotesPromise = Promise.resolve([]);
	}

	let gitNotesPromise;
	if (gitCredentials?.repoUrl && typeof _GLOBAL.listNotesInGit === 'function') {
		gitNotesPromise = _GLOBAL.listNotesInGit(gitCredentials);
	} else {
		gitNotesPromise = Promise.resolve([]);
	}

	let gdriveNotesPromise;
	if (gdriveStore?.connected && typeof _GLOBAL.listNotesInGDrive === 'function') {
		gdriveNotesPromise = _GLOBAL.listNotesInGDrive();
	} else {
		gdriveNotesPromise = Promise.resolve([]);
	}

	let ipfsNotesPromise;
	if ((credentials?.pinataJwt || credentials?.pinataApiKey) && typeof window.listNotesInIPFS === 'function') {
		ipfsNotesPromise = window.listNotesInIPFS(credentials);
	} else {
		ipfsNotesPromise = Promise.resolve([]);
	}

	const [s3Res, nostrRes, gitRes, gdriveRes, ipfsRes] = await Promise.allSettled([
		promiseTimeout(s3NotesPromise),
		promiseTimeout(nostrNotesPromise),
		promiseTimeout(gitNotesPromise),
		promiseTimeout(gdriveNotesPromise),
		promiseTimeout(ipfsNotesPromise)
	]);

	const s3Notes = s3Res.status === 'fulfilled' ? s3Res.value : [];
	const nostrNotes = nostrRes.status === 'fulfilled' ? nostrRes.value : [];
	const gitNotes = gitRes.status === 'fulfilled' ? gitRes.value : [];
	const gdriveNotes = gdriveRes.status === 'fulfilled' ? gdriveRes.value : [];
	const ipfsNotes = ipfsRes.status === 'fulfilled' ? ipfsRes.value : [];

	const mergedNotes = new Map();

	s3Notes.forEach(note => mergedNotes.set(note.id, note));

	ipfsNotes.forEach(note => {
		const existingNote = mergedNotes.get(note.id);
		const ipfsLastModified = new Date(note.updatedAt);

		if (!existingNote) {
			mergedNotes.set(note.id, note);
		} else {
			const existingLastModified = new Date(existingNote.updatedAt);
			if (ipfsLastModified > existingLastModified) {
				mergedNotes.set(note.id, note);
			}
		}
	});

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

	const listingSucceeded = [s3Res, nostrRes, gitRes, gdriveRes, ipfsRes].every(r => r.status === 'fulfilled');


	return {
		mergedNotes: Array.from(mergedNotes.values()),
		s3Ids: new Set(s3Notes.map(n => n.id)),
		gitIds: new Set(gitNotes.map(n => n.id)),
		nostrIds: new Set(nostrNotes.map(n => n.id)),
		gdriveIds: new Set(gdriveNotes.map(n => n.id)),
		ipfsIds: new Set(ipfsNotes.map(n => n.id)),
		s3Map: new Map(s3Notes.map(n => [n.id, n])),
		gitMap: new Map(gitNotes.map(n => [n.id, n])),
		nostrMap: new Map(nostrNotes.map(n => [n.id, n])),
		gdriveMap: new Map(gdriveNotes.map(n => [n.id, n])),
		ipfsMap: new Map(ipfsNotes.map(n => [n.id, n])),
		listingSucceeded
	};
}

async function listImages({credentials, nostrPrivateKey, nostrRelays}) {
	const s3ImagesPromise = listImagesInS3(credentials);

	let nostrImagesPromise;
	if (nostrPrivateKey && nostrRelays) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		nostrImagesPromise = _GLOBAL.fetchAndDecryptEventsFromRelays(relays, nostrPrivateKey);
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
	if (gdriveStore.connected && typeof _GLOBAL.deleteNoteFromGoogleDrive === 'function') {
		promises.push(_GLOBAL.deleteNoteFromGoogleDrive(noteId, remoteMeta));
	}

	if (credentials?.secretAccessKey) {
		promises.push(deleteNoteFromS3(remoteMeta || noteId, credentials));
	}

	if ( nostrPrivateKey && nostrRelays ) {
		const relays = nostrRelays.split(',').map(r => r.trim());
		promises.push(_GLOBAL.publishNoteDeletionToRelays(relays, nostrPrivateKey, noteId));
	}

	if (gitCredentials?.repoUrl && typeof _GLOBAL.deleteNoteFromGit === 'function') {
		promises.push(_GLOBAL.deleteNoteFromGit(remoteMeta?.path || noteId, gitCredentials));
	}

	if ((credentials?.pinataJwt || credentials?.pinataApiKey) && typeof window.deleteNoteFromIPFS === 'function') {
		promises.push(window.deleteNoteFromIPFS(noteId, credentials));
	}

	await Promise.all(promises);
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
		promises.push(_GLOBAL.publishImageDeletionToRelays(relays, nostrPrivateKey, imageId));
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
		'-',
		Date.now().toString(36).substr(4),
		Math.random().toString(36).substring(2, 6),
	].join('').trim().replace(/$-/, '');
}

const easyMDEqueryPreviewCheckbox = '.EasyMDEContainer .editor-preview input';

function easyMDEreplaceNth(haystack, searchRegex, replace, index){
	console.log('easyMDEreplaceNth', haystack.length, searchRegex, replace, index)
	let occurrence = 0;
	return haystack.replace(searchRegex, (match) => {
		console.log('replaceNth.match', match);
		occurrence++;
		if (occurrence === index) {
			return replace;
		}
		return match;
	});
};

function easyMDEcheckboxChange(event) {
	const elements = [...document.querySelectorAll(easyMDEqueryPreviewCheckbox)];
	const index = elements.findIndex(n => n === event.currentTarget);

	if (index < 0) return console.log('easyMDEcheckboxChange index not found', index);

	let markdown = _GLOBAL.easyMDEInstance.codemirror.getValue();

	if (event.target.checked) {
		markdown = easyMDEreplaceNth(markdown, /\- \[[x|\s]\]/gmi, "- [x]", index + 1);
	} else {
		markdown = easyMDEreplaceNth(markdown, /\- \[[x|\s]\]/gmi, "- [ ]", index + 1);
	}

	_GLOBAL.easyMDEInstance.codemirror.setValue(markdown);
}

// --- WebAuthn Biometric Helpers ---

async function registerBiometric() {
	if (!window.PublicKeyCredential) throw new Error('Biometric authentication not supported');

	const challenge = CRYPTO.getRandomValues(new Uint8Array(32));
	const userId = CRYPTO.getRandomValues(new Uint8Array(16));

	const options = {
		publicKey: {
			challenge,
			rp: { name: 'FeatherNote' },
			user: {
				id: userId,
				name: 'user@feathernote.app',
				displayName: 'FeatherNote User',
			},
			pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				userVerification: 'required',
			},
			timeout: 60000,
		},
	};

	const credential = await navigator.credentials.create(options);
	if (!credential) throw new Error('Biometric registration failed');

	// Save the credential ID to persist the "lock"
	const credentialId = bufferToBase64(credential.rawId);
	await setMetaDB('biometric_credential_id', credentialId);
	return true;
}

async function authenticateBiometric() {
	if (!window.PublicKeyCredential) throw new Error('Biometric authentication not supported');

	const credentialIdB64 = await getMetaDB('biometric_credential_id');
	if (!credentialIdB64) throw new Error('No biometric credential registered');

	const credentialId = base64ToBuffer(credentialIdB64);
	const challenge = CRYPTO.getRandomValues(new Uint8Array(32));

	const options = {
		publicKey: {
			challenge,
			allowCredentials: [{
				id: credentialId,
				type: 'public-key',
			}],
			userVerification: 'required',
			timeout: 60000,
		},
	};

	const assertion = await navigator.credentials.get(options);
	return !!assertion;
}
