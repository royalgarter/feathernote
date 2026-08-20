let _GLOBAL = typeof window !== 'undefined' ? window : self;

importScripts('./libs/aws-sdk-2.1692.0.min.js');
importScripts('./libs/isomorphic-git.min.js');
importScripts('./libs/lightning-fs.min.js');
importScripts('./libs/http.min.js');
importScripts('./libs/js-yaml.min.js');
importScripts('./helpers.js');
importScripts('./s3.js');
importScripts('./git.js');
importScripts('./nostr.js');
importScripts('./gdrive.js');

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
	'/self-decrypting.html',
	'/favicon.ico',
	'/favicon.png',
	'/icons/icons.json',
	'/icons/ios/180.png',
	'/icons/ios/192.png',
	'/icons/ios/32.png',
	'/icons/ios/16.png',
	'/icons/ios/512.png',
	'/libs/diff_match_patch.js',
	'/libs/aws-sdk-2.1692.0.min.js',
	'/libs/isomorphic-git.min.js',
	'/libs/lightning-fs.min.js',
	'/libs/http.min.js',
	'/libs/js-yaml.min.js',
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
	'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
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

	if (url.host != self.location.host) {
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
		return;
	}

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
		event.respondWith(fetch(event.request).catch(() => {
			return new Response(JSON.stringify({ error: 'Offline' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			});
		}));
		return;
	}

	// Handle the share target separately.
	if ((event.request.method === 'POST' || event.request.method === 'GET') && url.pathname === '/share') {
		event.respondWith(handleShareTarget(event.request, url));
		return;
	}

	// Default strategy for same-origin requests (e.g., /, index.html, index.js, etc.)
	// Use Cache-First falling back to Network.
	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) {
				return cachedResponse;
			}
			return fetch(event.request).then((networkResponse) => {
				if (
					networkResponse &&
					networkResponse.status === 200 &&
					event.request.method === 'GET'
				) {
					const responseToCache = networkResponse.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, responseToCache);
					});
				}
				return networkResponse;
			});
		})
	);
});

