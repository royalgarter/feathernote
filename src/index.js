document.addEventListener('alpine:init', () => {
	async function apiSyncImages(encryptedSettings, userId) {
		try {
			const credentials = await decryptSettings(encryptedSettings, userId);
			if (!credentials) {
				throw new Error('Failed to decrypt credentials.');
			}

			// 1. Upload unsynced local images to S3
			let uploadedImageCount = 0;
			const unsyncedImages = await getUnsyncedImagesDB();
			for (const image of unsyncedImages) {
				await uploadImageToS3V2(image, credentials);
				await updateImageDB({ ...image, synced: true }); // Mark as synced in DB
				uploadedImageCount++;
			}

			// 2. Download missing images from S3
			let downloadedImageCount = 0;
			const allNotes = await getNotesDB();
			const remoteImageKeys = await listImagesInS3V2(credentials);
			const remoteImageIds = new Set(remoteImageKeys.map(key => key.split('/').pop().split('.').shift()));

			const imageIdRegex = /\/images\/([a-f0-9-]+)/g;
			const referencedImageIds = new Set();

			for (const note of allNotes) {
				let match;
				while ((match = imageIdRegex.exec(note.content)) !== null) {
					referencedImageIds.add(match[1]);
				}
			}

			for (const imageId of referencedImageIds) {
				const localImage = await getImageDB(imageId);
				if (!localImage && remoteImageIds.has(imageId)) {
					console.log(`Image ${imageId} not found locally, downloading from S3...`);
					try {
						const imageBlob = await downloadImageFromS3V2(imageId, credentials);
						if (imageBlob) {
							await addImageDB({ id: imageId, blob: imageBlob, synced: true });
							downloadedImageCount++;
						}
					} catch (downloadError) {
						console.error(`Failed to download image ${imageId} from S3:`, downloadError);
					}
				}
			}

			return { success: true, uploadedImageCount, downloadedImageCount };
		} catch (error) {
			console.error('apiSyncImages error:', error);
			return { success: false, error: error.message };
		}
	}

	async function apiSyncNotes(encryptedSettings, userId, localNotes, deletedNoteIds, lastSync, lastSyncedIds) {
		try {
			const credentials = await decryptSettings(encryptedSettings, userId);
			if (!credentials) {
				throw new Error('Failed to decrypt credentials.');
			}

			const updatedNotes = [];
			const notesToDeleteLocally = [];

			// 1. Upload local notes to S3
			const uploadPromises = localNotes.map(note => uploadNoteToS3V2(note, credentials));

			// 2. Delete notes from S3 that are in deletedNoteIds
			const deletePromises = deletedNoteIds.map(noteId => deleteNoteFromS3V2(noteId, credentials));

			// Combine upload and delete promises
			const uploadAndDeletePromises = [...uploadPromises, ...deletePromises];
			const uploadAndDeleteResults = await Promise.allSettled(uploadAndDeletePromises);

			let uploadedCount = 0;
			let deletedCount = 0;

			uploadAndDeleteResults.forEach((result, index) => {
				if (result.status === 'fulfilled') {
					if (index < uploadPromises.length) {
						uploadedCount++;
					} else {
						deletedCount++;
					}
				} else {
					// Log the error but continue
					console.error('Sync error during upload/delete:', result.reason);
				}
			});


			// 3. List notes from S3 and identify remote changes
			const remoteNoteMetadata = await listNotesInS3V2(credentials);
			const remoteNoteIds = new Set(remoteNoteMetadata.map(m => m.id));

			// Identify notes deleted remotely
			const currentLocalNoteIds = new Set(localNotes.map(n => n.id));
			for (const localNoteId of currentLocalNoteIds) {
				if (!remoteNoteIds.has(localNoteId) && !deletedNoteIds.includes(localNoteId)) {
					notesToDeleteLocally.push(localNoteId);
				}
			}

			// Identify notes updated/added remotely and create download promises
			const downloadPromises = remoteNoteMetadata
				.filter(remoteMeta => {
					const localNote = localNotes.find(n => n.id === remoteMeta.id);
					return !localNote || new Date(remoteMeta.lastModified) > new Date(localNote.updatedAt);
				})
				.map(remoteMeta => downloadNoteFromS3V2(remoteMeta.id, credentials));

			const downloadResults = await Promise.allSettled(downloadPromises);

			downloadResults.forEach(result => {
				if (result.status === 'fulfilled' && result.value) {
					updatedNotes.push(result.value);
				} else if (result.status === 'rejected') {
					console.error('Sync error during download:', result.reason);
				}
			});

			return {
				success: true,
				uploadedCount,
				deletedCount,
				updatedNotes,
				notesToDeleteLocally,
				finalRemoteIds: Array.from(remoteNoteIds)
			};

		} catch (error) {
			console.error('apiSyncNotes error:', error);
			return { success: false, error: error.message };
		}
	}

	async function verifyGoogleJwt(token, clientId) {
		try {
			const base64Url = token.split('.')[1];
			const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
			const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
				return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
			}).join(''));

			const decoded = JSON.parse(jsonPayload);

			// Basic check: ensure client ID matches (audience claim 'aud')
			if (decoded.aud !== clientId) {
				throw new Error('Invalid client ID in JWT.');
			}

			return decoded;
		} catch (error) {
			console.error('Error verifying JWT:', error);
			throw new Error('JWT verification failed: ' + error.message);
		}
	}

	async function apiDeleteNote(encryptedSettings, userId, noteId) {
		try {
			const credentials = await decryptSettings(encryptedSettings, userId);
			if (!credentials) {
				throw new Error('Failed to decrypt credentials.');
			}
			await deleteNoteFromS3V2(noteId, credentials);
			return { success: true };
		} catch (error) {
			console.error('apiDeleteNote error:', error);
			return { success: false, error: error.message };
		}
	}

	Alpine.data('mainApp', () => ({
		// --- App Data ---
		toasts: [],
		toastIdCounter: 0,
		darkMode: false,

		// --- Auth Data ---
		user: null,
		isGsiLoaded: false,
		GOOGLE_CLIENT_ID: "547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com",

		// --- Note Manager Data ---
		notes: [],
		searchTag: '',
		suggestions: [], // New property
		loading: true,
		miniSearch: null,
		isSyncing: false,
		syncIntervalId: null,
		editingNoteId: null, // New state to track which note is being edited
		deletedNoteIds: [],
		deletedNotesStack: [], // For session-only undo
		lastSync: null,
		currentPage: 1,
		notesPerPage: 100,

		// --- Note Editor Data ---
		editorAutosaveIntervalId: null,
		noteEditorNoteId: null,
		noteEditorTitle: '',
		noteEditorContent: '',
		noteEditorTags: '',
		noteEditorReminder: '',

		// --- Notification Data ---
		notificationsEnabled: false,
		notificationPermissionStatus: 'default',
		scheduledNotifications: {},

		get filteredNotes() {
			if (!this.searchTag.trim()) {
				return this.notes;
			}
			// Use minisearch for filtering
			const searchResults = this.miniSearch ? this.miniSearch.search(this.searchTag, {
				prefix: true, // Search for prefixes
				fuzzy: 0.2, // Allow some fuzziness
				combineWith: 'AND' // All terms must match
			}) : this.notes.filter(x => x.tags.includes(this.searchTag) || x.title.includes(this.searchTag));
			// minisearch returns an array of objects with 'id' and other stored fields.
			// We need to return the original note objects, so map them back.
			const resultIds = new Set(searchResults.map(result => result.id));
			return this.notes.filter(note => resultIds.has(note.id));
		},

		get paginatedNotes() {
			const start = (this.currentPage - 1) * this.notesPerPage;
			const end = start + this.notesPerPage;
			return this.filteredNotes.slice(start, end);
		},

		get totalPages() {
			return Math.ceil(this.filteredNotes.length / this.notesPerPage);
		},

		nextPage() {
			if (this.currentPage < this.totalPages) {
				this.currentPage++;
			}
		},

		prevPage() {
			if (this.currentPage > 1) {
				this.currentPage--;
			}
		},

		goToPage(page) {
			this.currentPage = page;
		},


		// --- Main App Init ---
		init() {
			// App Init
			this.darkMode = localStorage.getItem('feathernote-dark-mode') === 'true';
			this.$watch('darkMode', (value) => { localStorage.setItem('feathernote-dark-mode', value); });

			this.$nextTick(() => {
				this.processSharedContent();
			});

			// Notifications Init
			this.initNotifications();

			// Register Service Worker
			if ('serviceWorker' in navigator) {
				navigator.serviceWorker.register('/serviceworker.js')
					.then(registration => {
						console.log('Service Worker registered with scope:', registration.scope);
					})
					.catch(error => {
						console.error('Service Worker registration failed:', error);
					});
			}

			// Auth Init
			const storedUser = localStorage.getItem('feathernote-user');
			if (storedUser) {
				this.user = JSON.parse(storedUser);
			}

			// Only append GSI script if it's not already in the DOM
			if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
				const script = document.createElement('script');
				script.src = 'https://accounts.google.com/gsi/client';
				script.async = true;
				script.defer = true;
				script.onload = () => {
					this.isGsiLoaded = true;
				};
				document.body.appendChild(script);
			}

			// Note Manager Init
			const lastSync = localStorage.getItem('feathernote-lastSync');
			if (lastSync) {
				this.lastSync = lastSync;
			}
			this.miniSearch = window.MiniSearch ? new MiniSearch({
				fields: ['title', 'content', 'tags'], // Fields to search!
				storeFields: ['id', 'title', 'content', 'createdAt', 'updatedAt', 'reminder', 'tags'] // Fields to return
			}) : null;
			this.fetchNotes();
			this.syncNotes();
			this.syncIntervalId = setInterval(() => {
				this.syncNotes(true); // Run a silent sync
			}, 2 * 60 * 1000); // Every 2 minutes

			this.$watch('searchTag', () => this.generateSuggestions());

			if (window.location.hash === '#new_note') {
				this.createNewNote();
			} else if (window.location.hash === '#search') {
				this.$nextTick(() => document.getElementById('searchInput')?.focus());
			}

			// Add the keyboard shortcut listener
			window.addEventListener('keydown', (event) => {
				if ((event.ctrlKey || event.metaKey) && event.key === 's') {
					event.preventDefault();
					if (this.editingNoteId) {
						this.saveNote();
					} else {
						this.syncNotes(false);
					}
				}
				if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
					if (!this.editingNoteId) {
						event.preventDefault();
						this.revertDelete();
					}
				}
				if (event.key === 'Escape') {
					if (this.editingNoteId) {
						event.preventDefault();
						this.cancelEdit();
					}
				}
			});

			// window.addEventListener('popstate', (event) => {
			//     if (this.editingNoteId) {
			//         this.cancelEdit();
			//     }
			// });
		},

		// --- App Methods ---
		formatDate(isoString) {
			return new Date(isoString).toLocaleString();
		},
		getNotePreview(content) {
			return content ? `${content.substring(0, 200)}...` : 'No content preview';
		},

		showToast({ title, description, variant = 'default', duration = 3000 }) {
			const id = `toast-${this.toastIdCounter++}`;
			const newToast = { id, title, description, variant, show: true };
			this.toasts.push(newToast);

			console.log(description);

			setTimeout(() => {
				this.dismissToast(id);
			}, duration);
		},

		dismissToast(id) {
			this.toasts = this.toasts.map(toast =>
				toast.id === id ? { ...toast, show: false } : toast
			);
			setTimeout(() => {
				this.toasts = this.toasts.filter(toast => toast.id !== id);
			}, 300);
		},

		toggleDarkMode() {
			this.darkMode = !this.darkMode;
		},
		async handleCredentialResponse(response) {
			try {
				const decoded = await verifyGoogleJwt(response.credential, this.GOOGLE_CLIENT_ID);

				if (!decoded) {
					throw new Error("Invalid JWT signature or claims.");
				}

				const newUser = {
					id: decoded.sub,
					name: decoded.name,
					email: decoded.email,
					picture: decoded.picture,
				};
				this.user = newUser;
				localStorage.setItem('feathernote-user', JSON.stringify(newUser));
				localStorage.setItem('feathernote-has-logged-in', 'true');
				this.showToast({ title: 'Signed In', description: `Welcome, ${newUser.name}!` });
			} catch (error) {
				console.error("Error processing credential:", error);
				this.showToast({ variant: 'error', title: 'Sign In Failed', description: 'Could not verify Google credential. ' + error.message });
			}
		},

		initializeGoogleOneTap() {
			if (window.google && window.google.accounts) {
				window.google.accounts.id.initialize({
					client_id: this.GOOGLE_CLIENT_ID,
					callback: (response) => this.handleCredentialResponse(response),
					auto_select: false,
					use_fedcm_for_prompt: true,
				});
			} else {
				console.error("Google Identity Services script not loaded or not ready.");
			}
		},

		signIn() {
			if (!this.GOOGLE_CLIENT_ID) {
				this.showToast({ variant: 'error', title: 'Configuration Error', description: 'Google Client ID is not configured.' });
				return;
			}
			if (this.isGsiLoaded && window.google) {
				this.initializeGoogleOneTap();
				window.google.accounts.id.prompt();
			} else {
				this.showToast({ variant: 'error', title: 'Sign In Error', description: 'Google Identity Services not loaded or ready. Please try again.' });
			}
		},

		signOut() {
			this.user = null;
			localStorage.removeItem('feathernote-user');
			localStorage.removeItem('feathernote-has-logged-in');
			if (window.google && window.google.accounts) {
				window.google.accounts.id.disableAutoSelect();
			}
			this.showToast({ title: 'Signed Out', description: 'You have been signed out.' });
		},



		// --- Notification Methods (Local) ---
		initNotifications() {
			if (!('Notification' in window) || !navigator.serviceWorker) {
				console.warn('Notifications API not supported.');
				return;
			}
			this.notificationPermissionStatus = Notification.permission;
			this.notificationsEnabled = this.notificationPermissionStatus === 'granted';
		},

		async togglePushNotifications() { // Name kept for consistency in UI
			if (this.notificationPermissionStatus !== 'granted') {
				this.notificationPermissionStatus = await Notification.requestPermission();
				this.notificationsEnabled = this.notificationPermissionStatus === 'granted';
				if (this.notificationsEnabled) {
					this.showToast({ title: 'Notifications Enabled', description: 'You can now set reminders on notes.' });
					this.scheduleAllFutureReminders();
				} else {
					this.showToast({ variant: 'error', title: 'Notifications Disabled', description: 'Permission was not granted.' });
				}
			} else {
				this.showToast({ title: 'Permissions', description: 'To disable notifications, manage permissions in your browser settings.' });
			}
		},

		scheduleNotification(note) {
			this.cancelNotification(note.id);

			if (!note.reminder || this.notificationPermissionStatus !== 'granted') {
				return;
			}

			const reminderTime = new Date(note.reminder).getTime();
			const now = new Date().getTime();
			const delay = reminderTime - now;

			if (delay > 0) {
				const timeoutId = setTimeout(() => {
					navigator.serviceWorker.ready.then(registration => {
						registration.showNotification(note.title, {
							body: note.content.substring(0, 100),
							icon: '/favicon.png',
							badge: '/favicon.png',
							data: { url: `/#note/${note.id}` }
						});
					});
				}, delay);

				this.scheduledNotifications[note.id] = timeoutId;
				console.log(`Reminder scheduled for note ${note.id} in ${delay}ms`);
			}
		},

		cancelNotification(noteId) {
			if (this.scheduledNotifications[noteId]) {
				clearTimeout(this.scheduledNotifications[noteId]);
				delete this.scheduledNotifications[noteId];
				console.log(`Cancelled reminder for note ${noteId}`);
			}
		},

		scheduleAllFutureReminders() {
			if (this.notificationPermissionStatus !== 'granted') return;
			this.notes.forEach(note => this.scheduleNotification(note));
		},

		// --- App Badging Methods ---
		async updateAppBadge() {
			if ('setAppBadge' in navigator) {
				const reminderNotesCount = this.notes.filter(note => !!note.reminder).length;
				if (reminderNotesCount > 0) {
					await navigator.setAppBadge(reminderNotesCount);
					console.log(`App badge set to ${reminderNotesCount}`);
				} else {
					await navigator.clearAppBadge();
					// console.log('App badge cleared.');
				}
			}
		},

		// --- Note Manager Methods ---
		async generateSuggestions() {
			if (!this.miniSearch || this.searchTag?.trim() === '') return (this.suggestions = []);

			this.suggestions = this.miniSearch?.autoSuggest(this.searchTag, {
				prefix: true,
				fuzzy: 0.2,
				combineWith: 'AND'
			}) || [];
		},

		async fetchNotes() {
			this.loading = true;
			try {
				const notesFromDB = await getNotesDB();
				this.notes = notesFromDB.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
				this.scheduleAllFutureReminders();

				this.updateAppBadge();
				this.miniSearch?.removeAll();
				this.miniSearch?.addAllAsync(this.notes);
			} catch (error) {
				console.error('Error in fetchNotes:', error);
				this.showToast({ variant: 'error', title: 'Error', description: 'Could not load notes.' });
			} finally {
				this.loading = false;
			}
		},

		async addNote(title, content, reminder, tags) {
			try {
				const now = new Date().toISOString();
				const newNote = {
					id: crypto.randomUUID(),
					title,
					content,
					createdAt: now,
					updatedAt: now,
					reminder: reminder || undefined,
					tags: tags || [],
				};
				await addNoteDB(newNote);
				this.notes.unshift(newNote);
				this.scheduleNotification(newNote);
				this.updateAppBadge();
				this.miniSearch?.add(newNote);
				// this.showToast({ title: 'Note Added', description: 'New note created.' });
				this.syncNotes(false, 1, [newNote]);
				return newNote;
			} catch (error) {
				console.error('Error in addNote:', error);
				this.showToast({ variant: 'error', title: 'Error', description: 'Could not create note.' });
				return null;
			}
		},

		async updateNote(id, updates, isSilent = false) {
			try {
				const noteToUpdate = await getNoteDB(id);
				if (!noteToUpdate) throw new Error('Note not found');

				const updatedNote = { ...noteToUpdate, ...updates, updatedAt: new Date().toISOString() };
				await updateNoteDB(updatedNote);
				this.notes = this.notes.map(note => note.id === id ? updatedNote : note);
				this.scheduleNotification(updatedNote);
				this.updateAppBadge();
				this.miniSearch?.removeAll();
				this.miniSearch?.addAllAsync(this.notes);
				if (!isSilent) {
					this.showToast({ title: 'Note Updated', description: 'Note saved successfully.' });
				}
				this.syncNotes(isSilent, 1, [updatedNote]);
			} catch (error) {
				console.error('Error in updateNote:', error);
				if (!isSilent) {
					this.showToast({ variant: 'error', title: 'Error', description: 'Could not update note.' });
				}
			}
		},

		async autosaveCurrentNote() {
			if (!this.editingNoteId || !this.noteEditorNoteId || this.noteEditorNoteId === 'new') {
				return;
			}

			const id = this.noteEditorNoteId;
			const noteInDb = await this.getNote(id);
			if (!noteInDb) return;

			const content = window.easyMDEInstance?.value();
			if (content === null || content === undefined) return;

			const noteData = {
				title: this.noteEditorTitle.trim() || ('Note at ' + new Date().toString().substr(0, 21)),
				content: content,
				reminder: this.noteEditorReminder.trim() !== '' ? this.noteEditorReminder : undefined,
				tags: this.noteEditorTags.split(',').map(tag => tag.trim()).filter(tag => tag),
			};

			if (noteInDb.title === noteData.title &&
				noteInDb.content === noteData.content &&
				(noteInDb.reminder || undefined) === noteData.reminder &&
				JSON.stringify(noteInDb.tags || []) === JSON.stringify(noteData.tags)) {
				return;
			}

			console.log(`Autosaving note ${id}...`);

			this.isSyncing = `Saving ${id}...`;
			await this.updateNote(id, noteData, true);
			this.isSyncing = `Saved ${id}`;
			setTimeout(() => {this.isSyncing = false}, 1e3);
		},

		async revertDelete() {
			if (this.deletedNotesStack.length === 0) {
				this.showToast({ title: 'Nothing to Undo', description: '' });
				return;
			}

			const noteToRestore = this.deletedNotesStack.pop();
			if (!noteToRestore) return;

			// Add back to local state and DB
			this.notes.unshift(noteToRestore);
			await addNoteDB(noteToRestore);

			// Remove from the S3 deletion queue
			this.deletedNoteIds = this.deletedNoteIds.filter(id => id !== noteToRestore.id);

			this.showToast({ title: 'Note Restored', description: `"${noteToRestore.title}" has been restored.` });
		},

		async deleteNote(id) {
			try {
				const noteToDelete = this.notes.find(note => note.id === id);
				if (noteToDelete) {
					this.deletedNotesStack.push({ ...noteToDelete }); // Push a copy
				}

				this.deletedNoteIds.push(id);
				this.cancelNotification(id);
				await deleteNoteDB(id);
				await this.deleteNoteFromS3(id);
				this.notes = this.notes.filter((note) => note.id !== id);
				this.showToast({ title: 'Note Deleted', description: 'Press Ctrl+Z to undo.' });
				this.cancelEdit();
			} catch (error) {
				console.error('Error in deleteNote:', error);
				this.showToast({ variant: 'error', title: 'Error', description: 'Could not delete note.' });
			}
		},

		async deleteNoteFromS3(noteId) {
			const userId = this.user ? this.user.id : null;
			const storedData = await getEncryptedSettingsDB();
			const encryptedSettings = storedData ? storedData.encryptedSettings : null;

			if (!encryptedSettings) {
				this.showToast({ title: 'Sync Not Configured', description: 'S3 sync is not configured.' });
				return;
			}

			try {

				const result = await apiDeleteNote(
					encryptedSettings,
					userId,
					noteId
				);

				console.dir({deleteNoteFromS3: result})

				if (result.success) {
					this.showToast({ title: 'Note Deleted from S3', description: `Note ${noteId} has been deleted from S3.` });
				} else {
					throw new Error(result.error || 'Server responded with an error.');
				}

			} catch (error) {
				console.error('Error deleting note from S3:', error);
				this.showToast({ variant: 'error', title: 'Error', description: 'Could not delete note from S3.' });
			}
		},

		async getNote(id) {
			try {
				return await getNoteDB(id);
			} catch (error) {
				console.error('Error in getNote:', error);
				this.showToast({ variant: 'error', title: 'Error', description: 'Could not fetch note.' });
				return undefined;
			}
		},

		async syncNotes(isSilent = false, iterator = 0, notes = null) {
			const userId = this.user ? this.user.id : null;

			if (this.isSyncing) {
				iterator++;
				// setTimeout(() => this.syncNotes(true, iterator, notes), 5e3 * iterator);
				return;
			}

			this.isSyncing = 'Syncing...';
			console.log('syncNotes: Starting sync process.');
			try {
				const storedData = await getEncryptedSettingsDB(); // Get from IndexedDB
				const encryptedSettings = storedData ? storedData.encryptedSettings : null;

				if (!encryptedSettings) {
					isSilent = true;
					throw new Error('S3 credentials not found in IndexedDB.');
				}
				console.log('syncNotes: Encrypted settings retrieved from IndexedDB.');

				const lastSyncedIds = JSON.parse(localStorage.getItem('feathernote-synced-ids') || '[]');
				let localNotes = notes || await getNotesDB();

				// The 'notes' parameter is for targeted sync of specific notes.
				// For a general background sync, we now send all notes to the sync API
				// to allow for proper conflict resolution. The old implementation could
				// cause data loss by uploading notes without checking for remote changes first.

				localNotes = localNotes.filter(x => !this.deletedNoteIds.find(deleting => x.id == deleting));

				const result = await apiSyncNotes(
					encryptedSettings,
					userId,
					localNotes,
					this.deletedNoteIds,
					this.lastSync,
					lastSyncedIds
				);

				if (result.success) {
					// Handle downloaded notes
					let downloadedCount = 0;
					for (const remoteNote of result.updatedNotes) {
						const localNote = await getNoteDB(remoteNote.id);
						if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
							await updateNoteDB(remoteNote);
							downloadedCount++;
						}
					}

					// Handle notes that were deleted on the remote
					const notesToDeleteLocally = result.notesToDeleteLocally || [];
					for (const noteIdToDelete of notesToDeleteLocally) {
						await deleteNoteDB(noteIdToDelete);
					}

					await this.fetchNotes(); // Refresh notes from DB after all updates/deletions
					this.deletedNoteIds = []; // Clear deleted notes after successful sync

					// Save the final state for the next sync
					if (result.finalRemoteIds) {
						localStorage.setItem('feathernote-synced-ids', JSON.stringify(result.finalRemoteIds));
					}
					this.lastSync = new Date().toISOString();
					localStorage.setItem('feathernote-lastSync', this.lastSync);

					// After notes are synced, sync images
					if (encryptedSettings) {
						console.log('syncNotes: S3 is configured, attempting image sync.');
						const imageSyncResult = await apiSyncImages(encryptedSettings, userId);
						if (imageSyncResult.success) {
							console.log(`syncNotes: Image sync successful. Uploaded: ${imageSyncResult.uploadedImageCount}, Downloaded: ${imageSyncResult.downloadedImageCount}`);
							if (!isSilent && (imageSyncResult.uploadedImageCount > 0 || imageSyncResult.downloadedImageCount > 0)) {
								this.showToast({
									title: 'Image Sync Complete',
									description: `${imageSyncResult.uploadedImageCount} images uploaded, ${imageSyncResult.downloadedImageCount} images downloaded.`,
								});
							}
						} else {
							console.error('syncNotes: Image sync failed:', imageSyncResult.error);
							if (!isSilent) {
								this.showToast({
									title: 'Image Sync Failed',
									description: imageSyncResult.error,
									variant: 'error',
								});
							}
						}
					} else {
						console.log('syncNotes: S3 not configured or userId missing, skipping image sync.');
					}

					if (!isSilent) {
						this.showToast({
							title: 'Sync Successful',
							description: `Uploaded: ${result.uploadedCount}, Downloaded/Updated: ${downloadedCount}, Deleted: ${result.deletedCount}, Remotely Deleted: ${notesToDeleteLocally.length}.`,
						});
					}
				} else {
					throw new Error(result.error || 'Server responded with an error.');
				}

			} catch (error) {
				if (!isSilent) {
					let errorMessage = 'An unknown error occurred.';
					let errorTitle = 'Incomplete Sync';

					if (error instanceof TypeError) {
						errorTitle = 'Network Error';
						errorMessage = `Could not connect to the server. Please check your internet connection or server status. This could also be a CORS issue.`;
					} else if (error instanceof Error) {
						errorMessage = error.message;
					}

					this.showToast({
						title: errorTitle,
						description: errorMessage,
						duration: 5000,
					});
				}
			} finally {
				this.isSyncing = false;
			}
		},

		async processSharedContent() {
			await navigator.locks.request('shared-content-lock', async lock => {
				try {
					const sharedItems = await getSharedContentDB();

					if (sharedItems.length > 0) {
						console.dir({sharedItems});
						for (const item of sharedItems) {
							await this.addNote(item.title || ('Share ' + new Date().toString().substr(0, 21)), item.content);
						}

						await clearSharedContentDB();

						this.showToast({
							title: 'Shared Content Imported',
							description: `${sharedItems.length} item(s) have been added to your notes.`,
						});

						await this.fetchNotes();
						this.syncNotes(true);
					}
				} catch (error) {
					console.error('Failed to process shared content', error);
					this.showToast({ variant: 'error', title: 'Error', description: 'Could not import shared content.' });
				}
			});
		},

		prepareEasyMDE(id) {
			setTimeout(() => {
				if (!window.EasyMDE) return;

				window.easyMDEInstance = window.easyMDEInstance || new EasyMDE({
					element: document.getElementById('note-content'),
					unorderedListStyle: "-",
					lineNumbers: true,
					lineWrapping: true,
					promptURLs: true,
					spellChecker: false,
					nativeSpellcheck: false,
					minHeight: "500px",
					showIcons: ["code", "table"],
					autosave: {
						enabled: true,
						uniqueId: id,
						delay: 1000,
						submit_delay: 5000,
						timeFormat: {
							locale: 'en-US',
							format: {
								year: 'numeric',
								month: 'short',
								day: '2-digit',
								hour: '2-digit',
								minute: '2-digit',
							},
						},
						text: "Autosaved: "
					},
					// forceSync: true,
					previewImagesInEditor: true, // Disable live preview in editor to test compatibility with Service Worker
					toolbar: [
						"bold", "italic", "heading", "|",
						"quote", "unordered-list", "ordered-list", "|",
						"link", "image", "|",
						"code", "table", "|",
						{
							name: "word-wrap",
							action: function(editor){
								const cm = editor.codemirror;
								cm.setOption("lineWrapping", !cm.getOption("lineWrapping"));
							},
							className: "fa fa-text-width",
							title: "Word Wrap",
						},
						"|",
						"preview", "side-by-side", "fullscreen", "|",
						"guide"
					]
				});

				const cm = window.easyMDEInstance.codemirror;
				cm?.on('paste', (cmInstance, event) => {
					const items = (event.clipboardData || event.originalEvent.clipboardData).items;
					for (const item of items) {
						if (item.kind === 'file' && item.type.startsWith('image/')) {
							event.preventDefault();
							const blob = item.getAsFile();
							if (!blob) continue;

							const imageId = crypto.randomUUID();
							const imageRecord = { id: imageId, blob: blob, synced: false };

							addImageDB(imageRecord).then(() => {
								const markdown = `\n![Pasted Image](/images/${imageId})\n`;
								cm.replaceSelection(markdown);
							}).catch(err => {
								console.error("Failed to save image to IndexedDB", err);
								// Fallback or error message
							});
						}
					}
				});
			}, 100);
		},

		createNewNote() {
			this.editingNoteId = new Date().toString().substr(0, 18);
			this.noteEditorNoteId = null;
			this.noteEditorTitle = '';
			this.noteEditorContent = '';
			this.noteEditorReminder = '';
			this.noteEditorTags = '';

			this.$nextTick(() => document.getElementById('note-title').setAttribute('placeholder', 'Note at ' + new Date().toString().substr(0, 21)));

			this.prepareEasyMDE(this.editingNoteId);
			window.location.hash = '#new_note';
		},

		async editNote(id) {
			if (this.editorAutosaveIntervalId) {
				clearInterval(this.editorAutosaveIntervalId);
			}
			this.editingNoteId = id;
			await this.loadNoteIntoEditor(id);
			this.editorAutosaveIntervalId = setInterval(() => {
				this.autosaveCurrentNote();
			}, 60 * 1000);
			window.location.hash = '#edit_note-' + id;
		},

		// --- Note Editor Methods (moved from noteEditor component) ---
		async loadNoteIntoEditor(id) {
			this.noteEditorNoteId = id;
			if (!this.noteEditorNoteId) return;
			const note = await this.getNote(this.noteEditorNoteId);
			if (note) {
				this.noteEditorTitle = note.title;
				this.noteEditorContent = note.content;
				this.noteEditorReminder = note.reminder || '';
				this.noteEditorTags = note.tags ? note.tags.join(', ') : '';
			} else {
				this.showToast({ variant: 'error', title: 'Error', description: 'Note not found.' });
				this.editingNoteId = null;
			}

			this.prepareEasyMDE(id);
		},

		async saveNote() {
			let finalTitle = this.noteEditorTitle.trim();
			if (!finalTitle) {
				// If title is empty or just whitespace, use a default title
				finalTitle = 'Note at ' + new Date().toString().substr(0, 21); // Use a more readable format
			}

			const tags = this.noteEditorTags.split(',').map(tag => tag.trim()).filter(tag => tag);

			const noteData = {
				title: finalTitle,
				content: window.easyMDEInstance?.value() || this.noteEditorContent,
				reminder: this.noteEditorReminder.trim() !== '' ? this.noteEditorReminder : undefined,
				tags: tags,
			};

			if (this.noteEditorNoteId && this.noteEditorNoteId !== 'new') {
				await this.updateNote(this.noteEditorNoteId, noteData);
			} else {
				const newNote = await this.addNote(noteData.title, noteData.content, noteData.reminder, noteData.tags);
				if (newNote) {
					this.noteEditorNoteId = newNote.id;
				}
			}

			this.cancelEdit();
			this.fetchNotes();
		},

		async shareNote() {
			const content = window.easyMDEInstance?.value();
			if (!content || !content.trim()) {
				this.showToast({ variant: 'error', title: 'Cannot Share', description: 'You cannot share an empty note.' });
				return;
			}

			try {
				const response = await fetch('/api/publish', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ title: this.noteEditorTitle, content: content }),
				});

				const data = await response.json();

				if (response.ok && data.url) {
					const fullUrl = window.location.origin + data.url;
					this.showToast({ title: 'Note Published', description: 'A shareable link has been created.' });
					// Use a prompt to make the URL easy to copy

					navigator.clipboard.writeText(fullUrl);

					prompt('Share this URL:', fullUrl);
				} else {
					throw new Error(data.error || 'Failed to create shareable link.');
				}
			} catch (error) {
				console.error('Share error:', error);
				this.showToast({ variant: 'error', title: 'Sharing Failed', description: error.message });
			}
		},

		cancelEdit() {
			if (this.editorAutosaveIntervalId) {
				clearInterval(this.editorAutosaveIntervalId);
				this.editorAutosaveIntervalId = null;
			}
			window.easyMDEInstance?.toTextArea?.();
			window.easyMDEInstance = null;

			if (window.location.hash.includes('_note')) {
				window.location.hash = '';
			}

			this.editingNoteId = null;
		},

		// --- Settings Dialog Data & Methods (moved from settingsDialog component) ---
		settingsDialogIsOpen: false,
		s3Region: '',
		s3Bucket: '',
		s3Subfolder: '',
		s3Endpoint: '',
		accessKeyId: '',
		secretAccessKey: '',
		isManualSyncing: false,
		exportString: '',
		importString: '',
		showImportModal: false,
		showExportModal: false,

		// initSettingsDialog() {
		//     this.$watch('settingsDialogIsOpen', (value) => {
		//         if (value) {
		//             this.loadSettingsFromStorage();
		//         }
		//     });
		// },

		get userId() {
			return this.user ? this.user.id : null;
		},

		

		async loadSettingsFromStorage() {
			const storedData = await getEncryptedSettingsDB();
			if (!storedData || !storedData.encryptedSettings) return;

			const encryptedSettings = storedData.encryptedSettings;

			decryptSettings(encryptedSettings, this.userId)
				.then(decrypted => {
					if (!decrypted) return;

					this.s3Bucket = decrypted.s3Bucket || '';
					this.s3Region = decrypted.s3Region || '';
					this.s3Endpoint = decrypted.s3Endpoint || '';
					this.s3Subfolder = decrypted.s3Subfolder || '';
					this.accessKeyId = decrypted.accessKeyId || '';
					this.secretAccessKey = decrypted.secretAccessKey || '';
				})
				.catch(error => {
					this.showToast({ title: 'Settings Decryption Error', description: error.message });
				});
		},

		async handleSave() {
			const key = `feathernote-settings-${this.userId}`;

			// Get existing settings to preserve the secret key if not changed
			const existingEncrypted = localStorage.getItem(key);
			let existingSettings = {};
			if (existingEncrypted) {
				const decrypted = await decryptSettings(existingEncrypted, this.userId);
				if(decrypted) existingSettings = decrypted;
			}

			const settingsToStore = {
				s3Bucket: this.s3Bucket,
				s3Region: this.s3Region,
				s3Endpoint: this.s3Endpoint,
				s3Subfolder: this.s3Subfolder,
				accessKeyId: this.accessKeyId,
				secretAccessKey: existingSettings.secretAccessKey || ''
			};

			if (this.secretAccessKey) {
				// Only update the secret key if a new one is entered
				settingsToStore.secretAccessKey = this.secretAccessKey;
			}

			const encryptedSettings = await encryptSettings(settingsToStore, this.userId);

			// Save encrypted settings to IndexedDB
			await saveEncryptedSettingsDB(encryptedSettings, this.userId);
			console.log('handleSave: Encrypted settings saved to IndexedDB.');

			this.showToast({ title: 'Settings Saved', description: 'Your encrypted S3 credentials have been updated.' });
			// this.settingsDialogIsOpen = false;
			this.syncNotes(true);
		},

		async handleSync() {
			this.isManualSyncing = true;
			await this.syncNotes(false);
			this.isManualSyncing = false;
		},

		async handleExport() {
			const key = `feathernote-settings-${this.userId}`;
			const encryptedString = localStorage.getItem(key);
			if (encryptedString) {
				this.exportString = encryptedString;
			} else {
				this.showToast({ variant: 'error', title: 'Nothing to Export', description: 'No saved settings found.' });
			}
			this.showExportModal = true; // Ensure the modal opens
			this.$nextTick(() => document.querySelector('[x-model="exportString"]').scrollIntoView());
		},

		copyExportStringToClipboard() {
			var copyText = document.querySelector('[x-model="exportString"]');
			copyText.select();
			copyText.setSelectionRange(0, 99999);

			navigator.clipboard.writeText(this.exportString);
			this.showToast({ title: 'Copied!', description: 'Encrypted settings string copied to clipboard.' });
		},

		async openImport() {
			this.importString = '';
			this.showImportModal = true;
			this.$nextTick(() => document.querySelector('[x-model="importString"]').scrollIntoView());
		},

		async handleImport() {
			const userId = this.user ? this.user.id : null;

			try {
				const parsed = JSON.parse(this.importString?.trim());
				if (parsed.salt && parsed.iv && parsed.content) {
					await saveEncryptedSettingsDB(this.importString, userId);
					await this.loadSettingsFromStorage();
					this.showToast({ title: 'Settings Imported', description: 'Your encrypted S3 credentials have been imported.' });
					await this.handleSave();
					this.importString = '';
					this.showImportModal = false; // Close the modal after successful import
				} else {
					throw new Error('Invalid or incomplete settings data.');
				}
			} catch (error) {
				console.error(error);
				this.showToast({ variant: 'error', title: 'Import Failed', description: 'The provided string is not a valid encrypted settings configuration.' });
			}
		}
	}));
});
