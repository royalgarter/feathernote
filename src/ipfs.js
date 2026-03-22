// IPFS Module - Main Thread Implementation with Non-Blocking Operations
// Uses async/await and timeouts to prevent UI blocking

import { json } from 'https://cdn.jsdelivr.net/npm/@helia/json@3.0.4/+esm';
import { createHelia } from 'https://cdn.jsdelivr.net/npm/helia@4.2.5/+esm';
import { IDBBlockstore } from 'https://cdn.jsdelivr.net/npm/blockstore-idb@2.0.1/+esm';
import { IDBDatastore } from 'https://cdn.jsdelivr.net/npm/datastore-idb@2.0.1/+esm';

const _GLOBAL = typeof window !== 'undefined' ? window : self;

let heliaNode = null;
let heliaJson = null;
let indexFileCid = null;
let initPromise = null;

// --- Helia Initialization (with deduplication) ---

const initHelia = async () => {
	if (heliaNode) return heliaNode;
	if (initPromise) return initPromise;

	return;
	console.log('IPFS: Initializing Helia node with IndexedDB...');

	initPromise = (async () => {
		try {
			// Yield to main thread to prevent blocking
			await new Promise(resolve => setTimeout(resolve, 0));

			const blockstore = new IDBBlockstore('helia-blocks');
			const datastore = new IDBDatastore('helia-data');
			await blockstore.open();
			await datastore.open();

			heliaNode = await createHelia({
				blockstore,
				datastore
			});
			heliaJson = json(heliaNode);
			console.log('IPFS: Helia node ready.');
			return heliaNode;
		} catch (err) {
			console.error('IPFS: Failed to initialize Helia:', err);
			initPromise = null; // Reset to allow retry
			throw err;
		}
	})();

	return initPromise;
};

// --- Helper: Get Index with Timeout ---

const getLocalIndex = async (rootCid, timeoutMs = 10000) => {
	if (!rootCid) return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };

	try {
		await Promise.race([
			(async () => {
				await initHelia();
				const { CID } = await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm');
				return await heliaJson.get(CID.parse(rootCid));
			})(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('getLocalIndex timeout')), timeoutMs)
			)
		]);
		const { CID } = await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm');
		return await heliaJson.get(CID.parse(rootCid));
	} catch (err) {
		console.warn('IPFS: Failed to fetch index, returning empty.', err);
		return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	}
};

// --- Ensure Index File (.feathernote.json) ---

const ensureIndexFile = async () => {
	return;
	if (indexFileCid) return indexFileCid;

	await initHelia();

	// Check if there's an existing root CID from settings (loaded by index.js)
	const existingRootCid = _GLOBAL.ipfsRootCid;
	if (existingRootCid) {
		indexFileCid = existingRootCid;
		console.log('IPFS: Using existing root CID:', indexFileCid);
		return indexFileCid;
	}

	// Yield to prevent blocking
	await new Promise(resolve => setTimeout(resolve, 0));

	// Create initial index
	const initialIndex = { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	indexFileCid = await heliaJson.add(initialIndex);
	console.log('IPFS: Created initial .feathernote.json index with CID:', indexFileCid.toString());

	// Notify the app about the new root CID
	if (_GLOBAL.updateIpfsRootCid) {
		await _GLOBAL.updateIpfsRootCid(indexFileCid.toString());
	}

	return indexFileCid.toString();
};

// --- Pinata Legacy Logic ---

const PINATA_API_BASE = 'https://api.pinata.cloud';

const getPinataHeaders = (creds) => {
	if (creds.pinataJwt) {
		return {
			'Authorization': `Bearer ${creds.pinataJwt}`,
			'Content-Type': 'application/json'
		};
	}
	return {
		'pinata_api_key': creds.pinataApiKey,
		'pinata_secret_api_key': creds.pinataSecretApiKey,
		'Content-Type': 'application/json'
	};
};

const deleteDeletedNotesFromIPFS = async (creds) => {
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: {
			app: { value: 'feathernote', op: 'eq' },
			type: { value: 'deleted-notes', op: 'eq' }
		}
	}));
	const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
	const listResponse = await fetch(listUrl, { headers: getPinataHeaders(creds) });
	if (listResponse.ok) {
		const data = await listResponse.json();
		for (const row of data.rows) {
			const unpinUrl = `${PINATA_API_BASE}/pinning/unpin/${row.ipfs_pin_hash}`;
			await fetch(unpinUrl, { method: 'DELETE', headers: getPinataHeaders(creds) });
		}
	}
};

