// This is a basic service worker for offline caching and handling shared content.

// --- IndexedDB Functions (duplicated from index.js for Service Worker scope) ---
const DB_NAME = 'FeatherNoteDB';
const DB_VERSION = 3;
const NOTE_STORE = 'notes';
const SHARED_CONTENT_STORE = 'shared-content';
const IMAGE_STORE = 'images';
const CACHE_NAME = 'feathernote-cache-v' + DB_VERSION;

const urlsToCache = [
  '/',
  '/index.html',
  '/index.js',
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


let dbPromise;

const initDB = () => {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => {
            console.error('SW: Error opening database:', event.target.error);
            dbPromise = null;
            reject('Error opening database');
        };
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(NOTE_STORE)) {
                db.createObjectStore(NOTE_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SHARED_CONTENT_STORE)) {
                db.createObjectStore(SHARED_CONTENT_STORE, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(IMAGE_STORE)) {
                db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
            }
        };
    });
    return dbPromise;
};

const getImageDB = async (id) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([IMAGE_STORE], 'readonly');
        const store = transaction.objectStore(IMAGE_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error('SW: Error fetching image from DB:', event.target.error);
            reject('Error fetching image');
        };
    });
};

self.addEventListener('fetch', (event) => {
  console.log('SW Fetch:', event.request.url); // Debugging line
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
          }
        } catch (error) {
          console.error(`SW: Failed to get image ${imageId} from DB`, error);
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
        const formData = await event.request.formData();
        const content = [formData.get('text'), formData.get('url')].filter(x => x).join('\n-\n');
        const title = formData.get('title') || '';

        if (content) {
          await saveSharedContentToDB(title, content);
        }
        
        // Redirect to the home page after sharing
        return Response.redirect('/', 303);
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

async function saveSharedContentToDB(title, content) {
  const db = await initDB(); // Use the new consolidated initDB
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