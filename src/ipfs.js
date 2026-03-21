import { createHelia } from 'https://cdn.jsdelivr.net/npm/helia@4.2.5/+esm';
import { json } from 'https://cdn.jsdelivr.net/npm/@helia/json@3.0.4/+esm';
import { indexedDBBlockstore } from 'https://cdn.jsdelivr.net/npm/blockstore-idb@2.0.1/+esm';
import { indexedDBDatastore } from 'https://cdn.jsdelivr.net/npm/datastore-idb@2.0.1/+esm';

const _GLOBAL = typeof window !== 'undefined' ? window : self;

let heliaNode = null;
let heliaJson = null;

// --- Helia Initialization ---

const initHelia = async () => {
	if (heliaNode) return heliaNode;

	console.log('IPFS: Initializing Helia node with IndexedDB...');
	try {
		const blockstore = new indexedDBBlockstore('helia-blocks');
		const datastore = new indexedDBDatastore('helia-data');
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
		throw err;
	}
};

// --- Helper: Get/Update Index ---

const getLocalIndex = async (rootCid) => {
	if (!rootCid) return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	try {
		await initHelia();
		const CID = (await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm')).CID;
		return await heliaJson.get(CID.parse(rootCid));
	} catch (err) {
		console.warn('IPFS: Failed to fetch index, returning empty.', err);
		return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	}
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

// --- Exported IPFS Functions ---

const uploadNoteToIPFS = async (note, creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();
			console.log(`IPFS: Direct upload for note ${note.id}`);
			const noteCid = await heliaJson.add(note);
			const index = await getLocalIndex(creds.ipfsRootCid);
			index.notes[note.id] = { cid: noteCid.toString(), updatedAt: note.updatedAt };
			index.updatedAt = new Date().toISOString();
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
	const response = await fetch(url, {
		method: 'POST',
		headers: getPinataHeaders(creds),
		body: JSON.stringify(body)
	});
	if (response.ok) {
		const data = await response.json();
		console.log(`IPFS: Uploaded note ${note.id} to Pinata CID ${data.IpfsHash}`);
	}
};

const listNotesInIPFS = async (creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			const index = await getLocalIndex(creds.ipfsRootCid);
			return Object.entries(index.notes).map(([id, meta]) => ({
				id: id, cid: meta.cid, updatedAt: meta.updatedAt, source: 'ipfs'
			}));
		} catch (err) {
			console.error('IPFS: Direct listing failed, checking Pinata fallback...', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return [];
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: { app: { value: 'feathernote', op: 'eq' }, type: { value: 'note', op: 'eq' } }
	}));
	const url = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
	const response = await fetch(url, { headers: getPinataHeaders(creds) });
	if (!response.ok) return [];
	const data = await response.json();
	return data.rows.map(row => ({
		id: row.metadata.keyvalues.noteId,
		cid: row.ipfs_pin_hash,
		updatedAt: row.metadata.keyvalues.updatedAt || row.date_pinned,
		source: 'ipfs'
	}));
};

const downloadNoteFromIPFS = async (noteMeta, creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			await initHelia();
			const CID = (await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm')).CID;
			return await heliaJson.get(CID.parse(noteMeta.cid));
		} catch (err) {
			console.error('IPFS: Direct download failed, checking gateway fallback...', err);
		}
	}

	const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';
	const response = await fetch(`${gateway}${noteMeta.cid}`);
	if (!response.ok) throw new Error(`IPFS Download Error: ${response.statusText}`);
	return await response.json();
};

const deleteNoteFromIPFS = async (noteId, creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
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
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: { noteId: { value: noteId, op: 'eq' }, app: { value: 'feathernote', op: 'eq' } }
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

const uploadDeletedNotesToIPFS = async (deletedIds, creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
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
	const url = `${PINATA_API_BASE}/pinning/pinJSONToIPFS`;
	const body = {
		pinataMetadata: { name: `feathernote-deleted-notes`, keyvalues: { app: 'feathernote', type: 'deleted-notes' } },
		pinataContent: note
	};
	await deleteDeletedNotesFromIPFS(creds);
	await fetch(url, { method: 'POST', headers: getPinataHeaders(creds), body: JSON.stringify(body) });
};

const downloadDeletedNotesFromIPFS = async (creds) => {
	const useDirect = creds.useDirectIpfs !== false;
	if (useDirect) {
		try {
			const index = await getLocalIndex(creds.ipfsRootCid);
			return { ids: index.deletedNoteIds || [], updatedAt: index.updatedAt };
		} catch (err) {
			console.error('IPFS: Direct download deleted notes failed.', err);
		}
	}

	if (!creds?.pinataJwt && !creds?.pinataApiKey) return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: { app: { value: 'feathernote', op: 'eq' }, type: { value: 'deleted-notes', op: 'eq' } }
	}));
	const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;
	const listResponse = await fetch(listUrl, { headers: getPinataHeaders(creds) });
	if (listResponse.ok) {
		const data = await listResponse.json();
		if (data.rows.length > 0) {
			const latest = data.rows[0];
			const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';
			const response = await fetch(`${gateway}${latest.ipfs_pin_hash}`);
			if (response.ok) return await response.json();
		}
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
