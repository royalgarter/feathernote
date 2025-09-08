// This is a basic service worker for offline caching and handling shared content.

const CACHE_NAME = 'feathernote-cache-v2';
const SHARED_CONTENT_DB_VERSION = 2;
const SHARED_CONTENT_DB_NAME = 'FeatherNoteDB';
const SHARED_CONTENT_STORE = 'shared-content';

const urlsToCache = [
  '/',
  '/index.html',
  '/index.js',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/icons/icons.json',
  'https://maxcdn.bootstrapcdn.com/font-awesome/latest/css/font-awesome.min.css',
  'https://maxcdn.bootstrapcdn.com/font-awesome/latest/fonts/fontawesome-webfont.woff2',
  'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
  'https://cdn.jsdelivr.net/gh/reallygoodsoftware/tailwind-lite/dist/2.0.1.css',
  'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/dist/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css',
  'https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js',
  // 'https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass caching for API requests.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Handle the share target separately.
  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const content = [formData.get('text'), formData.get('url')].filter(x => x).join('\n-\n');
        const title = formData.get('title') || '';

        if (content) {
          await saveSharedContentToDB(title, content);
        }
        
        // Redirect to the home page after sharing
        return Response.redirect(`/?title=${encodeURIComponent(title)}&content=${encodeURIComponent(text)}`, 303);
      })()
    );
    return;
  }

  // For all other requests, use the network-first strategy.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Only cache successful GET requests with http/https schemes.
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

function openDB() {
    return new Promise((resolve, reject) => {
        const request = self.indexedDB.open(SHARED_CONTENT_DB_NAME, SHARED_CONTENT_DB_VERSION);
        request.onerror = (event) => {
            console.error('Error opening IndexedDB:', event.target.error);
            reject(`Error opening IndexedDB: ${event.target.error}`);
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(SHARED_CONTENT_STORE)) {
                db.createObjectStore(SHARED_CONTENT_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}


async function saveSharedContentToDB(title, content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SHARED_CONTENT_STORE, 'readwrite');
    const store = transaction.objectStore(SHARED_CONTENT_STORE);
    const request = store.add({ title, content });
    request.onerror = (event) => {
        console.error('Error saving shared:', event.target.error);
        reject('Error saving shared: ' + event.target.error);
    };
    request.onsuccess = () => resolve();
  });
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