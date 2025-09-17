/*
 * FeatherNote Google Drive Sync
 *
 * This file contains the logic for authenticating with Google and syncing notes
 * to the user's Google Drive using the App Data folder.
 *
 * The sync logic implements a "last-write-wins" strategy, similar to the S3 sync.
 */

// --- Constants and State ---

// IMPORTANT: These must be configured in your Google Cloud project.
// See README.md for details.
const GDRIVE_CLIENT_ID = '547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com'; // Placeholder
const GDRIVE_API_KEY = ''; // Placeholder - might not be needed for AppData folder access
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let gapiInited = false;
let gisInited = false;
let tokenClient;
let accessToken = null;

// --- Initialization Functions ---

/**
 * Callback after the GAPI library is loaded.
 */
function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

/**
 * Initializes the GAPI client.
 */
async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: GDRIVE_API_KEY,
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
  });
  gapiInited = true;
  // Maybe trigger a check here if both are loaded
}

/**
 * Callback after the GIS library is loaded.
 */
function gisLoaded() {
  const app = Alpine.$data(document.querySelector('[x-data]'));
  if (!app.GDRIVE_CLIENT_ID) {
      console.error("GDRIVE_CLIENT_ID is not configured in index.js");
      return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: app.GDRIVE_CLIENT_ID,
    scope: GDRIVE_SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        accessToken = tokenResponse.access_token;
        
        // Update the main app's state
        const app = Alpine.$data(document.querySelector('[x-data]'));
        app.gdriveStore.connected = true;
        
        // Fetch user info
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
        .then(response => response.json())
        .then(userInfo => {
          app.gdriveStore.user = userInfo;
          app.showToast({ title: 'Connected', description: `Connected to Google Drive as ${userInfo.name}.` });
        });

        // Trigger a sync
        syncGoogleDriveNotes();

      } else {
        console.error("No access token received.");
        const app = Alpine.$data(document.querySelector('[x-data]'));
        app.showToast({ variant: 'error', title: 'Connection Failed', description: 'Could not get access token from Google.' });
      }
    },
  });
  gisInited = true;
}


// --- Authentication Functions ---

/**
 *  Sign in the user with Google Drive scope.
 */
function signInToGoogleDrive() {
  if (tokenClient) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken({prompt: 'consent'});
  }
}

/**
 *  Sign out the user.
 */
function signOutFromGoogleDrive() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log('Access token revoked.');
            accessToken = null;
            // Update UI accordingly
        });
    }
}


// --- Sync Logic ---

/**
 * Main function to synchronize notes with Google Drive.
 * Implements a "last-write-wins" strategy.
 */
async function syncGoogleDriveNotes(isSilent = false, deletedNoteIds = []) {
    if (!accessToken) {
        throw new Error("Google Drive sync cancelled: Not authenticated.");
    }

    console.log("Starting Google Drive sync...");
    
    // 1. Fetch all local notes
    const localNotes = await getNotesDB();

    // 2. Fetch all remote files from AppData folder
    const remoteFiles = await listAllFiles();

    // 3. Handle deletions on remote
    const deletePromises = deletedNoteIds.map(id => deleteNoteFromDrive(id));

    // 4. Compare and decide which notes to upload or download
    const toUpload = [];
    const toDownload = [];
    const remoteFilesMap = new Map(remoteFiles.map(file => [file.name.replace('.json', ''), file]));
    const localNotesMap = new Map(localNotes.map(note => [note.id, note]));

    // Check for notes to upload
    for (const localNote of localNotes) {
        if (deletedNoteIds.includes(localNote.id)) continue; // Don't upload notes marked for deletion

        const remoteFile = remoteFilesMap.get(localNote.id);
        if (!remoteFile) {
            toUpload.push(localNote);
        } else {
            const remoteTimestamp = new Date(remoteFile.modifiedTime).getTime();
            const localTimestamp = new Date(localNote.updatedAt).getTime();
            if (localTimestamp > remoteTimestamp) {
                toUpload.push(localNote);
            }
        }
    }

    // Check for notes to download and notes to delete locally
    const remoteIds = new Set();
    for (const remoteFile of remoteFiles) {
        const noteId = remoteFile.name.replace('.json', '');
        remoteIds.add(noteId);
        const localNote = localNotesMap.get(noteId);
        if (!localNote) {
            if (!deletedNoteIds.includes(noteId)) { // Don't download if it was just deleted locally
                toDownload.push(remoteFile);
            }
        } else {
            const remoteTimestamp = new Date(remoteFile.modifiedTime).getTime();
            const localTimestamp = new Date(localNote.updatedAt).getTime();
            if (remoteTimestamp > localTimestamp) {
                toDownload.push(remoteFile);
            }
        }
    }

    // Check for notes that were deleted on another device
    const notesToDeleteLocally = [];
    for (const localNote of localNotes) {
        if (!remoteIds.has(localNote.id) && !toUpload.some(n => n.id === localNote.id)) {
            notesToDeleteLocally.push(localNote.id);
        }
    }
    const localDeletePromises = notesToDeleteLocally.map(id => deleteNoteDB(id));


    console.log(`To Upload: ${toUpload.length}, To Download: ${toDownload.length}, To Delete Remote: ${deletePromises.length}, To Delete Local: ${localDeletePromises.length}`);

    // 5. Execute all operations
    const uploadPromises = toUpload.map(note => uploadNote(note));
    const downloadPromises = toDownload.map(file => downloadNote(file.id));

    await Promise.all([
        ...uploadPromises,
        ...downloadPromises,
        ...deletePromises,
        ...localDeletePromises
    ]);

    console.log("Google Drive sync finished.");
}


