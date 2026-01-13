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
	if (gisInited) checkGdriveSession();
}

/**
 * Callback after the GIS library is loaded.
 */
function gisLoaded() {
	const app = Alpine.$data(document.querySelector('#main-app'));
	if (!app.GOOGLE_CLIENT_ID) {
		console.error("GOOGLE_CLIENT_ID is not configured in index.js");
		return;
	}
	tokenClient = google.accounts.oauth2.initTokenClient({
		client_id: app.GOOGLE_CLIENT_ID,
		scope: GDRIVE_SCOPES,
		callback: (tokenResponse) => {
			if (tokenResponse && tokenResponse.access_token) {
			accessToken = tokenResponse.access_token;
			localStorage.setItem('gdrive_access_token', accessToken);

			// Update the main app's state
			const app = Alpine.$data(document.querySelector('#main-app'));
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
			syncNotesWithGoogleDrive();

			} else {
			console.error("No access token received.");
			const app = Alpine.$data(document.querySelector('#main-app'));
			app.showToast({ variant: 'error', title: 'Connection Failed', description: 'Could not get access token from Google.' });
			}
		},
	});
	gisInited = true;
	if (gapiInited) checkGdriveSession();
}


// --- Session Management ---

/**
 * Checks for a saved session in localStorage and tries to restore it.
 * This function is called once both GAPI and GIS libraries are initialized.
 */
function checkGdriveSession() {
	const savedToken = localStorage.getItem('gdrive_access_token');
	if (savedToken) {
		accessToken = savedToken;
		const app = Alpine.$data(document.querySelector('#main-app'));

		// Verify the token by fetching user info
		fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { 'Authorization': `Bearer ${accessToken}` }
		})
		.then(response => {
			if (!response.ok) {
				if (response.status == 401) {
					signOutFromGoogleDrive();
				}

				// If response is not OK (e.g., 401 Unauthorized), the token is invalid.
				throw new Error('Invalid or expired token.');
			}
			return response.json();
		})
		.then(userInfo => {
			// Token is valid: Update all relevant state
			app.gdriveStore.connected = true;
			app.gdriveStore.user = userInfo;
			app.showToast({ title: 'Reconnected', description: `Connected to Google Drive as ${userInfo.name}.` });
			syncNotesWithGoogleDrive(true); // Trigger a silent sync
		})
		.catch(error => {
			console.error("Failed to restore Google Drive session:", error.message);
		});
	}
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
	localStorage.removeItem('gdrive_access_token');
	if (accessToken) {
		google.accounts.oauth2.revoke(accessToken, () => {
			console.log('Access token revoked.');
			accessToken = null;

			const app = Alpine.$data(document.querySelector('#main-app'));
			if (app.gdriveStore) {
				app.gdriveStore.connected = false;
				app.gdriveStore.user = null;
			}
		});
	}
}


// --- Sync Logic ---
let REMOTE_GOOGLEDRIVE_FILES = [];

/**
 * DEPRECATED: Use the granular functions below via synchronize() in helpers.js.
 * Main function to synchronize notes with Google Drive.
 * Implements a "last-write-wins" strategy.
 */
async function syncNotesWithGoogleDrive(isSilent = false, deletedNoteIds = []) {
	console.warn('syncNotesWithGoogleDrive is deprecated. Please use the unified synchronize() function.');
	return;
}

/**
 * Lists all notes in Google Drive.
 * @returns {Promise<Array>} List of note metadata { id, updatedAt, source: 'gdrive', fileId }
 */
async function listNotesInGDrive() {
	if (!accessToken) return [];
	try {
		const files = await listAllFilesFromGoogleDrive();
		// Convert to unified metadata format
		return files.map(file => ({
			id: file.name.replace('.json', ''),
			updatedAt: new Date(file.modifiedTime).toISOString(),
			source: 'gdrive',
			fileId: file.id
		}));
	} catch (error) {
		console.error('Error listing GDrive notes:', error);
		return [];
	}
}

/**
 * Downloads a note from Google Drive.
 * @param {string} fileId The ID of the file to download.
 * @param {string} noteId The expected note ID.
 * @returns {Promise<Object|null>} A promise that resolves with the note object or null.
 */
