// --- IPFS Functions (via Pinata API) ---

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

const uploadNoteToIPFS = async (note, creds) => {
	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;

	const url = `${PINATA_API_BASE}/pinning/pinJSONToIPFS`;
	const body = {
		pinataMetadata: {
			name: `feathernote-note-${note.id}`,
			keyvalues: {
				noteId: note.id,
				updatedAt: note.updatedAt,
				app: 'feathernote',
				type: 'note'
			}
		},
		pinataContent: note
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: getPinataHeaders(creds),
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const err = await response.json();
		throw new Error(`IPFS Upload Error: ${err.error || response.statusText}`);
	}

	const data = await response.json();
	console.log(`IPFS: Uploaded note ${note.id} to CID ${data.IpfsHash}`);
};

const listNotesInIPFS = async (creds) => {
	if (!creds?.pinataJwt && !creds?.pinataApiKey) return [];

	// Filter by metadata to only get feathernote notes
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: {
			app: { value: 'feathernote', op: 'eq' },
			type: { value: 'note', op: 'eq' }
		}
	}));
	
	const url = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;

	const response = await fetch(url, {
		method: 'GET',
		headers: getPinataHeaders(creds)
	});

	if (!response.ok) {
		const err = await response.json();
		throw new Error(`IPFS List Error: ${err.error || response.statusText}`);
	}

	const data = await response.json();
	return data.rows.map(row => ({
		id: row.metadata.keyvalues.noteId,
		cid: row.ipfs_pin_hash,
		updatedAt: row.metadata.keyvalues.updatedAt || row.date_pinned,
		source: 'ipfs'
	}));
};

const downloadNoteFromIPFS = async (noteMeta, creds) => {
	const cid = noteMeta.cid;
	// Use a public gateway or Pinata's gateway if provided
	const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';
	const url = `${gateway}${cid}`;

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`IPFS Download Error: ${response.statusText} for CID ${cid}`);
	}

	return await response.json();
};

const deleteNoteFromIPFS = async (noteId, creds) => {
	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;

	// To delete (unpin), we first need to find the CID(s) for this noteId
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: {
			noteId: { value: noteId, op: 'eq' },
			app: { value: 'feathernote', op: 'eq' }
		}
	}));
	const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;

	const listResponse = await fetch(listUrl, {
		headers: getPinataHeaders(creds)
	});

	if (listResponse.ok) {
		const data = await listResponse.json();
		for (const row of data.rows) {
			const unpinUrl = `${PINATA_API_BASE}/pinning/unpin/${row.ipfs_pin_hash}`;
			await fetch(unpinUrl, {
				method: 'DELETE',
				headers: getPinataHeaders(creds)
			});
			console.log(`IPFS: Unpinned CID ${row.ipfs_pin_hash} for note ${noteId}`);
		}
	}
};

const uploadDeletedNotesToIPFS = async (deletedIds, creds) => {
	if (!creds?.pinataJwt && !creds?.pinataApiKey) return;

	const note = { ids: deletedIds, updatedAt: new Date().toISOString() };
	const url = `${PINATA_API_BASE}/pinning/pinJSONToIPFS`;
	const body = {
		pinataMetadata: {
			name: `feathernote-deleted-notes`,
			keyvalues: {
				app: 'feathernote',
				type: 'deleted-notes'
			}
		},
		pinataContent: note
	};

	// Before uploading new, we should probably unpin the old one to keep it clean
	await deleteDeletedNotesFromIPFS(creds);

	const response = await fetch(url, {
		method: 'POST',
		headers: getPinataHeaders(creds),
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const err = await response.json();
		throw new Error(`IPFS Upload Deleted Notes Error: ${err.error || response.statusText}`);
	}
};

const deleteDeletedNotesFromIPFS = async (creds) => {
	const query = encodeURIComponent(JSON.stringify({
		keyvalues: {
			app: { value: 'feathernote', op: 'eq' },
			type: { value: 'deleted-notes', op: 'eq' }
		}
	}));
	const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;

	const listResponse = await fetch(listUrl, {
		headers: getPinataHeaders(creds)
	});

	if (listResponse.ok) {
		const data = await listResponse.json();
		for (const row of data.rows) {
			const unpinUrl = `${PINATA_API_BASE}/pinning/unpin/${row.ipfs_pin_hash}`;
			await fetch(unpinUrl, {
				method: 'DELETE',
				headers: getPinataHeaders(creds)
			});
		}
	}
};

const downloadDeletedNotesFromIPFS = async (creds) => {
	if (!creds?.pinataJwt && !creds?.pinataApiKey) return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };

	const query = encodeURIComponent(JSON.stringify({
		keyvalues: {
			app: { value: 'feathernote', op: 'eq' },
			type: { value: 'deleted-notes', op: 'eq' }
		}
	}));
	const listUrl = `${PINATA_API_BASE}/data/pinList?status=pinned&metadata=${query}`;

	const listResponse = await fetch(listUrl, {
		headers: getPinataHeaders(creds)
	});

	if (listResponse.ok) {
		const data = await listResponse.json();
		if (data.rows.length > 0) {
			// Get the most recent one
			const latest = data.rows[0];
			const gateway = creds.ipfsGateway || 'https://gateway.pinata.cloud/ipfs/';
			const response = await fetch(`${gateway}${latest.ipfs_pin_hash}`);
			if (response.ok) {
				return await response.json();
			}
		}
	}
	return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };
};

// Export to window for access from other scripts
window.uploadNoteToIPFS = uploadNoteToIPFS;
window.listNotesInIPFS = listNotesInIPFS;
window.downloadNoteFromIPFS = downloadNoteFromIPFS;
window.deleteNoteFromIPFS = deleteNoteFromIPFS;
window.uploadDeletedNotesToIPFS = uploadDeletedNotesToIPFS;
window.downloadDeletedNotesFromIPFS = downloadDeletedNotesFromIPFS;
