importScripts('./helpers.js');

const CACHE_NAME = 'feathernote-cache-v' + DB_VERSION;

const urlsToCache = [
	'/',
	'/index.html',
	'/index.js',
	'/helpers.js',
	'/nostr.js',
	'/manifest.json',
	'/favicon.ico',
	'/favicon.png',
	'/icons/icons.json',
	'/libs/aws-sdk-2.1692.0.min.js',
	'https://maxcdn.bootstrapcdn.com/font-awesome/latest/css/font-awesome.min.css',
	'https://maxcdn.bootstrapcdn.com/font-awesome/latest/fonts/fontawesome-webfont.woff2',
	'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
	'https://cdn.jsdelivr.net/gh/reallygoodsoftware/tailwind-lite/dist/2.0.1.css',
	'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/dist/umd/index.min.js',
	'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css',
	'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js',
	'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.x.x/Readability.min.js',
	'https://cdn.jsdelivr.net/npm/nostr-tools@2.16.2/lib/nostr.bundle.min.js,'
	// 'https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js',
];

self.addEventListener('install', (event) => {
	self.skipWaiting(); // Force activation of new service worker
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			console.log('Opened cache');
			return cache.addAll(urlsToCache);
		})
	);
});

self.addEventListener('fetch', (event) => {
	// console.log('SW Fetch:', event.request.url); // Debugging line
	const url = new URL(event.request.url);

	// Intercept image requests
	if (url.pathname.startsWith('/images/')) {
		const imageId = url.pathname.substring(8); // Extract UUID from /images/<uuid>
		event.respondWith(
			(async () => {
				try {
					const imageRecord = await getImageDB(imageId);
					if (imageRecord && imageRecord.blob) {
						return new Response(imageRecord.blob, {
							headers: {
								'Content-Type': imageRecord.blob.type,
								'Cache-Control': 'max-age=31536000', // Cache for a year
							},
						});
					} else {
						// Image not found in IndexedDB, try S3
						console.log(`SW: Image ${imageId} not in DB, attempting S3 download.`);
						const settingsPackage = await getEncryptedSettingsSW(); // Returns { encryptedSettings, userId }
						if (settingsPackage.encryptedSettings) {
								const { encryptedSettings, userId } = settingsPackage;
								const credentials = await decryptSettings(encryptedSettings, userId);

								if (credentials && credentials.bucket && credentials.accessKeyId && credentials.secretAccessKey) {
										try {
												const imageBlob = await downloadImageFromS3V2(imageId, credentials);
												if (imageBlob) {
														// Store downloaded image in IndexedDB for future use
														await addImageDB({ id: imageId, blob: imageBlob, synced: true }); // Mark as synced since it came from S3
														return new Response(imageBlob, {
																headers: {
																		'Content-Type': imageBlob.type,
																		'Cache-Control': 'max-age=31536000',
																},
														});
												}
										} catch (s3Error) {
												console.error(`SW: Failed to download image ${imageId} from S3:`, s3Error);
										}
								} else {
										console.warn('SW: S3 credentials incomplete or invalid for download.');
								}
						} else {
								console.log('SW: No S3 credentials or user ID found in IndexedDB for download.');
						}
					}
				} catch (error) {
					console.error(`SW: Failed to get image ${imageId} from DB or S3`, error);
				}
				// If image not in DB, or on error, return 404
				return new Response('Image not found', { status: 404 });
			})()
		);
		return;
	}

	// Bypass caching for API requests.
	if (url.pathname.startsWith('/api/')) {
		event.respondWith(fetch(event.request));
		return;
	}

	// Handle the share target separately.
	if (event.request.method === 'POST' && url.pathname === '/share') {
		event.respondWith(
			(async () => {
				try {
					const formData = await event.request.formData();
					const text = formData.get('text') || '';
					const sharedUrl = formData.get('url') || '';
					let title = formData.get('title') || '';
					let content;

					if (text && sharedUrl) {
						content = `${text}\n-\n${sharedUrl}`;
					} else {
						content = text || sharedUrl;
					}

					let urlToFetch = sharedUrl;
					if (!urlToFetch) {
						const urlRegex = /(https?:\/\/[^\s]+)/;
						const match = text.match(urlRegex);
						if (match) {
							urlToFetch = match[0];
						}
					}

					let tags = urlToFetch ? [`#needs-clipping`] : undefined;

					if (content) {
						await saveSharedContentToDB(title, content, tags);
					}

					// Redirect to the home page after sharing
					return Response.redirect('/', 303);
				} catch (criticalError) {
					console.error('A critical error occurred in the /share handler:', criticalError);
					// Still attempt to redirect the user back to the app to prevent a hanging screen.
					return Response.redirect('/', 303);
				}
			})()
		);
		return;
	}

	// For all other requests, use the network-first strategy.
	event.respondWith(
		fetch(event.request)
			.then((networkResponse) => {
				if (
					networkResponse &&
					networkResponse.status === 200 &&
					event.request.method === 'GET' &&
					(event.request.url.startsWith('http') || event.request.url.startsWith('https'))
				) {
					const responseToCache = networkResponse.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, responseToCache);
					});
				}
				return networkResponse;
			})
			.catch(() => {
				return caches.match(event.request);
			})
	);
});

async function saveSharedContentToDB(title, content, tags) {
	return addSharedContentDB({ title, content, tags });
}


self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (cacheName !== CACHE_NAME) {
						console.log('Deleting old cache:', cacheName);
						return caches.delete(cacheName);
					}
					return null;
				})
			);
		})
	);
});



self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const urlToOpen = event.notification.data.url || '/';
	event.waitUntil(
		clients.matchAll({
			type: 'window',
			includeUncontrolled: true
		}).then((clientList) => {
			if (clientList.length > 0) {
				let client = clientList[0];
				for (let i = 0; i < clientList.length; i++) {
					if (clientList[i].focused) {
						client = clientList[i];
					}
				}
				return client.focus().then(c => c.navigate(urlToOpen));
			}
			return clients.openWindow(urlToOpen);
		})
	);
});