async function downloadNoteFromGDrive(fileId, noteId) {
	try {
		const response = await gapi.client.drive.files.get({
			fileId: fileId,
			alt: 'media'
		});

		// Verification: Ensure the downloaded data is valid
		if (!response.body || response.body === "{}") {
			console.warn(`Downloaded file ${fileId} for note ${noteId} is empty. Skipping.`);
			return null;
		}

		const noteData = JSON.parse(response.body);

		// Verification: Ensure content property exists
		if (typeof noteData.content === 'undefined') {
			console.warn(`Downloaded note ${noteId} has no content property. Skipping.`);
			return null;
		}

		// Ensure the note object has the correct ID, overriding file content
		return { ...noteData, id: noteId };
	} catch (err) {
		console.error(`Error downloading file ${fileId} for note ${noteId}:`, err);
		return null;
	}
}

/**
 * Uploads a note to Google Drive. Handles both creation and updates.
 * @param {Object} note The note object to upload.
 * @param {Object} remoteMeta Metadata of the remote note (optional).
 */
async function uploadNoteToGoogleDrive(note, remoteMeta = null) {
	if (!accessToken) return;

	const noteId = note.id;
	const boundary = '-------314159265358979323846';
	const delimiter = "\r\n--" + boundary + "\r\n";
	const close_delim = "\r\n--" + boundary + "--";

	const metadata = {
		'name': `${noteId}.json`,
		'mimeType': 'application/json',
	};

	let existingFileId = remoteMeta?.fileId;
	if (!existingFileId) {
		// Try to find it if not provided in meta (fallback)
		// This might be slow if we do it for every upload without meta, but usually meta is provided.
		// For now, assume if not in meta, it's new. 
		// Use listAllFilesFromGoogleDrive check if absolutely necessary, but listNotesInGDrive should have covered it.
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

	const path = existingFileId ? `/upload/drive/v3/files/${existingFileId}` : '/upload/drive/v3/files';

	const request = () => gapi.client.request({
		'path': path,
		'method': existingFileId ? 'PATCH' : 'POST',
		'params': { 'uploadType': 'multipart' },
		'headers': {
			'Content-Type': 'multipart/related; boundary="' + boundary + '"'
		},
		'body': multipartRequestBody
	});

	try {
		await callDriveApi(request);
		// console.log(`Successfully uploaded note ${noteId} to GDrive`);
	} catch (err) {
		console.error(`Error uploading note ${noteId} to GDrive:`, err);
	}
}

/**
 * Deletes a note from Google Drive.
 * @param {string} noteId The ID of the note to delete.
 * @param {Object} remoteMeta Metadata of the remote note (optional).
 */
async function deleteNoteFromGoogleDrive(noteId, remoteMeta = null) {
	if (!accessToken) return;

	let fileId = remoteMeta?.fileId;

	if (!fileId) {
		// Fallback: try to find the file
		// Note: This relies on REMOTE_GOOGLEDRIVE_FILES being populated or re-fetching.
		// Ideally we should pass the fileId from the listNotes phase.
		// If we don't have it, we might skip or do a costly search.
		// For safety, let's just skip if we don't have the ID, as listNotes should have provided it.
		console.warn(`Skipping GDrive delete for ${noteId}: fileId not found in metadata.`);
		return;
	}

	try {
		await gapi.client.drive.files.delete({
			fileId: fileId
		});
		console.log(`Successfully deleted note ${noteId} from Drive.`);
	} catch (err) {
		console.error(`Error deleting note ${noteId} from Drive:`, err);
	}
}

// Keep the old function for now but pointing to nowhere or removed? 
// The prompt asked to "Make it consistent logic like Git", effectively replacing it.
// I've deprecated the main function above.

// --- Google Drive API Helper Functions ---

async function callDriveApi(apiCall) {
	try {
		return await apiCall();
	} catch (err) {
		if (err.result && err.result.error && err.result.error.code === 401) {
			console.error("Google Drive API returned 401. The access token has likely expired.");
			const app = Alpine.$data(document.querySelector('#main-app'));
			if (app) {
				app.gdriveStore.connected = false;
				app.showToast({ quiet: true, title: 'Session Expired', description: 'Please connect to Google Drive again.' });
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
async function listAllFilesFromGoogleDrive() {
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

		REMOTE_GOOGLEDRIVE_FILES = files;

		return files;
	} catch (err) {
		console.error("Error listing files:", err);
		return [];
	}
}