// --- Exported IPFS Functions (with timeouts) ---

const uploadNoteToIPFS = async (note, creds, timeoutMs = 30000) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			console.log(`IPFS: Direct upload for note ${note.id}`);

			await initHelia();

			// Yield to main thread
			await new Promise(resolve => setTimeout(resolve, 0));

			const noteCid = await heliaJson.add(note);
			const index = await getLocalIndex(creds.ipfsRootCid);
			index.notes[note.id] = { cid: noteCid.toString(), updatedAt: note.updatedAt };
			index.updatedAt = new Date().toISOString();

			// Yield again before updating index
			await new Promise(resolve => setTimeout(resolve, 0));

			const newRootCid = await heliaJson.add(index);
			if (window.updateIpfsRootCid) await window.updateIpfsRootCid(newRootCid.toString());
			return;
		} catch (err) {
			console.error('IPFS: Direct upload failed, checking Pinata fallback...', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;

	const url = `${PINATA_API_BASE}/pinning/pinJSONToIPFS`;
	const body = {
		pinataMetadata: {
			name: `feathernote-note-${note.id}`,
			keyvalues: { noteId: note.id, updatedAt: note.updatedAt, app: 'feathernote', type: 'note' }
		},
		pinataContent: note
	};

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: getPinataHeaders(creds),
			body: JSON.stringify(body),
			signal: controller.signal
		});
		clearTimeout(timeoutId);

		if (response.ok) {
			const data = await response.json();
			console.log(`IPFS: Uploaded note ${note.id} to Pinata CID ${data.IpfsHash}`);
		}
	} catch (err) {
		clearTimeout(timeoutId);
		if (err.name === 'AbortError') {
			console.error('IPFS: Pinata upload timeout');
		} else {
			console.error('IPFS: Pinata upload failed:', err);
		}
	}
};

