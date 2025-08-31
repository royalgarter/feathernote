import { type Note } from '@/contexts/NoteContext';

const DB_NAME = 'FeatherNoteDB';
const DB_VERSION = 1;
const NOTE_STORE = 'notes';
const SHARED_CONTENT_STORE = 'shared-content';

let db: IDBDatabase;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject('Error opening database');
    };

    request.onsuccess = (event) => {
      db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      if (!dbInstance.objectStoreNames.contains(NOTE_STORE)) {
        dbInstance.createObjectStore(NOTE_STORE, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(SHARED_CONTENT_STORE)) {
        dbInstance.createObjectStore(SHARED_CONTENT_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
};

export const getNotesDB = async (): Promise<Note[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTE_STORE], 'readonly');
    const store = transaction.objectStore(NOTE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject('Error fetching notes');
    };
  });
};

export const getNoteDB = async (id: string): Promise<Note | undefined> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTE_STORE], 'readonly');
    const store = transaction.objectStore(NOTE_STORE);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject('Error fetching note');
    };
  });
};

export const addNoteDB = async (note: Note): Promise<Note> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTE_STORE], 'readwrite');
    const store = transaction.objectStore(NOTE_STORE);
    const request = store.add(note);

    request.onsuccess = () => {
      resolve(note);
    };
    request.onerror = () => {
      reject('Error adding note');
    };
  });
};

export const updateNoteDB = async (note: Note): Promise<Note> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([NOTE_STORE], 'readwrite');
        const store = transaction.objectStore(NOTE_STORE);
        const request = store.put(note);

        request.onsuccess = () => {
            resolve(note);
        };
        request.onerror = (e) => {
            console.error('Update note error:', e);
            reject('Error updating note');
        };
    });
};

export const deleteNoteDB = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([NOTE_STORE], 'readwrite');
    const store = transaction.objectStore(NOTE_STORE);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject('Error deleting note');
    };
  });
};


export const getSharedContentDB = async (): Promise<{id: number, content: string}[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SHARED_CONTENT_STORE], 'readonly');
    const store = transaction.objectStore(SHARED_CONTENT_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject('Error fetching shared content');
    };
  });
};

export const clearSharedContentDB = async (): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SHARED_CONTENT_STORE], 'readwrite');
      const store = transaction.objectStore(SHARED_CONTENT_STORE);
      const request = store.clear();
  
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject('Error clearing shared content');
      };
    });
  };
