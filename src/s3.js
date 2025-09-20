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
		const str = new TextEncoder().decode(data.Body);
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
