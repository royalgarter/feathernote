// Helper to convert hex private key to Uint8Array
function hexToBytes(hex) {
    if (typeof hex !== 'string') {
        throw new TypeError('Hex string must be a string.');
    }
    if (hex.length % 2 !== 0) {
        throw new Error('Hex string must have an even number of characters.');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate a new Nostr private key (returns hex string)
function generateNewPrivateKey() {
	const sk = window.NostrTools.generateSecretKey();
    return bytesToHex(sk);
}

// Helper to get private key as bytes from hex or nsec string
function getSkBytes(privateKey) {
    const { nip19 } = window.NostrTools;
    if (privateKey.startsWith('nsec')) {
        const { type, data } = nip19.decode(privateKey);
        if (type === 'nsec') {
            return data;
        }
        throw new Error('Invalid nsec private key.');
    }
    return hexToBytes(privateKey);
}

// Publish a PRIVATE (kind 4) note to a list of relays
async function publishNoteToRelays(relays, privateKey, note) {
	try {
		const { finalizeEvent, getPublicKey, nip04, SimplePool } = window.NostrTools;
		const sk_bytes = getSkBytes(privateKey);
		const pk = getPublicKey(sk_bytes);
		const pool = new SimplePool();

		const encryptedContent = await nip04.encrypt(sk_bytes, pk, JSON.stringify(note));

		const eventTemplate = {
			kind: 4,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['p', pk]
			],
			content: encryptedContent,
		};

		const signedEvent = finalizeEvent(eventTemplate, sk_bytes);

		await Promise.all(pool.publish(relays, signedEvent));
		pool.close(relays);

		return signedEvent;
	} catch (error) {
		console.error("Error publishing private note to Nostr relays:", error);
		return null;
	}
}

// Publish a PUBLIC (kind 30023) note to a list of relays
async function publishPublicNoteToRelays(relays, privateKey, noteContent, noteTitle, noteTags) {
    const { finalizeEvent, getPublicKey, nip19, SimplePool } = window.NostrTools;

    try {
        const sk_bytes = getSkBytes(privateKey);

        const pk = getPublicKey(sk_bytes);
        const pool = new SimplePool();

        const eventTemplate = {
            kind: 30023, // Long-form content
            pubkey: pk,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['d', noteTitle ? noteTitle.toLowerCase().replace(/\s/g, '-') : `note-${Date.now()}`]
            ],
            content: noteContent
        };

        if (noteTitle) {
            eventTemplate.tags.push(['title', noteTitle]);
        }
        if (noteTags && noteTags.length > 0) {
            noteTags.forEach(tag => eventTemplate.tags.push(['t', tag]));
        }

        const signedEvent = finalizeEvent(eventTemplate, sk_bytes);

        const pubs = pool.publish(relays, signedEvent);
        await Promise.all(pubs);
        pool.close(relays);

        const dTagIdentifier = eventTemplate.tags.find(t => t[0] === 'd')[1];
        const naddr = nip19.naddrEncode({
            identifier: dTagIdentifier,
            pubkey: pk,
            kind: 30023,
            relays: relays,
        });
        return { success: true, url: `https://njump.me/${naddr}` };

    } catch (error) {
        console.error("Error publishing public note to Nostr relays:", error);
        return { success: false, error: error.message };
    }
}


async function fetchAndDecryptEventsFromRelays(relays, privateKey) {
    if (!privateKey) {
        return [];
    }

	try {
		const { getPublicKey, nip04, SimplePool } = window.NostrTools;
		const sk_bytes = getSkBytes(privateKey);
		const pk = getPublicKey(sk_bytes);
		const decryptedEventsMap = new Map();
		const pool = new SimplePool();

		const sub = pool.subscribe(relays, {
			kinds: [4],
			'#p': [pk],
			authors: [pk],
		}, {
			onevent(event) {
				console.log('got event:', event)
				(async (event) => {
					try {
						const decryptedContent = await nip04.decrypt(sk_bytes, event.pubkey, event.content);
						const parsedContent = JSON.parse(decryptedContent);
						decryptedEventsMap.set(event.id, parsedContent);
					} catch (error) {
						console.error("Error decrypting or parsing event:", error);
					}
				})(event);
			}
		});

		await new Promise(resolve => setTimeout(resolve, 10e3)); // Wait for events to come in

		pool.close(relays);

		return Array.from(decryptedEventsMap.values());
	} catch (error) {
		console.error("Error fetching and decrypting events from Nostr relays:", error);
		return [];
	}
}

async function publishNoteDeletionToRelays(relays, privateKey, noteId) {
	try {
        const { finalizeEvent, getPublicKey, SimplePool } = window.NostrTools;
        const sk_bytes = getSkBytes(privateKey);
        const pk = getPublicKey(sk_bytes);
		const pool = new SimplePool();

		const eventTemplate = {
			kind: 5,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['e', noteId]
			],
			content: 'Note deleted',
		};

		const signedEvent = finalizeEvent(eventTemplate, sk_bytes);

		await Promise.all(pool.publish(relays, signedEvent));
		pool.close(relays);

		return signedEvent;
	} catch (error) {
		console.error("Error publishing note deletion to Nostr relays:", error);
		return null;
	}
}

async function publishImageToRelays(relays, privateKey, imageRecord) {
	try {
		const { finalizeEvent, getPublicKey, nip04, SimplePool } = window.NostrTools;
        const sk_bytes = getSkBytes(privateKey);
        const pk = getPublicKey(sk_bytes);
		const pool = new SimplePool();

		const encryptedContent = await nip04.encrypt(sk_bytes, pk, JSON.stringify(imageRecord));

		const eventTemplate = {
			kind: 4, // Images are also stored as kind 4 (private) in this app
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['p', pk]
			],
			content: encryptedContent,
		};

		const signedEvent = finalizeEvent(eventTemplate, sk_bytes);

		await Promise.all(pool.publish(relays, signedEvent));
		pool.close(relays);

		return signedEvent;
	} catch (error) {
		console.error("Error publishing image to Nostr relays:", error);
		return null;
	}
}