// --- Google Drive API Helper Functions ---

async function callDriveApi(apiCall) {
    try {
        return await apiCall();
    } catch (err) {
        if (err.result && err.result.error && err.result.error.code === 401) {
            console.error("Google Drive API returned 401. The access token has likely expired.");
            const app = Alpine.$data(document.querySelector('[x-data]'));
            if (app) {
                app.gdriveStore.connected = false;
                app.showToast({ variant: 'error', title: 'Session Expired', description: 'Please connect to Google Drive again.' });
            }
            accessToken = null; // Clear the expired token
            throw new Error('Google Drive session expired. Please re-authenticate.');
        } else {
            throw err; // Re-throw other errors
        }
    }
}

/**
 * Lists all files in the appDataFolder.
 * @returns {Promise<Array>} A promise that resolves with a list of file metadata.
 */
async function listAllFiles() {
    try {
        let files = [];
        let pageToken = null;
        do {
            const response = await gapi.client.drive.files.list({
                spaces: 'appDataFolder',
                fields: 'nextPageToken, files(id, name, modifiedTime)',
                pageSize: 100,
                pageToken: pageToken,
            });
            files = files.concat(response.result.files);
            pageToken = response.result.nextPageToken;
        } while (pageToken);
        return files;
    } catch (err) {
        console.error("Error listing files:", err);
        return [];
    }
}

/**
 * Downloads a note from Google Drive and saves it to IndexedDB.
 * @param {string} fileId The ID of the file to download.
 * @returns {Promise<Object|null>} A promise that resolves with the note object or null.
 */
async function downloadNote(fileId) {
    try {
        const response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        const note = JSON.parse(response.body);
        
        const existingNote = await getNoteDB(note.id);
        if (existingNote) {
            await updateNoteDB(note);
        } else {
            await addNoteDB(note);
        }
        
        return note;
    } catch (err) {
        console.error(`Error downloading file ${fileId}:`, err);
        return null;
    }
}

/**
 * Uploads a note to Google Drive. Handles both creation and updates.
 * @param {Object} note The note object to upload.
 */
async function uploadNote(note) {
    const noteId = note.id;
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    // Check if file already exists
    const existingFiles = await listAllFiles();
    const existingFile = existingFiles.find(f => f.name === `${noteId}.json`);

    const metadata = {
        'name': `${noteId}.json`,
        'mimeType': 'application/json',
    };
    
    if (!existingFile) {
        metadata.parents = ['appDataFolder'];
    }

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(note) +
        close_delim;

    const path = existingFile ? `/upload/drive/v3/files/${existingFile.id}` : '/upload/drive/v3/files';
    
    const request = () => gapi.client.request({
        'path': path,
        'method': existingFile ? 'PATCH' : 'POST',
        'params': { 'uploadType': 'multipart' },
        'headers': {
            'Content-Type': 'multipart/related; boundary="' + boundary + '"'
        },
        'body': multipartRequestBody
    });

    try {
        await callDriveApi(request);
        console.log(`Successfully uploaded note ${noteId}`);
    } catch (err) {
        console.error(`Error uploading note ${noteId}:`, err);
    }
}

/**
 * Deletes a note from Google Drive.
 * @param {string} noteId The ID of the note to delete.
 */
async function deleteNoteFromDrive(noteId) {
    // Find the file ID first
    const existingFiles = await listAllFiles();
    const fileToDelete = existingFiles.find(f => f.name === `${noteId}.json`);

    if (fileToDelete) {
        try {
            await gapi.client.drive.files.delete({
                fileId: fileToDelete.id
            });
            console.log(`Successfully deleted note ${noteId} from Drive.`);
        } catch (err) {
            console.error(`Error deleting note ${noteId} from Drive:`, err);
        }
    }
}