self.addEventListener('activate', (event) => {
	self.clients.claim(); // Take control of all open clients immediately
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

const scheduledNotifications = new Map();

self.addEventListener('message', (event) => {
	if (!event.data) return;

	if (event.data.action === 'SCHEDULE_NOTIFICATION') {
		const { id, title, content, delay, url } = event.data;

		// Cancel existing if any
		if (scheduledNotifications.has(id)) {
			clearTimeout(scheduledNotifications.get(id));
			scheduledNotifications.delete(id);
		}

		if (delay > 0) {
			const timeoutId = setTimeout(() => {
				self.registration.showNotification(title, {
					body: content,
					icon: '/favicon.png',
					badge: '/favicon.png',
					data: { url: url }
				});
				scheduledNotifications.delete(id);
			}, delay);
			scheduledNotifications.set(id, timeoutId);
			console.log(`SW: Scheduled notification for note ${id} in ${Math.floor(delay / 1000)}s`);
		}
	} else if (event.data.action === 'CANCEL_NOTIFICATION') {
		const { id } = event.data;
		if (scheduledNotifications.has(id)) {
			clearTimeout(scheduledNotifications.get(id));
			scheduledNotifications.delete(id);
			console.log(`SW: Cancelled notification for note ${id}`);
		}
	}
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

self.addEventListener('push', (event) => {
	let data = {};
	if (event.data) {
		try {
			data = event.data.json();
		} catch (e) {
			data = { title: 'New Notification', body: event.data.text() };
		}
	}

	const title = data.title || data.notification?.title || 'FeatherNote Reminder';
	const body = data.body || data.notification?.body || 'You have a new reminder.';
	const icon = data.icon || '/favicon.png';
	const badge = data.badge || '/favicon.png';
	const url = data.data?.url || data.url || '/';

	event.waitUntil(
		self.registration.showNotification(title, {
			body: body,
			icon: icon,
			badge: badge,
			data: { url: url }
		})
	);
});

self.addEventListener('periodicsync', (event) => {
	if (event.tag === 'sync-notes') {
		console.log('SW: Periodic sync triggered');
		event.waitUntil(handlePeriodicSync());
	}
});

async function handlePeriodicSync() {
	try {
		const storedUser = await performDBOperation(META_STORE, 'readonly', 'get', 'user_id');
		const userId = storedUser ? storedUser.value : null;

		const storedData = await getEncryptedSettingsDB();
		const encryptedSettings = storedData ? storedData.encryptedSettings : null;

		if (!encryptedSettings) {
			console.log('SW: Periodic sync skipped, no S3 credentials.');
			return;
		}

		const credentials = await decryptSettings(encryptedSettings, userId);
		const lastSync = await performDBOperation(META_STORE, 'readonly', 'get', 'lastSync');
		const deletedNoteIdsRaw = await performDBOperation(META_STORE, 'readonly', 'get', 'deletedNoteIds');
		const deletedNoteIds = deletedNoteIdsRaw ? JSON.parse(deletedNoteIdsRaw.value) : [];

		const gitCredentials = {
			repoUrl: credentials.gitRepoUrl,
			branch: credentials.gitBranch,
			username: credentials.gitUsername,
			token: credentials.gitToken,
			corsProxy: credentials.gitCorsProxy,
			email: credentials.gitEmail
		};

		// For Periodic Sync, we do a full sync
		const result = await synchronize({
			notes: null,
			deletedNoteIds: deletedNoteIds,
			isSilent: true,
			credentials,
			lastSync: lastSync ? lastSync.value : null,
			nostrPrivateKey: credentials.nostrPrivateKey,
			nostrRelays: credentials.nostrRelays,
			gdriveStore: credentials.gdriveStore,
			gitCredentials
		});

		if (result.success) {
			console.log('SW: Periodic sync successful', result);
			
			// Update local DB with results
			for (const remoteNote of result.updatedNotes || []) {
				await updateNoteDB(remoteNote);
			}

			for (const noteIdToDelete of result.notesToDeleteLocally || []) {
				await deleteNoteDB(noteIdToDelete);
			}

			if (result.effectiveDeletedNoteIds) {
				await performDBOperation(META_STORE, 'readwrite', 'put', { key: 'deletedNoteIds', value: JSON.stringify(result.effectiveDeletedNoteIds) });
			}

			await performDBOperation(META_STORE, 'readwrite', 'put', { key: 'lastSync', value: new Date().toISOString() });
		} else {
			console.error('SW: Periodic sync failed', result.error);
		}
	} catch (error) {
		console.error('SW: Periodic sync error', error);
	}
}

// Test URL: http://localhost:7347/share?title=Testing%20Snappy%20Share&url=https://news.ycombinator.com&text=Check%20out%20this%20link
async function handleShareTarget(request, url) {
	let noteIdToRedirect = '';
	let summaryItem = '';
	try {
		const data = request.method === 'POST' ? await request.formData() : url.searchParams;
		const TITLE_SHARED = 'Shared Inbox';

		let text = data.get('text') || '';
		let title = data.get('title') || '';
		let sharedUrl = data.get('url') || '';
		let imageFile = data.get('image');

		title = title.replace(/\n/g, ' ');

		let imageReference = '';
		if (imageFile instanceof File) {
			const imageId = generateUniqueId('img');
			await addImageDB({ id: imageId, blob: imageFile, synced: false });
			imageReference = `![Shared Image](/images/${imageId})\n`;
		}

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
				text = text.replaceAll('\n', ' | ');
			}
			text = text.trim();
			if (!title.includes(text) && !sharedUrl.includes(text)) {
				if (title || sharedUrl) {
					newItem += ` > ${text}`;
				} else {
					newItem += text;
				}
			}
		}

		if (newItem.trim() !== '*') {
			summaryItem = (title || sharedUrl || text || 'New shared item').substring(0, 100);
			if (imageFile instanceof File) {
				// Create a new individual note for the shared image
				const now = new Date();
				const timestamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
				
				const imageNote = {
					id: 'shared-image-' + generateUniqueId(),
					title: 'Shared Image ' + timestamp,
					content: imageReference,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					tags: ['shared', 'image'],
				};
				await addNoteDB(imageNote);
				noteIdToRedirect = imageNote.id;
			} else {
				let targetNoteId = await getMetaDB('shared_inbox_id');
				let targetNote = targetNoteId ? await getNoteDB(targetNoteId) : null;
				if (!targetNote) targetNote = await getNoteByTitleDB(TITLE_SHARED);

				const finalContent = newItem;
				if (targetNote) {
					if (targetNote.content) {
						targetNote.content = finalContent + '\n' + targetNote.content;
					} else {
						targetNote.content = finalContent;
					}
					targetNote.updatedAt = new Date().toISOString();
					await updateNoteDB(targetNote);
					noteIdToRedirect = targetNote.id;
					if (targetNote.id !== targetNoteId) await setMetaDB('shared_inbox_id', targetNote.id);
				} else {
					const newNote = {
						id: 'shared-inbox-' + generateUniqueId(),
						title: TITLE_SHARED,
						content: finalContent,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						tags: ['shared', 'inbox'],
					};
					await addNoteDB(newNote);
					noteIdToRedirect = newNote.id;
					await setMetaDB('shared_inbox_id', newNote.id);
				}
			}
		}
	} catch (criticalError) {
		console.error('A critical error occurred in the /share handler:', criticalError);
	}

	const openUrl = '/' + (noteIdToRedirect ? `?preview=true#edit_note-${noteIdToRedirect}` : '');
	const safeSummary = summaryItem.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Shared - FeatherNote</title>
	<meta name="theme-color" content="#A2D2FF">
	<link rel="icon" type="image/png" href="/favicon.png">
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif;
			margin: 0;
			padding: 20px;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: #f8fafc;
			color: #1e293b;
		}
		.card {
			background: #ffffff;
			border: 1px solid #e2e8f0;
			border-radius: 16px;
			padding: 28px 24px;
			max-width: 360px;
			width: 100%;
			text-align: center;
			box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.08);
		}
		.icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 48px;
			height: 48px;
			border-radius: 50%;
			background-color: #dcfce7;
			color: #16a34a;
			font-size: 24px;
			margin-bottom: 16px;
		}
		h2 {
			margin: 0 0 8px 0;
			font-size: 1.25rem;
			font-weight: 700;
		}
		p.preview {
			font-size: 0.875rem;
			color: #64748b;
			margin: 0 0 24px 0;
			overflow: hidden;
			text-overflow: ellipsis;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			word-break: break-all;
		}
		.actions {
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.btn {
			display: block;
			width: 100%;
			padding: 12px 16px;
			border-radius: 8px;
			font-size: 0.95rem;
			font-weight: 600;
			text-decoration: none;
			cursor: pointer;
			border: none;
		}
		.btn-primary {
			background-color: #A2D2FF;
			color: #0f172a;
		}
		.btn-primary:hover {
			background-color: #8ecae6;
		}
		.btn-secondary {
			background-color: #f1f5f9;
			color: #475569;
		}
		.btn-secondary:hover {
			background-color: #e2e8f0;
		}
	</style>
</head>
<body>
	<div class="card">
		<div class="icon">✓</div>
		<h2>Saved to Shared Inbox</h2>
		<p class="preview">${safeSummary || 'Item appended successfully'}</p>
		<div class="actions">
			<a href="${openUrl}" class="btn btn-primary">Open in FeatherNote</a>
			<button onclick="window.close(); history.back();" class="btn btn-secondary">Close</button>
		</div>
	</div>
</body>
</html>`;

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
}
