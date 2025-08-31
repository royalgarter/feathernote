// A unique name for our cache
const CACHE_NAME = 'feathernote-v1';

// A function to open the IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FeatherNoteDB', 1);
    request.onerror = (event) => reject('IndexedDB error: ' + event.target.errorCode);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('shared-content')) {
         db.createObjectStore('shared-content', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Service worker install event
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Service worker activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});


// Handle fetch events, especially for share target
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const url = formData.get('url') || '';
        
        const sharedContent = `${title}\n${text}\n${url}`.trim();

        if (sharedContent) {
          const db = await openDB();
          const tx = db.transaction('shared-content', 'readwrite');
          const store = tx.objectStore('shared-content');
          await store.add({ content: sharedContent, timestamp: new Date().toISOString() });
          await new Promise(resolve => tx.oncomplete = resolve);
        }

        return Response.redirect('/', 303);
      } catch (error) {
        console.error('Share target handling failed:', error);
        // Even on error, redirect to the home page.
        return Response.redirect('/', 303);
      }
    })());
  }
});


// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const noteId = event.notification.data?.noteId;
  if (noteId) {
    event.waitUntil(clients.openWindow(`/notes/${noteId}`));
  } else {
    event.waitUntil(clients.openWindow('/'));
  }
});

// Listener for push events for reminders
self.addEventListener('push', (event) => {
  const data = event.data.json();
  const title = 'FeatherNote Reminder';
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: {
        noteId: data.noteId
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
