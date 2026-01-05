importScripts('./libs/aws-sdk-2.1692.0.min.js');
importScripts('./s3.js');
importScripts('./helpers.js');

const CACHE_NAME = 'feathernote-cache-v' + DB_VERSION;

const urlsToCache = [
	'/',
	'/index.html',
	'/index.js',
	'/index.css',
	'/helpers.js',
	'/s3.js',
	'/git.js',
	'/nostr.js',
	'/gdrive.js',
	'/manifest.json',
	'/favicon.ico',
	'/favicon.png',
	'/icons/icons.json',
	'/icons/ios/180.png',
	'/icons/ios/32.png',
	'/icons/ios/16.png',
	'/icons/ios/512.png',
	'/libs/diff_match_patch.js',
	'/libs/aws-sdk-2.1692.0.min.js',
	'/libs/isomorphic-git.min.js',
	'/libs/lightning-fs.min.js',
	'/libs/http.min.js',
	'https://maxcdn.bootstrapcdn.com/font-awesome/latest/css/font-awesome.min.css',
	'https://maxcdn.bootstrapcdn.com/font-awesome/latest/fonts/fontawesome-webfont.woff2?v=4.7.0',
	'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
	'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
	'https://cdn.jsdelivr.net/gh/reallygoodsoftware/tailwind-lite/dist/2.0.1.css',
	'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/dist/umd/index.min.js',
	'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css',
	'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js',
	'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.x.x/Readability.min.js',
	'https://cdn.jsdelivr.net/npm/nostr-tools@2.16.2/lib/nostr.bundle.min.js',
	// 'https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css',
	// 'https://cdn.jsdelivr.net/npm/diff-match-patch@1.0.5/index.min.js',
	'https://cdn.jsdelivr.net/npm/marked-katex-extension@5.1.5/lib/index.umd.min.js',
	'https://cdn.jsdelivr.net/npm/marked-highlight@2.2.2/lib/index.umd.min.js',
	'https://cdn.jsdelivr.net/npm/marked@16.4.0/lib/marked.umd.min.js',
	'https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/katex.min.js',
	'https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/katex.min.css',
	'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/default.min.css',
	'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/highlight.min.js',
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

	if (url.host == self.location.host) {
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
							const settingsPackage = await getEncryptedSettingsDB(); // Returns { encryptedSettings, userId }
							if (settingsPackage.encryptedSettings) {
								const { encryptedSettings, userId } = settingsPackage;
								const credentials = await decryptSettings(encryptedSettings, userId);

								if (credentials && credentials.bucket && credentials.accessKeyId && credentials.secretAccessKey) {
									try {
										const imageBlob = await downloadImageFromS3(imageId, credentials);
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
			try {
				event.respondWith(fetch(event.request));
			} catch (e) {}
			return;
		}

		// Handle the share target separately.
		if (event.request.method === 'POST' && url.pathname === '/share') {
			event.respondWith(
				(async () => {
					let noteIdToRedirect = '';
					try {
						const formData = await event.request.formData();
						const TITLE_SHARED = 'Shared Inbox';

						let text = formData.get('text') || '';
						let title = formData.get('title') || '';
						let sharedUrl = formData.get('url') || '';

						title = title.replace(/\n/g, ' ');

						const urlRegex = /(https?:\/\/[^\s]+)/g;

						if (!sharedUrl) {
							// Try to find URL in text or title if not explicitly provided
							const textUrlMatch = text.match(urlRegex);
							const titleUrlMatch = title.match(urlRegex);

							if (textUrlMatch) {
								sharedUrl = textUrlMatch[0];
							} else if (titleUrlMatch) {
								sharedUrl = titleUrlMatch[0];
							} else {
								// Fallback: try decoding if it looks like an encoded URL
								try {
									const decodedText = decodeURIComponent(text);
									const decodedMatch = decodedText.match(urlRegex);
									if (decodedMatch) sharedUrl = decodedMatch[0];
								} catch (e) {}
							}
						}

						let newItem = '- [ ] ';
						if (title && sharedUrl) {
							newItem += `[${title}](${sharedUrl})`;
						} else if (title) {
							newItem += title;
						} else if (sharedUrl) {
							newItem += `[${sharedUrl}](${sharedUrl})`;
						}

						if (text) {
							if (text.trim().includes('\n')) {
								text = '\n```\n' + text + '\n```\n';
							}

							if (title || sharedUrl) {
								newItem += ` > ${text}`;
							} else {
								newItem += text;
							}
						}

						if (newItem.trim() !== '*') {
							const allNotes = await getNotesDB();
							let inboxNote = allNotes.find(note => note.title === TITLE_SHARED);

							if (inboxNote) {
								if (inboxNote.content) {
									inboxNote.content = newItem + '\n' + inboxNote.content;
								} else {
									inboxNote.content = newItem;
								}
								inboxNote.updatedAt = new Date().toISOString();
								await updateNoteDB(inboxNote);
								noteIdToRedirect = inboxNote.id;
							} else {
								// Create a new inbox note
								const newNote = {
									id: 'shared-inbox-' + generateUniqueId(),
									title: TITLE_SHARED,
									content: newItem,
									createdAt: new Date().toISOString(),
									updatedAt: new Date().toISOString(),
									tags: ['shared', 'inbox'],
								};
								await addNoteDB(newNote);
								noteIdToRedirect = newNote.id;
							}
						}
					} catch (criticalError) {
						console.error('A critical error occurred in the /share handler:', criticalError);
					}

					return Response.redirect('/' + (noteIdToRedirect ? `#edit_note-${noteIdToRedirect}` : ''), 303);
				})()
			);
			return;
		}
	}

	// For all other requests, use Stale-While-Revalidate strategy.
	event.respondWith(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.match(event.request, {ignoreSearch: false}).then((cachedResponse) => {
				const fetchPromise = fetch(event.request).then((networkResponse) => {
					if (
						networkResponse &&
						networkResponse.status === 200 &&
						event.request.method === 'GET' &&
						(event.request.url.startsWith('http') || event.request.url.startsWith('https'))
					) {
						cache.put(event.request, networkResponse.clone());
					}
					return networkResponse;
				});

				if (cachedResponse) {
					event.waitUntil(fetchPromise.catch(() => {}));
					return cachedResponse;
				}

				return fetchPromise;
			});
		})
	);
});


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