const listNotesInIPFS = async (creds, timeoutMs = 15000) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			const index = await getLocalIndex(creds.ipfsRootCid, timeoutMs);
			return Object.entries(index.notes).map(([id, meta]) => ({
				id: id, cid: meta.cid, updatedAt: meta.updatedAt, source: 'ipfs'
			}));
		} catch (err) {
			console.error('IPFS: Direct listing failed, checking Pinata fallback...', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return [];

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const query = encodeURIComponent(JSON.stringify({
			keyvalues: { app: { value: 'feathernote', op: 'eq' }, type: { value: 'note', op: 'eq' } }
		}));
		const url = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
		const response = await fetch(url, { headers: getPinataHeaders(creds), signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) return [];
		const data = await response.json();
		return data.rows.map(row => ({
			id: row.metadata.keyvalues.noteId,
			cid: row.ipfs_pin_hash,
			updatedAt: row.metadata.keyvalues.updatedAt || row.date_pinned,
			source: 'ipfs'
		}));
	} catch (err) {
		clearTimeout(timeoutId);
		console.error('IPFS: Pinata list failed:', err);
		return [];
	}
};

const downloadNoteFromIPFS = async (noteMeta, creds, timeoutMs = 30000) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();
			const { CID } = await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm');

			// Yield to main thread
			await new Promise(resolve => setTimeout(resolve, 0));

			return await heliaJson.get(CID.parse(noteMeta.cid));
		} catch (err) {
			console.error('IPFS: Direct download failed, checking gateway fallback...', err);
		}
	}

	const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${gateway}${noteMeta.cid}`, { signal: controller.signal });
		clearTimeout(timeoutId);

		if (!response.ok) throw new Error(`IPFS Download Error: ${response.statusText}`);
		return await response.json();
	} catch (err) {
		clearTimeout(timeoutId);
		if (err.name === 'AbortError') {
			throw new Error('IPFS download timeout');
		}
		throw err;
	}
};

const deleteNoteFromIPFS = async (noteId, creds, timeoutMs = 15000) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();

			// Yield to main thread
			await new Promise(resolve => setTimeout(resolve, 0));

			const index = await getLocalIndex(creds.ipfsRootCid);
			if (index.notes[noteId]) {
				delete index.notes[noteId];
				index.updatedAt = new Date().toISOString();
				const newRootCid = await heliaJson.add(index);
				if (window.updateIpfsRootCid) await window.updateIpfsRootCid(newRootCid.toString());
			}
			return;
		} catch (err) {
			console.error('IPFS: Direct delete failed.', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const query = encodeURIComponent(JSON.stringify({
			keyvalues: { noteId: { value: noteId, op: 'eq' }, app: { value: 'feathernote', op: 'eq' } }
		}));
		const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
		const listResponse = await fetch(listUrl, { headers: getPinataHeaders(creds), signal: controller.signal });
		clearTimeout(timeoutId);

		if (listResponse.ok) {
			const data = await listResponse.json();
			for (const row of data.rows) {
				const unpinUrl = `${PINATA_API_BASE}/pinning/unpin/${row.ipfs_pin_hash}`;
				await fetch(unpinUrl, { method: 'DELETE', headers: getPinataHeaders(creds) });
			}
		}
	} catch (err) {
		clearTimeout(timeoutId);
		console.error('IPFS: Pinata delete failed:', err);
	}
};

const uploadDeletedNotesToIPFS = async (deletedIds, creds, timeoutMs = 15000) => {
	return;
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();

			// Yield to main thread
			await new Promise(resolve => setTimeout(resolve, 0));

			const index = await getLocalIndex(creds.ipfsRootCid);
			index.deletedNoteIds = deletedIds;
			index.updatedAt = new Date().toISOString();
			const newRootCid = await heliaJson.add(index);
			if (window.updateIpfsRootCid) await window.updateIpfsRootCid(newRootCid.toString());
			return;
		} catch (err) {
			console.error('IPFS: Direct upload deleted notes failed.', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;
	const note = { ids: deletedIds, updatedAt: new Date().toISOString() };

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `${PINATA_API_BASE}/pinning/pinJSONToIPFS`;
		const body = {
			pinataMetadata: { name: `feathernote-deleted-notes`, keyvalues: { app: 'feathernote', type: 'deleted-notes' } },
			pinataContent: note
		};
		await deleteDeletedNotesFromIPFS(creds);
		await fetch(url, { method: 'POST', headers: getPinataHeaders(creds), body: JSON.stringify(body), signal: controller.signal });
		clearTimeout(timeoutId);
	} catch (err) {
		clearTimeout(timeoutId);
		console.error('IPFS: Pinata upload deleted notes failed:', err);
	}
};

const downloadDeletedNotesFromIPFS = async (creds, timeoutMs = 15000) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();
			const index = await getLocalIndex(creds.ipfsRootCid);
			return { ids: index.deletedNoteIds || [], updatedAt: index.updatedAt };
		} catch (err) {
			console.error('IPFS: Direct download deleted notes failed.', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const query = encodeURIComponent(JSON.stringify({
			keyvalues: { app: { value: 'feathernote', op: 'eq' }, type: { value: 'deleted-notes', op: 'eq' } }
		}));
		const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
		const listResponse = await fetch(listUrl, { headers: getPinataHeaders(creds), signal: controller.signal });
		clearTimeout(timeoutId);

		if (listResponse.ok) {
			const data = await listResponse.json();
			if (data.rows.length > 0) {
				const latest = data.rows[0];
				const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';

				const downloadController = new AbortController();
				const downloadTimeoutId = setTimeout(() => downloadController.abort(), timeoutMs);

				const response = await fetch(`${gateway}${latest.ipfs_pin_hash}`, { signal: downloadController.signal });
				clearTimeout(downloadTimeoutId);

				if (response.ok) return await response.json();
			}
		}
	} catch (err) {
		clearTimeout(timeoutId);
		console.error('IPFS: Pinata download deleted notes failed:', err);
	}
	return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };
};

// Export to window
_GLOBAL.uploadNoteToIPFS = uploadNoteToIPFS;
_GLOBAL.listNotesInIPFS = listNotesInIPFS;
_GLOBAL.downloadNoteFromIPFS = downloadNoteFromIPFS;
_GLOBAL.deleteNoteFromIPFS = deleteNoteFromIPFS;
_GLOBAL.uploadDeletedNotesToIPFS = uploadDeletedNotesToIPFS;
_GLOBAL.downloadDeletedNotesFromIPFS = downloadDeletedNotesFromIPFS;
_GLOBAL.ensureIndexFile = ensureIndexFile;
_GLOBAL.initHelia = initHelia;

// Status methods
_GLOBAL.getIPFSStatus = () => ({
	initialized: !!heliaNode,
	initializing: !!initPromise,
	hasRootCid: !!indexFileCid,
	rootCid: indexFileCid
});

// --- Test Function: Upload .feathernote.json to Cloudflare IPFS Gateway ---

_GLOBAL.testIPFSUpload = async (options = {}) => {
	const {
		log = true,
		gateway = 'https://cloudflare-ipfs.com/ipfs/',
		credentials = null
	} = options;

	const results = {
		success: false,
		heliaStatus: null,
		indexFile: null,
		rootCid: null,
		gatewayUrl: null,
		downloadTest: null,
		errors: []
	};

	const logMsg = log ? console.log : () => {};
	const errorMsg = log ? console.error : () => {};

	try {
		logMsg('🧪 IPFS Test: Starting...');

		// Step 1: Check Helia status
		results.heliaStatus = _GLOBAL.getIPFSStatus();
		logMsg('📊 Helia Status:', results.heliaStatus);

		// Step 2: Initialize Helia if needed
		if (!results.heliaStatus.initialized) {
			logMsg('⏳ Initializing Helia...');
			await _GLOBAL.initHelia();
			results.heliaStatus = _GLOBAL.getIPFSStatus();
			logMsg('✅ Helia initialized:', results.heliaStatus);
		}

		// Step 3: Get or create index file
		logMsg('📁 Getting index file...');
		const rootCid = await _GLOBAL.ensureIndexFile();
		results.rootCid = rootCid;
		results.indexFile = { version: 1, updatedAt: new Date().toISOString() };
		logMsg('✅ Index file CID:', rootCid);

		// Step 4: Generate Cloudflare Gateway URL
		results.gatewayUrl = `${gateway}${rootCid}`;
		logMsg('🌐 Cloudflare Gateway URL:', results.gatewayUrl);

		// Step 5: Test download from gateway
		logMsg('⬇️  Testing gateway download...');
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000);

		try {
			const response = await fetch(results.gatewayUrl, { signal: controller.signal });
			clearTimeout(timeoutId);

			if (response.ok) {
				const data = await response.json();
				results.downloadTest = {
					success: true,
					status: response.status,
					data: {
						version: data.version,
						updatedAt: data.updatedAt,
						noteCount: Object.keys(data.notes || {}).length,
						deletedNoteCount: (data.deletedNoteIds || []).length
					}
				};
				logMsg('✅ Gateway download successful:', results.downloadTest.data);
			} else {
				results.downloadTest = {
					success: false,
					status: response.status,
					error: response.statusText
				};
				errorMsg('❌ Gateway download failed:', response.statusText);
			}
		} catch (err) {
			clearTimeout(timeoutId);
			results.downloadTest = {
				success: false,
				error: err.message
			};
			errorMsg('❌ Gateway download error:', err.message);
		}

		// Step 6: Test direct Helia download
		logMsg('⬇️  Testing direct Helia download...');
		const directData = await _GLOBAL.downloadNoteFromIPFS({ cid: rootCid }, credentials || {});
		logMsg('✅ Direct Helia download successful:', {
			version: directData.version,
			updatedAt: directData.updatedAt,
			noteCount: Object.keys(directData.notes || {}).length
		});

		results.success = true;
		logMsg('🎉 IPFS Test Complete!');

	} catch (err) {
		results.errors.push(err.message);
		errorMsg('❌ IPFS Test failed:', err.message);
		results.success = false;
	}

	return results;
};

console.log('IPFS Module: Loaded with non-blocking operations');
