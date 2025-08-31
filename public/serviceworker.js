// This is a basic service worker for offline caching and handling shared content.

const CACHE_NAME = 'feathernote-cache-v1';
const SHARED_CONTENT_DB_NAME = 'FeatherNoteDB';
const SHARED_CONTENT_STORE = 'shared-content';

const urlsToCache = [
  '/',
  // Add other important assets to cache here
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
  if (event.request.method === 'POST' && event.request.url.endsWith('/_share-target')) {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const text = formData.get('text') || formData.get('url') || '';
        const title = formData.get('title') || '';
        const content = title ? `${title}\n\n${text}` : text;

        if (content) {
          await saveSharedContentToDB(content);
        }
        
        // Redirect to the home page after sharing
        return Response.redirect('/', 303);
      })()
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((response) => {
        // Cache falling back to the network
        return response || fetch(event.request);
      })
    );
  }
});

function openDB() {
    return new Promise((resolve, reject) => {
        const request = self.indexedDB.open(SHARED_CONTENT_DB_NAME, 1);
        request.onerror = (event) => reject('Error opening IndexedDB');
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(SHARED_CONTENT_STORE)) {
                db.createObjectStore(SHARED_CONTENT_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}


async function saveSharedContentToDB(content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SHARED_CONTENT_STORE, 'readwrite');
    const store = transaction.objectStore(SHARED_CONTENT_STORE);
    const request = store.add({ content: content });
    request.onerror = () => reject('Error saving shared content');
    request.onsuccess = () => resolve();
  });
}
