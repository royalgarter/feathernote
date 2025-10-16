// --- S3 Functions (Client-side AWS SDK v2) ---
// Assumes AWS SDK is loaded globally
const getS3Client = async (creds) => {
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
		signatureVersion: 'v4',
	});
};

const getS3ObjectKey = (noteId, creds) => {
	const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
	return (noteId?.includes('images/') || noteId.includes('.html')) ? `${path}${noteId}` : `${path}${noteId}.json` ;
};

const uploadNoteToS3 = async (note, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
	const body = note.html || JSON.stringify(note, null, 2);

	const params = {
		Bucket: creds.bucket,
		Key: getS3ObjectKey(note.id + (note.html ? '.html' : ''), creds),
		Body: body,
		ContentType: note.html ? 'text/html' : 'application/json',
	};

	await s3.upload(params).promise();
};

const listNotesInS3 = async (creds) => {
	if (!creds?.secretAccessKey) return [];

	const s3 = await getS3Client(creds);
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
				if (!item.Key || item.Key.endsWith('/') || item.Key.includes('/images/') || !item.Key.includes('.json')) return null;

				return {
					id: item.Key.replace(prefix, '').replace('.json', ''),
					updatedAt: item.LastModified,
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

	return allNoteMetadata;
};

const downloadNoteFromS3 = async (noteId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
	const key = getS3ObjectKey(noteId, creds);
	const params = {
		Bucket: creds.bucket,
		Key: key,
	};

	const data = await s3.getObject(params).promise();
	if (data.Body) {
		const str = (new TextDecoder()).decode(data.Body);
		return JSON.parse(str);
	} else {
		throw new Error('Downloaded note has no body');
	}
};

const getNoteMetadataFromS3 = async (noteId, creds) => {
	try {
		if (!creds?.secretAccessKey) return;

		const s3 = await getS3Client(creds);
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

const deleteNoteFromS3 = async (noteId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
	const key = getS3ObjectKey(noteId, creds);
	const params = {
		Bucket: creds.bucket,
		Key: key,
	};

	await s3.deleteObject(params).promise();
};

// --- S3 Functions for Images ---
const getImageS3ObjectKey = (imageId, imageType, creds) => {
	const path = creds.subfolder ? `${creds.subfolder.replace(/\/$/, '')}/` : '';
	const extension = imageType.split('/')[1] || 'bin';
	return `${path}images/${imageId}.${extension}`;
};

const uploadImageToS3 = async (imageRecord, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
	const key = getImageS3ObjectKey(imageRecord.id, imageRecord.blob.type, creds);

	const params = {
		Bucket: creds.bucket,
		Key: key,
		Body: imageRecord.blob,
		ContentType: imageRecord.blob.type,
	};
	await s3.upload(params).promise();
};

const downloadImageFromS3 = async (imageId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
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

const listImagesInS3 = async (creds) => {
	if (!creds?.secretAccessKey) return [];

	const s3 = await getS3Client(creds);
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

	return allImageMetadata;
};

const deleteImageFromS3 = async (imageId, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
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
			const deleteParams = {
				Bucket: creds.bucket,
				Key: exactKey,
			};
			await s3.deleteObject(deleteParams).promise();
		} else {
			console.log(`Image with ID ${imageId} not found in S3 for deletion.`);
		}
	} catch (error) {
		console.error(`S3 Delete Error for image ${imageId}:`, error);
		throw new Error(`Failed to delete image from S3: ${error.code || error.message}`);
	}
};

const getPresignedUrl = async (note, creds) => {
	if (!creds?.secretAccessKey) return;

	const s3 = await getS3Client(creds);
	const key = getS3ObjectKey(note.id + (note.html ? '.html' : ''), creds);
	const params = {
		Bucket: creds.bucket,
		Key: key,
		Expires: 60 * 60 * 24 * 7, // 7 days
	};

	return s3.getSignedUrlPromise('getObject', params);
};

