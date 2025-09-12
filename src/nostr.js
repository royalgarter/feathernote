// Generate a new Nostr private key
function generateNewPrivateKey() {
	return window.NostrTools.generatePrivateKey();
}

// Get the public key from a private key
function getPublicKeyFromPrivateKey(privateKey) {
	return window.NostrTools.getPublicKey(privateKey);
}

// Publish a note to a list of relays
async function publishNoteToRelays(relays, privateKey, note) {
	const pool = new window.NostrTools.SimplePool();
	const publicKey = window.NostrTools.getPublicKey(privateKey);

	const event = {
	kind: 1,
	pubkey: publicKey,
	created_at: Math.floor(Date.now() / 1000),
	tags: note.tags.map(tag => ['t', tag]),
	content: JSON.stringify(note),
	};

	event.id = window.NostrTools.getEventHash(event);

	const signedEvent = window.NostrTools.signEvent(event, privateKey);

	await Promise.all(pool.publish(relays, signedEvent));

	pool.close(relays);

	return signedEvent;
}



async function publishNoteDeletionToRelays(relays, privateKey, noteId) {
	const pool = new window.NostrTools.SimplePool();
	const publicKey = window.NostrTools.getPublicKey(privateKey);

	const event = {
		kind: 5,
		pubkey: publicKey,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['e', noteId]
		],
		content: 'Note deleted',
	};

	event.id = window.NostrTools.getEventHash(event);
	const signedEvent = window.NostrTools.signEvent(event, privateKey);

	await Promise.all(pool.publish(relays, signedEvent));

	pool.close(relays);

	return signedEvent;
}

async function publishImageToRelays(relays, privateKey, imageRecord) {
	const pool = new window.NostrTools.SimplePool();
	const publicKey = window.NostrTools.getPublicKey(privateKey);

	const event = {
		kind: 1063, // Image
		pubkey: publicKey,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['u', imageRecord.url],
			['x', imageRecord.id]
		],
		content: 'Image uploaded',
	};

	event.id = window.NostrTools.getEventHash(event);
	const signedEvent = window.NostrTools.signEvent(event, privateKey);

	await Promise.all(pool.publish(relays, signedEvent));

	pool.close(relays);

	return signedEvent;
}