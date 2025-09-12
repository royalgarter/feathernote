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

	const encryptedContent = await window.NostrTools.nip04.encrypt(privateKey, publicKey, JSON.stringify(note));

	const event = {
		kind: 4,
		pubkey: publicKey,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['p', publicKey]
		],
		content: encryptedContent,
	};

	event.id = window.NostrTools.getEventHash(event);

	const signedEvent = window.NostrTools.signEvent(event, privateKey);

	await Promise.all(pool.publish(relays, signedEvent));

	pool.close(relays);

	return signedEvent;
}



async function fetchAndDecryptEventsFromRelays(relays, privateKey) {
	const pool = new window.NostrTools.SimplePool();
	const publicKey = window.NostrTools.getPublicKey(privateKey);
	const decryptedEvents = [];

	const sub = pool.sub(relays, [
		{
			kinds: [4],
			'#p': [publicKey],
			authors: [publicKey],
		}
	]);

	sub.on('event', async event => {
		try {
			const decryptedContent = await window.NostrTools.nip04.decrypt(privateKey, event.pubkey, event.content);
			const parsedContent = JSON.parse(decryptedContent);
			decryptedEvents.push(parsedContent);
		} catch (error) {
			console.error("Error decrypting or parsing event:", error);
		}
	});

	await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for events to come in

	sub.unsub();
	pool.close(relays);

	return decryptedEvents;
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

	const encryptedContent = await window.NostrTools.nip04.encrypt(privateKey, publicKey, JSON.stringify(imageRecord));

	const event = {
		kind: 4,
		pubkey: publicKey,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['p', publicKey]
		],
		content: encryptedContent,
	};

	event.id = window.NostrTools.getEventHash(event);
	const signedEvent = window.NostrTools.signEvent(event, privateKey);

	await Promise.all(pool.publish(relays, signedEvent));

	pool.close(relays);

	return signedEvent;
}