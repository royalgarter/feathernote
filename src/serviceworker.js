importScripts('./helpers.js');
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  workbox.setConfig({
	debug: false, // Set to true for development
  });

  const { precacheAndRoute } = workbox.precaching;
  const { registerRoute } = workbox.routing;
  const { NetworkFirst, CacheFirst, NetworkOnly } = workbox.strategies;
  const { ExpirationPlugin } = workbox.expiration;

  const CACHE_NAME = 'feathernote-cache-v' + DB_VERSION;

  // Precaching for local assets. Revisions are set to null, so they will be updated if the file changes.
  precacheAndRoute([
	{ url: '/', revision: null },
	{ url: '/index.html', revision: null },
	{ url: '/index.js', revision: null },
	{ url: '/index.css', revision: null },
	{ url: '/helpers.js', revision: null },
	{ url: '/s3.js', revision: null },
	{ url: '/nostr.js', revision: null },
	{ url: '/gdrive.js', revision: null },
	{ url: '/manifest.json', revision: null },
	{ url: '/favicon.ico', revision: null },
	{ url: '/favicon.png', revision: null },
	{ url: '/icons/icons.json', revision: null },
	{ url: '/libs/diff_match_patch.js', revision: null },
	{ url: '/libs/aws-sdk-2.1692.0.min.js', revision: null },
  ]);

  // Caching for external resources (CDNs)
  registerRoute(
	({ url }) => url.origin.startsWith('https://cdn.jsdelivr.net') || url.origin.startsWith('https://maxcdn.bootstrapcdn.com'),
	new CacheFirst({
	  cacheName: 'external-cdn-cache',
	  plugins: [
		new ExpirationPlugin({
		  maxEntries: 50,
		  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
		}),
	  ],
	})
  );

  // Custom handler for images
  registerRoute(
	({ url }) => url.pathname.startsWith('/images/'),
	async ({ url }) => {
	  const imageId = url.pathname.substring(8);
	  try {
		const imageRecord = await getImageDB(imageId);
		if (imageRecord && imageRecord.blob) {
		  return new Response(imageRecord.blob, {
			headers: {
			  'Content-Type': imageRecord.blob.type,
			  'Cache-Control': 'max-age=31536000',
			},
		  });
		} else {
		  console.log(`SW: Image ${imageId} not in DB, attempting S3 download.`);
		  const settingsPackage = await getEncryptedSettingsDB();
		  if (settingsPackage.encryptedSettings) {
			const { encryptedSettings, userId } = settingsPackage;
			const credentials = await decryptSettings(encryptedSettings, userId);
			if (credentials && credentials.bucket && credentials.accessKeyId && credentials.secretAccessKey) {
			  try {
				const imageBlob = await downloadImageFromS3(imageId, credentials);
				if (imageBlob) {
				  await addImageDB({ id: imageId, blob: imageBlob, synced: true });
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
	  return new Response('Image not found', { status: 404 });
	}
  );

  // Network-only for API requests
  registerRoute(
	({ url }) => url.pathname.startsWith('/api/'),
	new NetworkOnly()
  );

  // Custom handler for share target
  registerRoute(
	({ url, request }) => url.pathname === '/share' && request.method === 'POST',
	async ({ event }) => {
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

		return Response.redirect('/', 303);
	  } catch (criticalError) {
		console.error('A critical error occurred in the /share handler:', criticalError);
		return Response.redirect('/', 303);
	  }
	}
  );

  // Default network-first strategy for other GET requests
  registerRoute(
	  ({request}) => request.method === 'GET',
	  new NetworkFirst({
		  cacheName: CACHE_NAME,
	  })
  );

  self.skipWaiting();

} else {
  console.error('Workbox could not be loaded. Falling back to original service worker.');
  // Keep the original content as a fallback
  importScripts('./helpers.js');

  const CACHE_NAME_FALLBACK = 'feathernote-cache-v' + DB_VERSION;

  const urlsToCache = [
	'/',
	'/index.html',
	'/index.js',
	'/index.css',
	'/helpers.js',
	'/s3.js',
	'/nostr.js',
	'/gdrive.js',
	'/manifest.json',
	'/favicon.ico',
	'/favicon.png',
	'/libs/diff_match_patch.js',
	'/icons/icons.json',
	'/libs/aws-sdk-2.1692.0.min.js',
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
	'https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css',
	'https://cdn.jsdelivr.net/npm/diff-match-patch@1.0.5/index.min.js',
  ];

  self.addEventListener('install', (event) => {
	self.skipWaiting(); // Force activation of new service worker
	event.waitUntil(
	  caches.open(CACHE_NAME_FALLBACK).then((cache) => {
		console.log('Opened cache');
		return cache.addAll(urlsToCache);
	  })
	);
  });

  self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	if (url.pathname.startsWith('/images/')) {
	  const imageId = url.pathname.substring(8);
	  event.respondWith(
		(async () => {
		  try {
			const imageRecord = await getImageDB(imageId);
			if (imageRecord && imageRecord.blob) {
			  return new Response(imageRecord.blob, {
				headers: {
				  'Content-Type': imageRecord.blob.type,
				  'Cache-Control': 'max-age=31536000',
				},
			  });
			} else {
			  console.log(`SW: Image ${imageId} not in DB, attempting S3 download.`);
			  const settingsPackage = await getEncryptedSettingsDB();
			  if (settingsPackage.encryptedSettings) {
				  const { encryptedSettings, userId } = settingsPackage;
				  const credentials = await decryptSettings(encryptedSettings, userId);

				  if (credentials && credentials.bucket && credentials.accessKeyId && credentials.secretAccessKey) {
					  try {
						  const imageBlob = await downloadImageFromS3(imageId, credentials);
						  if (imageBlob) {
							  await addImageDB({ id: imageId, blob: imageBlob, synced: true });
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
		  return new Response('Image not found', { status: 404 });
		})()
	  );
	  return;
	}

	if (url.pathname.startsWith('/api/')) {
	  try {
		event.respondWith(fetch(event.request));
	  } catch (e) {}
	  return;
	}

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

			return Response.redirect('/', 303);
		  } catch (criticalError) {
			console.error('A critical error occurred in the /share handler:', criticalError);
			return Response.redirect('/', 303);
		  }
		})()
	  );
	  return;
	}

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
			caches.open(CACHE_NAME_FALLBACK).then((cache) => {
			  cache.put(event.request, responseToCache).catch(err => {
				console.warn(`Failed to cache ${event.request.url}:`, err);
			  });
			});
		  }
		  return networkResponse;
		})
		.catch(() => {
		  return caches.match(event.request);
		})
	);
  });
}


async function saveSharedContentToDB(title, content, tags) {
	return addSharedContentDB({ title, content, tags });
}


self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					try {
						if (cacheName.startsWith('feathernote-cache-') && cacheName !== CACHE_NAME) {
							console.log('Deleting old cache:', cacheName);
							return caches.delete(cacheName);
						}
					} catch (ex) {}

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
