// IPFS Worker - Runs Helia operations in a background thread
import { json } from 'https://cdn.jsdelivr.net/npm/@helia/json@3.0.4/+esm';
import { createHelia } from 'https://cdn.jsdelivr.net/npm/helia@4.2.5/+esm';
import { IDBBlockstore } from 'https://cdn.jsdelivr.net/npm/blockstore-idb@2.0.1/+esm';
import { IDBDatastore } from 'https://cdn.jsdelivr.net/npm/datastore-idb@2.0.1/+esm';

let heliaNode = null;
let heliaJson = null;
let indexFileCid = null;

// --- Helia Initialization ---

const initHelia = async () => {
	if (heliaNode) return heliaNode;

	console.log('IPFS Worker: Initializing Helia node with IndexedDB...');
	try {
		const blockstore = new IDBBlockstore('helia-blocks-worker');
		const datastore = new IDBDatastore('helia-data-worker');
		await blockstore.open();
		await datastore.open();

		heliaNode = await createHelia({
			blockstore,
			datastore
		});
		heliaJson = json(heliaNode);
		console.log('IPFS Worker: Helia node ready.');
		return heliaNode;
	} catch (err) {
		console.error('IPFS Worker: Failed to initialize Helia:', err);
		throw err;
	}
};

// --- Helper: Get/Update Index ---

const getLocalIndex = async (rootCid) => {
	if (!rootCid) return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	try {
		await initHelia();
		const { CID } = await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm');
		return await heliaJson.get(CID.parse(rootCid));
	} catch (err) {
		console.warn('IPFS Worker: Failed to fetch index, returning empty.', err);
		return { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	}
};

// --- Ensure Index File ---

const ensureIndexFile = async (existingRootCid = null) => {
	if (indexFileCid) return indexFileCid;

	await initHelia();

	if (existingRootCid) {
		indexFileCid = existingRootCid;
		console.log('IPFS Worker: Using existing root CID:', indexFileCid);
		return indexFileCid;
	}

	const initialIndex = { version: 1, updatedAt: new Date().toISOString(), notes: {}, deletedNoteIds: [] };
	indexFileCid = await heliaJson.add(initialIndex);
	console.log('IPFS Worker: Created initial .feathernote.json index with CID:', indexFileCid.toString());

	return indexFileCid.toString();
};

// --- IPFS Operations ---

const uploadNote = async (note, ipfsRootCid) => {
	await initHelia();
	const noteCid = await heliaJson.add(note);
	const index = await getLocalIndex(ipfsRootCid);
	index.notes[note.id] = { cid: noteCid.toString(), updatedAt: note.updatedAt };
	index.updatedAt = new Date().toISOString();
	const newRootCid = await heliaJson.add(index);
	return { noteCid: noteCid.toString(), newRootCid: newRootCid.toString(), index };
};

const downloadNote = async (cid) => {
	await initHelia();
	const { CID } = await import('https://cdn.jsdelivr.net/npm/multiformats/cid/+esm');
	return await heliaJson.get(CID.parse(cid));
};

const listNotes = async (ipfsRootCid) => {
	const index = await getLocalIndex(ipfsRootCid);
	return Object.entries(index.notes).map(([id, meta]) => ({
		id: id, cid: meta.cid, updatedAt: meta.updatedAt
	}));
};

const deleteNote = async (noteId, ipfsRootCid) => {
	await initHelia();
	const index = await getLocalIndex(ipfsRootCid);
	if (index.notes[noteId]) {
		delete index.notes[noteId];
		index.updatedAt = new Date().toISOString();
		const newRootCid = await heliaJson.add(index);
		return { newRootCid: newRootCid.toString(), index };
	}
	return { index };
};

const updateDeletedNotes = async (deletedIds, ipfsRootCid) => {
	await initHelia();
	const index = await getLocalIndex(ipfsRootCid);
	index.deletedNoteIds = deletedIds;
	index.updatedAt = new Date().toISOString();
	const newRootCid = await heliaJson.add(index);
	return { newRootCid: newRootCid.toString(), index };
};

const getDeletedNotes = async (ipfsRootCid) => {
	const index = await getLocalIndex(ipfsRootCid);
	return { ids: index.deletedNoteIds || [], updatedAt: index.updatedAt };
};

// --- Message Handler ---

self.onmessage = async (event) => {
	const { type, payload, requestId } = event.data;
	console.log(`IPFS Worker: Received ${type} (requestId: ${requestId})`, payload);

	try {
		switch (type) {
			case 'INIT_HELIA': {
				await initHelia();
				self.postMessage({ type: 'INIT_HELIA_COMPLETE', success: true });
				break;
			}

			case 'ENSURE_INDEX': {
				const cid = await ensureIndexFile(payload?.ipfsRootCid);
				self.postMessage({ type: 'INDEX_READY', cid, success: true });
				break;
			}

			case 'UPLOAD_NOTE': {
				const result = await uploadNote(payload.note, payload.ipfsRootCid);
				self.postMessage({ type: 'UPLOAD_NOTE_COMPLETE', ...result, success: true });
				break;
			}

			case 'DOWNLOAD_NOTE': {
				const note = await downloadNote(payload.cid);
				self.postMessage({ type: 'DOWNLOAD_NOTE_COMPLETE', note, success: true });
				break;
			}

			case 'LIST_NOTES': {
				const notes = await listNotes(payload.ipfsRootCid);
				self.postMessage({ type: 'LIST_NOTES_COMPLETE', notes, success: true });
				break;
			}

			case 'DELETE_NOTE': {
				const result = await deleteNote(payload.noteId, payload.ipfsRootCid);
				self.postMessage({ type: 'DELETE_NOTE_COMPLETE', ...result, success: true });
				break;
			}

			case 'UPDATE_DELETED_NOTES': {
				const result = await updateDeletedNotes(payload.deletedIds, payload.ipfsRootCid);
				self.postMessage({ type: 'UPDATE_DELETED_NOTES_COMPLETE', ...result, success: true });
				break;
			}

			case 'GET_DELETED_NOTES': {
				const result = await getDeletedNotes(payload.ipfsRootCid);
				self.postMessage({ type: 'GET_DELETED_NOTES_COMPLETE', ...result, success: true });
				break;
			}

			case 'HEALTH_CHECK': {
				self.postMessage({ type: 'HEALTH_CHECK_COMPLETE', success: true, status: heliaNode ? 'ready' : 'not-initialized' });
				break;
			}

			default:
				console.warn('IPFS Worker: Unknown message type:', type);
		}
	} catch (error) {
		console.error(`IPFS Worker: Error processing ${type} (requestId: ${requestId}):`, error);
		self.postMessage({
			type: `${type}_ERROR`,
			error: error.message,
			requestId,
			success: false
		});
	}
};

console.log('IPFS Worker: Started and ready for messages');
