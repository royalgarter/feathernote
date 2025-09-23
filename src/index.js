document.addEventListener('alpine:init', () => { Alpine.data('mainApp', () => ({
	GOOGLE_CLIENT_ID: "547832701518-ai09ubbqs2i3m5gebpmkt8ccfkmk58ru.apps.googleusercontent.com",

	// --- App Data ---
	toasts: [],
	toastIdCounter: 0,
	darkMode: false,
	appVersion: '',

	// --- Sync Settings ---
	// syncSelection: 's3', // 's3', 'gdrive', 'nostr'
	gdriveStore: {
		connected: false,
		user: null,
	},

	// --- Auth Data ---
	user: null,
	isGsiLoaded: false,

	// --- Note Manager Data ---
	notes: [],
	searchTag: '',
	suggestions: [], // New property
	loading: true,
	miniSearch: null,
	isSyncing: false,
	syncStatusMessage: '',
	isSaving: false,
	syncIntervalId: null,
	editingNoteId: null, // New state to track which note is being edited
	deletedNoteIds: [],
	deletedNotesStack: [], // For session-only undo
	lastSync: null,
	currentPage: 1,
	notesPerPage: 100,

	// --- Note Editor Data ---
	easyMDEIniting: false,
	editorAutosaveIntervalId: null,
	noteEditorVisible: false,
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
		if (location.href.includes('//localhost')) {
			document.querySelector('head title').innerHTML = '(local) FeatherNote';
		}

		this.darkMode = localStorage.getItem('feathernote-dark-mode') === 'true';
		this.$watch('darkMode', (value) => { localStorage.setItem('feathernote-dark-mode', value); });

		// this.syncSelection = localStorage.getItem('feathernote-sync-selection') || 's3';
		// this.$watch('syncSelection', (value) => { localStorage.setItem('feathernote-sync-selection', value); });

		this.nostrRelays = localStorage.getItem('feathernote-nostr-relays') || 'wss://relay.damus.io';

		this.$nextTick(() => {
			this.processSharedContent();
		});

		fetch('/api/version').then(res => res.json()).then(data => {
			this.appVersion = data.version;
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
				if (typeof gisLoaded === 'function') {
					gisLoaded();
				}
			};
			document.body.appendChild(script);
		}

		// Load GAPI script
		if (!document.querySelector('script[src="https://apis.google.com/js/api.js"]')) {
			const script = document.createElement('script');
			script.src = 'https://apis.google.com/js/api.js';
			script.async = true;
			script.defer = true;
			script.onload = () => {
				if (typeof gapiLoaded === 'function') {
					gapiLoaded();
				}
			};
			document.body.appendChild(script);
		}

		// Note Manager Init
		const lastSync = localStorage.getItem('feathernote-lastSync');
		if (lastSync) {
			this.lastSync = lastSync;
		}

		const deletedNoteIds = localStorage.getItem('feathernote-deleted-note-ids');
		if (deletedNoteIds) {
			try {
				this.deletedNoteIds = JSON.parse(deletedNoteIds);
			} catch (e) {
				this.deletedNoteIds = [];
			}
		}

		this.miniSearch = window.MiniSearch ? new MiniSearch({
			fields: ['title', 'content', 'tags'], // Fields to search!
			storeFields: ['id', 'title', 'content', 'createdAt', 'updatedAt', 'reminder', 'tags'] // Fields to return
		}) : null;

		this.fetchNotes();
		this.loadSettingsFromStorage().then(_ => {
			this.syncNotes();
		})

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
					this.saveNote(true);
				} else {
					this.syncNotes(false);
				}
			} else if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
				if (!this.editingNoteId) {
					event.preventDefault();
					this.revertDelete();
				}
			} else if (event.key === 'Escape') {
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

	getCoverImage(note) {
		if (note?._cover) return note._cover;
		if (!note?.content) return null;
		const match = note.content.match(/!\[.*\]\((.*)\)/);
		if (!match) return null;
		try {
			note._cover = new URL(match[1]).href;
			return match[1];
		} catch (e) { return null }
	},

	showToast({ title, description, variant = 'default', duration = 3e3, quiet }) {
		const id = `toast-${this.toastIdCounter++}`;
		const newToast = { id, title, description, variant, show: true };
		if (!quiet) this.toasts.push(newToast);

		this.syncStatusMessage = description;

		setTimeout(() => {
			this.dismissToast(id);
			if (this.syncStatusMessage === description) {
				this.syncStatusMessage = '';
			}
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

			if (confirm('Signed in. Do you want to connect to Google Drive (optional)?')) {
				this.signInToGoogleDrive();
			}
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
		if (confirm('Are you sure you want to sign out?')) {
			this.user = null;
			localStorage.removeItem('feathernote-user');
			localStorage.removeItem('feathernote-has-logged-in');
			if (window.google && window.google.accounts) {
				window.google.accounts.id.disableAutoSelect();
			}

			this.signOutFromGoogleDrive();
			this.showToast({ title: 'Signed Out', description: 'You have been signed out.' });
		}
	},

	signInToGoogleDrive() {
		if (typeof signInToGoogleDrive === 'function') {
			signInToGoogleDrive();
		} else {
			this.showToast({ variant: 'error', title: 'Error', description: 'Google Drive sync is not initialized.' });
		}
	},

	signOutFromGoogleDrive() {
		if (typeof signOutFromGoogleDrive === 'function') {
			signOutFromGoogleDrive();
			this.gdriveStore.connected = false;
			this.gdriveStore.user = null;
			this.showToast({ title: 'Disconnected', description: 'You have been disconnected from Google Drive.' });
		}
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
			this.updateAppBadge();
			this.miniSearch?.removeAll();

			const uniqueNotes = Array.from(new Map(this.notes.map(note => [note.id, note])).values());
			if (uniqueNotes.length < this.notes.length) {
				console.warn('Duplicate note IDs found in database. De-duplicating for search index and in-memory array.');
				this.notes = uniqueNotes;
			}

			this.miniSearch?.addAll(this.notes);
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
			// this.miniSearch?.removeAll();

			if (!this.miniSearch.has(updatedNote.id)) this.miniSearch.add(updatedNote);

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
		if (this.isSyncing) return; // Don't autosave while a sync is in progress
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

		await this.updateNote(id, noteData, true);
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
		localStorage.setItem('feathernote-deleted-note-ids', JSON.stringify(this.deletedNoteIds));

		this.showToast({ title: 'Note Restored', description: `"${noteToRestore.title}" has been restored.` });
	},

	async deleteNote(id) {
		try {
			const noteToDelete = this.notes.find(note => note.id === id);
			if (noteToDelete) {
				if (window.easyMDEInstance?.value?.()?.length || noteToDelete.content?.length) {
					if (!confirm(`Delete note "${noteToDelete.title || noteToDelete.id}"?`)) return;
				}

				this.deletedNotesStack.push({ ...noteToDelete }); // For session-only undo
			}

			// Delete from local DB
			await deleteNoteDB(id);

			// Remove from UI
			this.notes = this.notes.filter((note) => note.id !== id);

			// Add to deletion queue for next sync
			if (!this.deletedNoteIds.includes(id)) {
				this.deletedNoteIds.push(id);
				localStorage.setItem('feathernote-deleted-note-ids', JSON.stringify(this.deletedNoteIds));
			}

			this.showToast({ title: 'Note Deleted', description: 'Press Ctrl+Z to undo. Syncing to remove from other devices.' });
			this.cancelEdit();

			// Trigger a silent sync to process the remote deletion
			this.syncNotes(true);

		} catch (error) {
			console.error('Error in deleteNote:', error);
			this.showToast({ variant: 'error', title: 'Error', description: 'Could not delete note locally.' });
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

	async mergeRemoteNote(remoteNote) {
		const localNote = await this.getNote(remoteNote.id);

		// If remote note is newer, update local note
		if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
			if (typeof remoteNote.content === 'undefined') {
				console.warn(`Downloaded note ${remoteNote.id} from server has no content. Skipping.`);
				return false; // Indicate no update happened
			}

			await updateNoteDB(remoteNote);
			return remoteNote; // Return the updated note
		}
		return false; // Indicate no update happened
	},

	async syncNotes(isSilent = false, iterator = 0, notes = null) {
		if (this.isSyncing) {
			return;
		}
		this.isSyncing = true;
		this.syncStatusMessage = 'Syncing...';
		const userId = this.user ? this.user.id : null;

		try {
			const storedData = await getEncryptedSettingsDB(); // Get from IndexedDB
			const encryptedSettings = storedData ? storedData.encryptedSettings : null;

			if (!encryptedSettings) {
				isSilent = true;
				throw new Error('S3 credentials not found in IndexedDB.');
			}

			const credentials = await decryptSettings(encryptedSettings, userId);

			const result = await synchronize(
				isSilent,
				credentials,
				this.nostrPrivateKey,
				this.nostrRelays,
				this.gdriveStore,
				this.deletedNoteIds,
				this.lastSync,
				notes
			);

			if (result.success) {
				if (result.gdrive) {
					this.fetchNotes(); // Refresh notes from DB
					if (!isSilent) {
						this.showToast({ title: 'Google Drive Sync', description: 'Sync completed successfully.' });
					}
					// GDrive sync was successful, clear the pending deletions.
					this.deletedNoteIds = [];
					localStorage.removeItem('feathernote-deleted-note-ids');
				} else {
					// Handle downloaded notes
					let downloadedCount = 0;
					let notesToDeleteLocally = [];

					// If GDrive is not the main provider, perform a two-way sync with S3.
					// Otherwise, S3 is a secondary provider, and we only push changes, not pull.
					if (!this.gdriveStore.connected) {
						for (const remoteNote of result.updatedNotes) {
							if (await this.mergeRemoteNote(remoteNote)) {
								downloadedCount++;
							}
						}

						// Handle notes that were deleted on the remote (S3)
						notesToDeleteLocally = result.notesToDeleteLocally || [];
						for (const noteIdToDelete of notesToDeleteLocally) {
							await deleteNoteDB(noteIdToDelete);
						}
					}

					await this.fetchNotes(); // Refresh notes from DB after all updates/deletions

					this.lastSync = new Date().toISOString();
					localStorage.setItem('feathernote-lastSync', this.lastSync);

					// After notes are synced, sync images
					if (encryptedSettings) {
						const imageSyncResult = await synchronizeImages(encryptedSettings, userId, this.nostrPrivateKey, this.nostrRelays);
												if (imageSyncResult.success) {
														const { uploadedImageCount, downloadedImageCount, deletedOrphanCount } = imageSyncResult;
														if (!isSilent && (uploadedImageCount > 0 || downloadedImageCount > 0 || deletedOrphanCount > 0)) {
															let description = `${uploadedImageCount} uploaded, ${downloadedImageCount} downloaded.`;
															if (deletedOrphanCount > 0) {
																description += ` ${deletedOrphanCount} orphaned images deleted.`;
															}
															this.showToast({
																title: 'Image Sync Complete',
																description,
															});
														}
													} else {							if (!isSilent) {
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

					// S3/Nostr sync was successful, filter the pending deletions
					if (result.successfulDeletedIds) {
						 this.deletedNoteIds = this.deletedNoteIds.filter(id => !result.successfulDeletedIds.includes(id));
						 localStorage.setItem('feathernote-deleted-note-ids', JSON.stringify(this.deletedNoteIds));
					}
				}
			} else {
				throw new Error(result.error || 'Server responded with an error.');
			}
		} catch (error) {
			if (!isSilent) {
				let errorMessage = 'An unknown error occurred.';
				let errorTitle = 'Incomplete Sync';
				let quiet = false;

				if (error instanceof TypeError) {
					errorTitle = 'Network Error';
					errorMessage = `Could not connect to the server. Please check your internet connection or server status. This could also be a CORS issue.`;
				} else if (error instanceof Error) {
					quiet = true;
					errorMessage = error.message;
				}

				this.showToast({
					quiet,
					title: errorTitle,
					description: errorMessage,
					duration: 5e3,
				});
			}
		} finally {
			this.isSyncing = false;
			this.syncStatusMessage = '';
		}
	},

	async processSharedContent() {
		await navigator.locks.request('shared-content-lock', async lock => {
			try {
				const sharedItems = await getSharedContentDB();

				if (sharedItems.length > 0) {
					console.dir({sharedItems});
					for (const item of sharedItems) {
						await this.addNote(item.title || ('Share ' + new Date().toString().substr(0, 21)), item.content, null, item.tags);
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
		if (!window.EasyMDE) return;

		this.noteEditorVisible = false;
		this.easyMDEIniting = true;
		try {
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
					uniqueId: [id, Date.now()].join('-'),
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
					{
						name: "Save",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.saveNote(true);
						},
						className: "fa fa-save",
						title: "Save",
					},{
						name: "Delete",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.deleteNote(window.easyMDEInstance?.uniqueId || id);
						},
						className: "fa fa-trash-o",
						title: "Delete",
					},{
						name: "share",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.shareNote();
						},
						className: "fa fa-share-square-o",
						title: "Share",
					},
					"|",
					"bold", "italic", "heading",
					"quote", "unordered-list", "ordered-list", "|",
					"link", "image",
					{
						name: "image",
						action: function(editor) {
							if (!window.ExcalidrawLib || !window.React || !window.ReactDOM) {
								const excalidrawWindow = window.open("https://excalidraw.com", "_blank");

								const checkWindowClosed = setInterval(() => {
									if (excalidrawWindow.closed) {
										clearInterval(checkWindowClosed);
										const shareLink = prompt("Please paste the Excalidraw share link here:");
										if (shareLink) {
											const cm = editor.codemirror;
											cm.replaceSelection(`\n![Drawing](${shareLink})\n`);
										}
									}
								});

								return;
							}

							const excalidrawModal = document.getElementById('excalidraw-modal');
							excalidrawModal.style.display = 'flex';

							const excalidrawContainer = document.getElementById('excalidraw-container');
							let excalidrawAPI;

							const excalidrawComponent = React.createElement(window.ExcalidrawLib.Excalidraw, {
								excalidrawAPI: (api) => excalidrawAPI = api,
								onChange: (elements, state) => {
									console.log(elements, state);
								}
							});

							ReactDOM.render(excalidrawComponent, excalidrawContainer);

							const saveButton = document.createElement('button');
							saveButton.innerHTML = 'Save';
							saveButton.className = 'absolute top-2 right-2 bg-purple-500 text-white px-4 py-2 rounded';
							saveButton.onclick = async () => {
								if (!excalidrawAPI) return;

								try {
									const blob = await window.ExcalidrawLib.exportToBlob({
										elements: excalidrawAPI.getSceneElements(),
										appState: excalidrawAPI.getAppState(),
										mimeType: 'image/png',
									});

									if (!blob) {
										console.error("Excalidraw export returned an empty blob.");
										alert("Could not save drawing: export failed.");
										return;
									}

									const imageId = crypto.randomUUID();
									const imageRecord = { id: imageId, blob: blob, synced: false };

									await addImageDB(imageRecord);
									const markdown = `\n![Drawing](/images/${imageId})\n`;
									const cm = editor.codemirror;
									cm.replaceSelection(markdown);

								} catch (err) {
									console.error("Failed to save drawing to IndexedDB", err);
									alert("Could not save drawing to the database.");
								} finally {
									ReactDOM.unmountComponentAtNode(excalidrawContainer);
									excalidrawModal.style.display = 'none';
									excalidrawContainer.innerHTML = '';
								}
							};

							const cancelButton = document.createElement('button');
							cancelButton.innerHTML = 'Cancel';
							cancelButton.className = 'absolute top-2 right-20 bg-red-500 text-white px-4 py-2 rounded';
							cancelButton.onclick = () => {
								ReactDOM.unmountComponentAtNode(excalidrawContainer);
								excalidrawModal.style.display = 'none';
								excalidrawContainer.innerHTML = '';
							};

							excalidrawContainer.appendChild(saveButton);
							excalidrawContainer.appendChild(cancelButton);
						},
						className: "fa fa-paint-brush",
						title: "Excalidraw",
					},
					"code", "table",
					{
						name: "word-wrap",
						action: function(editor){
							const cm = editor.codemirror;
							cm.setOption("lineWrapping", !cm.getOption("lineWrapping"));
						},
						className: "fa fa-text-width",
						title: "Word Wrap",
					}, "|",
					"preview", "side-by-side", "fullscreen", "|",
					{
						name: "clip",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.clipNoteContent(window.easyMDEInstance?.uniqueId || id);
						},
						className: "fa fa-paperclip",
						title: "Clip Content",
					},{
						name: "auto-tags",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.extractTagsWithAI();
						},
						className: "fa fa-tags",
						title: "Auto-Tags with AI",
					},{
						name: "summarize",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.summarizeWithAI();
						},
						className: "fa fa-pencil",
						title: "Summarize with AI",
					},{
						name: "improve",
						action: function(editor){
							Alpine.$data(document.querySelector('body'))?.improveWithAI();
						},
						className: "fa fa-lightbulb-o",
						title: "Improve with AI",
					},
					"|", "undo", "redo",
					"|", "guide",
				]
			});
			window.easyMDEInstance.uniqueId = id;

			const cm = window.easyMDEInstance.codemirror;
			cm?.on('paste', (cmInstance, event) => {
				const items = (event.clipboardData || event.originalEvent.clipboardData).items;
				let textItem = null;
				let imageItem = null;

				// Separate items
				for (let i = 0; i < items.length; i++) {
					if (items[i].kind === 'string' && items[i].type === 'text/plain') {
						textItem = items[i];
					}
					if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
						imageItem = items[i];
					}
				}

				// Handle images first
				if (imageItem) {
					event.preventDefault();
					const blob = imageItem.getAsFile();
					if (!blob) return;

					const imageId = crypto.randomUUID();
					const imageRecord = { id: imageId, blob: blob, synced: false };

					addImageDB(imageRecord).then(() => {
						const markdown = `\n![Image](/images/${imageId})\n`;
						cm.replaceSelection(markdown);
					}).catch(err => {
						console.error("Failed to save image to IndexedDB", err);
					});
					return;
				}

				// Handle text, potentially a URL
				if (textItem) {
					event.preventDefault(); // Prevent default paste to handle it async
					textItem.getAsString(async (pastedString) => {
						const urlRegex = /^(https?:\/\/[^\s]+)$/;
						const urlToParse = pastedString.trim();

						if (urlToParse.length < 2083 && urlRegex.test(urlToParse)) {
							if (confirm('Extracting the web content?')) {
								document.body.style.cursor = 'wait';
								let html;
								try {
									let article = await this.extractArticle(urlToParse);

									if (article && article.content) {
										const content = `[${article.title || urlToParse}](${urlToParse})\n\n${article.textContent.trim()}\n\n${article.lead_image_url ? `![](${article.lead_image_url})\n\n` : ''}`;

										cm.replaceSelection(content);
									} else {
										throw new Error("Readability could not parse the article.");
									}

								} catch (error) {
									console.error('Content extraction failed:', error);
									alert(`Could not extract content: ${error.message}. Pasting URL instead.`);
									cm.replaceSelection(pastedString); // Fallback to pasting the original string
								} finally {
									document.body.style.cursor = 'default';
								}
							} else {
								// User cancelled confirm dialog
								cm.replaceSelection(pastedString);
							}
						} else {
							// Not a URL, just a normal paste
							cm.replaceSelection(pastedString);
						}
					});
				}
			});

			cm?.on('mousedown', (cmInstance, event) => {
				if ((event.ctrlKey || event.metaKey) && event.button === 0) { // Ctrl/Cmd + Left Click
					const target = event.target;
					if (target.tagName === 'SPAN' && target.classList.contains('cm-link')) {
						event.preventDefault();
						const url = target.innerText;
						try {
							// Use the URL constructor for robust validation
							new URL(url);
							window.open(url, '_blank');
						} catch (e) {
							console.error("Invalid URL:", url);
						}
					}
				}
			});

			this.noteEditorVisible = false;
			this.easyMDEIniting = false;
		} catch (ex) {
			this.easyMDEIniting = false;
			this.noteEditorVisible = true;
			this.showToast({ variant: 'error', title: 'Error', description: 'EasyMDE is not supported' });
		}
	},

	async extractArticle(url) {
		let html;
		try {
			console.log('Attempting direct fetch...');
			const response = await fetch(url);
			if (!response.ok) throw new Error('Direct fetch failed with status: ' + response.status);
			html = await response.text();
			console.log('Direct fetch successful.');
		} catch (e) {
			console.log('Direct fetch failed, falling back to proxy...', e.message);
			const proxyResponse = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
			if (!proxyResponse.ok) throw new Error('Proxy fetch also failed with status: ' + proxyResponse.status);
			html = await proxyResponse.text();
			console.log('Proxy fetch successful.');
		}

		if (typeof Readability === 'undefined') {
			throw new Error("Readability.js script not loaded.");
		}

		const doc = new DOMParser().parseFromString(html, 'text/html');
		const reader = new Readability(doc);
		const article = reader.parse();

		if (article && article.content) {
			const REGEX_IMAGE = /<meta[^>]*property=["']\w+:image["'][^>]*content=["']([^"']*)["'][^>]*>/i;

			article.lead_image_url = article.lead_image_url || html?.match(REGEX_IMAGE)?.[1];

			return article;
		} else {
			throw new Error("Readability could not parse the article.");
		}
	},

	async clipNoteContent(noteId, skipSave) {
		if (!noteId) return;

		this.isSyncing = 'Clipping note content...';
		document.body.style.cursor = 'wait';
		try {
			const note = await this.getNote(noteId);

			let content = window.easyMDEInstance?.value?.() || this.noteEditorContent || note?.content || '';

			const urlRegex = /(https?:\/\/[^\s\(\)\[\]]+)/;
			const match = note.content.match(urlRegex);
			if (!match) throw new Error("No URL found in the note to clip.");

			const urlToClip = match[0];
			const article = await this.extractArticle(urlToClip);

			const newContent = (!article)
				? content
				: [
					content,
					'---',
					article.textContent?.trim?.(),
					article.lead_image_url ? `![](${article.lead_image_url})\n\n` : '',
				].join('\n\n').trim();

			// Remove the #needs-clipping tag
			const newTags = (note.tags || []).filter(tag => tag !== '#needs-clipping');

			// Update the note in the editor if it's currently being edited
			this.noteEditorContent = newContent;
			this.noteEditorTags = newTags.join(', ');
			if (window.easyMDEInstance) window.easyMDEInstance.value(newContent);

			// Save the note
			if (!skipSave) await this.updateNote(noteId, {
				title: note.title || article?.title,
				content: newContent,
				tags: newTags
			});

			this.showToast({
				title: 'Content Clipped',
				description: 'Article content has been successfully extracted.'
			});

			return newContent;
		} catch (error) {
			console.error('Failed to clip content:', error);
			this.showToast({
				variant: 'error',
				title: 'Clipping Failed',
				description: error.message
			});
		} finally {
			document.body.style.cursor = 'default';
			this.isSyncing = false;
		}
	},

	createNewNote() {
		this.editingNoteId = new Date().toString().substr(0, 21);
		this.noteEditorNoteId = null;
		this.noteEditorTitle = '';
		this.noteEditorContent = '';
		this.noteEditorReminder = '';
		this.noteEditorTags = '';

		this.$nextTick(() => this.prepareEasyMDE(this.editingNoteId));
		this.$nextTick(() => document.getElementById('note-title').setAttribute('placeholder', 'Note at ' + new Date().toString().substr(0, 21)));

		window.location.hash = '#new_note';
	},

	async editNote(id) {
		if (this.editorAutosaveIntervalId) {
			clearInterval(this.editorAutosaveIntervalId);
		}
		this.editingNoteId = id;
		let noteToLoad = id;

		try {
			const userId = this.user ? this.user.id : null;
			const storedData = await getEncryptedSettingsDB();
			const encryptedSettings = storedData ? storedData.encryptedSettings : null;

			if (encryptedSettings && userId) {
				const credentials = await decryptSettings(encryptedSettings, userId);
				if (credentials) {
					const remoteMeta = await getNoteMetadataFromS3(id, credentials);
					const localNote = await getNoteDB(id);

					if (remoteMeta && localNote && new Date(remoteMeta.lastModified) > new Date(localNote.updatedAt)) {
						const remoteNote = await downloadNoteFromS3(id, credentials);

						if (remoteNote.content) {
							const updatedNote = await this.mergeRemoteNote(remoteNote);
							if (updatedNote) {
								noteToLoad = updatedNote;
								this.showToast({
									title: 'Note Updated',
									description: 'A newer version of this note was found on the server and has been loaded.',
									duration: 5000
								});
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('Pre-edit sync check failed:', error);
			this.showToast({
				variant: 'error',
				title: 'Sync Check Failed',
				description: 'Could not verify the latest version of the note. Please sync manually.'
			});
		}

		await this.loadNoteIntoEditor(noteToLoad);
		this.editorAutosaveIntervalId = setInterval(() => {
			this.autosaveCurrentNote();
		}, 60 * 1000);
		window.location.hash = '#edit_note-' + id;
	},

	// --- Note Editor Methods (moved from noteEditor component) ---
	async loadNoteIntoEditor(noteOrId) {
		const isId = typeof noteOrId === 'string';
		const id = isId ? noteOrId : noteOrId.id;

		if (this.noteEditorNoteId === id && window.easyMDEInstance) return;
		this.noteEditorNoteId = id;
		if (!this.noteEditorNoteId) return;

		const note = isId ? await this.getNote(id) : noteOrId;

		if (note) {
			this.noteEditorTitle = note.title;
			this.noteEditorContent = note.content;
			this.noteEditorReminder = note.reminder || '';
			this.noteEditorTags = note.tags ? note.tags.join(', ') : '';
		} else {
			this.showToast({ variant: 'error', title: 'Error', description: 'Note not found.' });
			this.editingNoteId = null;
		}

		this.$nextTick(() => this.prepareEasyMDE(id));
	},

	async saveNote(isAuto) {
		if (this.isSaving) return;
		this.isSaving = true;
		try {
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

			if (!isAuto) {
				this.cancelEdit();
				this.fetchNotes();
			}
		} finally {
			this.isSaving = false;
		}
	},

	async shareNote() {
		const content = window.easyMDEInstance?.value();
		if (!content || !content.trim()) {
			this.showToast({ variant: 'error', title: 'Cannot Share', description: 'You cannot share an empty note.' });
			return;
		}

		let published = false;

		// Prioritize Nostr publishing if configured
		if (this.nostrPrivateKey && this.nostrRelays) {
			try {
				const relays = this.nostrRelays.split(',').map(r => r.trim()).filter(r => r);
				const tags = this.noteEditorTags.split(',').map(tag => tag.trim()).filter(tag => tag);

				this.showToast({ title: 'Publishing to Nostr Relays...', description: this.nostrRelays });
				const result = await publishPublicNoteToRelays(
					relays,
					this.nostrPrivateKey,
					content,
					this.noteEditorTitle,
					tags
				);

				if (result.success) {
					published = true;
					this.showToast({
						title: 'Published to Nostr',
						description: 'A shareable link has been created and copied to your clipboard.'
					});
					navigator.clipboard.writeText(result.url);
					prompt('Share this Nostr URL:', result.url);

				} else {
					throw new Error(result.error || 'Failed to publish to Nostr relays.');
				}
			} catch (error) {
				console.error('Nostr publish error:', error);
				this.showToast({
					variant: 'error',
					title: 'Nostr Publish Failed',
					description: error.message
				});
			}
		}

		if (published) return published; // Stop execution if Nostr was attempted

		// Fallback to server-side publishing
		try {
			this.showToast({ title: 'Publishing...', description: 'Creating a shareable link via the server.' });
			const response = await fetch('/api/publish', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					title: this.noteEditorTitle,
					content: content
				}),
			});

			const data = await response.json();

			if (response.ok && data.url) {
				published = true;
				const fullUrl = window.location.origin + data.url;
				this.showToast({
					title: 'Note Published',
					description: 'A shareable link has been created and copied to your clipboard.'
				});
				navigator.clipboard.writeText(fullUrl);
				prompt('Share this URL:', fullUrl);
			} else {
				throw new Error(data.error || 'Failed to create shareable link.');
			}
		} catch (error) {
			console.error('Share error:', error);
			this.showToast({
				variant: 'error',
				title: 'Sharing Failed',
				description: error.message
			});
		}

		return published;
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

	async processWithAI(promptType) {
		const content = window.easyMDEInstance?.value();
		if (!content || !content.trim()) {
			this.showToast({ variant: 'error', title: `Cannot ${promptType}`, description: `You cannot ${promptType} an empty note.` });
			return;
		}

		if (!this.aiApiKey || !this.aiApiRoute) {
			this.showToast({ variant: 'error', title: 'AI Not Configured', description: 'Please configure your AI API key and route in the settings.' });
			return;
		}

		let systemPrompt = '';
		let userPrompt = '';

		if (promptType === 'improve') {
			systemPrompt = 'You are a helpful assistant that improves text. You will correct grammar, spelling, and make the text more fluent and clear.';
			userPrompt = `Improve the following text:\n\n---\n${content}`;
		} else if (promptType === 'summarize') {
			systemPrompt = 'You are a helpful assistant that summarizes text.';
			userPrompt = `Summarize the following text:\n\n---\n${content}`;
		} else if (promptType === 'extractTags') {
			systemPrompt = 'You are a helpful assistant that extracts tags from text. Return a comma-separated list of tags. Consider the existing tags and the content, and return a new list of tags that is relevant to the content.';
			userPrompt = `Extract tags (maximum 7 tags, each tag is mostly single concise meaningful word) from the following text, considering the existing tags. **Only response in plain string comma-separated text**.\n\nExisting tags: ${this.noteEditorTags}\n\nContent:\n---\n${content}`;
		} else {
			this.showToast({ variant: 'error', title: 'Invalid AI Action', description: 'The requested AI action is not supported.' });
			return;
		}

		userPrompt = prompt(systemPrompt, userPrompt);

		document.body.style.cursor = 'wait';
		try {
			const response = await fetch(this.aiApiRoute, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.aiApiKey}`
				},
				body: JSON.stringify({
					model: this.aiModel || 'gemini-2.5-flash',
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					// reasoning_effort: 'low',
					stream: false,
					extra_body: {
						google: {
							thinking_config: {
								thinking_budget: 0,
							}
						}
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error.message || 'AI API request failed');
			}

			const data = await response.json();
			const resultText = data.choices[0].message.content;

			if (promptType === 'improve') {
				this.noteEditorContent = resultText;
				if (window.easyMDEInstance) window.easyMDEInstance.value(resultText);
				this.showToast({ title: 'Text Improved', description: 'The note content has been improved by AI.' });
			} else if (promptType === 'summarize') {
				const newContent = `${content}\n\n---\n\n**AI Summary:**\n${resultText}`;
				this.noteEditorContent = newContent;
				if (window.easyMDEInstance) window.easyMDEInstance.value(newContent);
				this.showToast({ title: 'Summary Generated', description: 'The AI summary has been added to the note.' });
			} else if (promptType === 'extractTags') {
				this.noteEditorTags = resultText.toLowerCase();
				document.querySelector('#note-tags')?.focus();
				document.querySelector('#note-tags')?.scrollIntoView();
				this.showToast({ title: 'Tags Extracted', description: 'The AI has extracted tags from the note.' });
			}
		} catch (error) {
			console.error(`AI ${promptType} error:`, error);
			this.showToast({ variant: 'error', title: `AI ${promptType} Failed`, description: error.message });
		} finally {
			document.body.style.cursor = 'default';
		}
	},

	async improveWithAI() {
		await this.processWithAI('improve');
	},

	async summarizeWithAI() {
		await this.processWithAI('summarize');
	},

	async extractTagsWithAI() {
		await this.processWithAI('extractTags');
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

	nostrPrivateKey: '',
	nostrRelays: '',

	aiApiKey: '',
	aiApiRoute: '',
	aiModel: '',

	get userId() {
		return this.user ? this.user.id : null;
	},


	async loadSettingsFromStorage() {
		const storedData = await getEncryptedSettingsDB();
		if (!storedData || !storedData.encryptedSettings) return;

		const encryptedSettings = storedData.encryptedSettings;

		decrypted = await decryptSettings(encryptedSettings, this.userId).catch(error => {
			this.showToast({ title: 'Settings Decryption Error', description: error.message });
		});
		if (!decrypted) return;

		this.s3Bucket = decrypted.s3Bucket || '';
		this.s3Region = decrypted.s3Region || '';
		this.s3Endpoint = decrypted.s3Endpoint || '';
		this.s3Subfolder = decrypted.s3Subfolder || '';
		this.accessKeyId = decrypted.accessKeyId || '';
		this.secretAccessKey = decrypted.secretAccessKey || '';
		this.nostrPrivateKey = decrypted.nostrPrivateKey || '';
		this.aiApiKey = decrypted.aiApiKey || '';
		this.aiApiRoute = decrypted.aiApiRoute || '';
		this.aiModel = decrypted.aiModel || '';
	},

	async handleSave() {
		localStorage.setItem('feathernote-nostr-relays', this.nostrRelays);

		// Get existing settings to preserve the secret key if not changed
		const storedData = await getEncryptedSettingsDB();
		const existingEncrypted = storedData ? storedData.encryptedSettings : null;
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
			secretAccessKey: existingSettings.secretAccessKey || '',
			nostrPrivateKey: this.nostrPrivateKey,
			aiApiKey: this.aiApiKey,
			aiApiRoute: this.aiApiRoute,
			aiModel: this.aiModel
		};

		if (this.secretAccessKey) {
			// Only update the secret key if a new one is entered
			settingsToStore.secretAccessKey = this.secretAccessKey;
		}

		const encryptedSettings = await encryptSettings(settingsToStore, this.userId, this.nostrPrivateKey);

		// Save encrypted settings to IndexedDB
		await saveEncryptedSettingsDB(encryptedSettings, this.userId);
		console.log('handleSave: Encrypted settings saved to IndexedDB.');

		this.showToast({ title: 'Settings Saved', description: 'Your encrypted settings have been updated.' });
		// this.settingsDialogIsOpen = false;
		this.syncNotes(true);
	},

	async handleSync() {
		this.isManualSyncing = true;
		await this.syncNotes(false);
		this.isManualSyncing = false;
	},

	async handleExport() {
		const storedData = await getEncryptedSettingsDB();
		const encryptedString = storedData ? storedData.encryptedSettings : null;
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
				this.showToast({ title: 'Settings Imported', description: 'Your encrypted settings have been imported.' });
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
	},
})); });
