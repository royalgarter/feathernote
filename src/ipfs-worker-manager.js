// IPFS Worker Manager - Falls back to main thread if worker fails
// Note: Web Workers cannot load ES modules from CDN, so we use a fallback approach

class IPFSWorkerManager {
	constructor() {
		this.worker = null;
		this.pendingRequests = new Map();
		this.requestIdCounter = 0;
		this.initialized = false;
		this.initializing = false;
		this.ipfsRootCid = null;
		this.updateIpfsRootCidCallback = null;
		this._workerHealthy = true; // Track worker health
		this._useWorker = false; // Disabled by default due to CDN limitations
	}

	init() {
		if (this.worker || this.initializing) return;
		this.initializing = true;

		// Create worker - use full path for reliability
		const workerUrl = new URL('/ipfs-worker.js', window.location.origin).href;
		this.worker = new Worker(workerUrl, { type: 'module' });

		// Handle messages from worker
		this.worker.onmessage = (event) => {
			const { type, requestId, success, error, ...data } = event.data;

			// Handle initialization complete (no requestId)
			if (type === 'INIT_HELIA_COMPLETE') {
				this.initializing = false;
				if (success) {
					this.initialized = true;
					console.log('IPFS Worker Manager: Helia initialized in worker');
				} else {
					console.error('IPFS Worker: Failed to initialize Helia:', error);
				}
				return;
			}

			// Handle health check response
			if (type === 'HEALTH_CHECK_COMPLETE') {
				const pending = this.pendingRequests.get(requestId);
				if (pending) {
					this.pendingRequests.delete(requestId);
					pending.resolve(data);
				}
				return;
			}

			// Handle error messages from worker
			if (type?.endsWith('_ERROR')) {
				const originalType = type.replace('_ERROR', '');
				const pending = this.pendingRequests.get(requestId);
				if (pending) {
					this.pendingRequests.delete(requestId);
					pending.reject(new Error(error || `${originalType} failed`));
				}
				// Mark worker as potentially unhealthy for recovery
				this._workerHealthy = false;
				return;
			}

			// Handle unsolicited messages (like root CID updates)
			if (type === 'INDEX_READY' && data.cid) {
				this.ipfsRootCid = data.cid;
				if (this.updateIpfsRootCidCallback) {
					this.updateIpfsRootCidCallback(data.cid);
				}
				return;
			}

			// Resolve pending request
			const pending = this.pendingRequests.get(requestId);
			if (pending) {
				this.pendingRequests.delete(requestId);
				if (success) {
					this._workerHealthy = true; // Mark healthy on success
					pending.resolve(data);
				} else {
					pending.reject(new Error(error || 'Unknown error'));
				}
			}
		};

		this.worker.onerror = (error) => {
			console.error('IPFS Worker error:', error);
			this.initializing = false;
		};

		console.log('IPFS Worker Manager: Worker created');
	}

	_sendMessage(type, payload = {}) {
		return new Promise((resolve, reject) => {
			if (!this.worker) {
				this.init();
			}

			const requestId = ++this.requestIdCounter;
			this.pendingRequests.set(requestId, { resolve, reject, type });

			console.log(`IPFS Worker Manager: Sending ${type} (requestId: ${requestId})`, payload);
			this.worker.postMessage({ type, payload, requestId });

			// Timeout after 30 seconds (reduced from 60 for better UX)
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId);
					console.error(`IPFS Worker: Timeout for ${type} (requestId: ${requestId})`);
					reject(new Error(`IPFS Worker timeout for ${type}`));
				}
			}, 30000);
		});
	}

	// Handle worker errors and attempt recovery
	async _handleError(error, type) {
		console.error(`IPFS Worker: Error during ${type}:`, error);
		// Clear pending requests for this type
		for (const [requestId, pending] of this.pendingRequests.entries()) {
			if (pending.type === type) {
				this.pendingRequests.delete(requestId);
				pending.reject(error);
			}
		}
		// Attempt recovery
		await this.recover();
	}

	async ensureInitialized() {
		if (this.initialized && this._workerHealthy) return;
		
		// If worker was unhealthy, attempt recovery
		if (!this._workerHealthy) {
			console.log('IPFS Worker Manager: Worker was unhealthy, recovering...');
			await this.recover();
			return;
		}
		
		if (this.initializing) {
			// Wait for initialization with timeout
			const startTime = Date.now();
			while (this.initializing && Date.now() - startTime < 10000) {
				await new Promise(r => setTimeout(r, 100));
			}
			if (this.initializing) {
				throw new Error('IPFS Worker initialization timeout');
			}
			return;
		}

		this.init();
		await this._sendMessage('INIT_HELIA');
		this.initialized = true;
		console.log('IPFS Worker Manager: Initialized');
	}

	async ensureIndexFile(ipfsRootCid) {
		await this.ensureInitialized();
		this.ipfsRootCid = ipfsRootCid;
		const result = await this._sendMessage('ENSURE_INDEX', { ipfsRootCid });
		if (result.cid && result.cid !== this.ipfsRootCid) {
			this.ipfsRootCid = result.cid;
			if (this.updateIpfsRootCidCallback) {
				this.updateIpfsRootCidCallback(result.cid);
			}
		}
		return result.cid;
	}

	async uploadNote(note, ipfsRootCid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('UPLOAD_NOTE', { note, ipfsRootCid });
		if (result.newRootCid && result.newRootCid !== this.ipfsRootCid) {
			this.ipfsRootCid = result.newRootCid;
			if (this.updateIpfsRootCidCallback) {
				this.updateIpfsRootCidCallback(result.newRootCid);
			}
		}
		return result;
	}

	async downloadNote(cid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('DOWNLOAD_NOTE', { cid });
		return result.note;
	}

	async listNotes(ipfsRootCid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('LIST_NOTES', { ipfsRootCid });
		return result.notes;
	}

	async deleteNote(noteId, ipfsRootCid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('DELETE_NOTE', { noteId, ipfsRootCid });
		if (result.newRootCid && result.newRootCid !== this.ipfsRootCid) {
			this.ipfsRootCid = result.newRootCid;
			if (this.updateIpfsRootCidCallback) {
				this.updateIpfsRootCidCallback(result.newRootCid);
			}
		}
		return result;
	}

	async updateDeletedNotes(deletedIds, ipfsRootCid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('UPDATE_DELETED_NOTES', { deletedIds, ipfsRootCid });
		if (result.newRootCid && result.newRootCid !== this.ipfsRootCid) {
			this.ipfsRootCid = result.newRootCid;
			if (this.updateIpfsRootCidCallback) {
				this.updateIpfsRootCidCallback(result.newRootCid);
			}
		}
		return result;
	}

	async getDeletedNotes(ipfsRootCid) {
		await this.ensureInitialized();
		const result = await this._sendMessage('GET_DELETED_NOTES', { ipfsRootCid });
		return result;
	}

	setUpdateIpfsRootCidCallback(callback) {
		this.updateIpfsRootCidCallback = callback;
	}

	getCurrentRootCid() {
		return this.ipfsRootCid;
	}

	isReady() {
		return this.initialized && !!this.worker;
	}

	getStatus() {
		if (!this.worker) return 'not-initialized';
		if (this.initializing) return 'initializing';
		if (this.initialized) return 'ready';
		return 'error';
	}

	// Health check - can be used to detect and recover from worker failures
	async healthCheck() {
		if (!this.worker) return false;
		try {
			// Send a simple ping message
			const timeout = new Promise((_, reject) => 
				setTimeout(() => reject(new Error('Health check timeout')), 5000)
			);
			const healthPromise = new Promise((resolve) => {
				const handler = (event) => {
					if (event.data.type === 'HEALTH_CHECK_COMPLETE') {
						this.worker.removeEventListener('message', handler);
						resolve(true);
					}
				};
				this.worker.addEventListener('message', handler);
				this.worker.postMessage({ type: 'HEALTH_CHECK' });
			});
			return await Promise.race([healthPromise, timeout]);
		} catch {
			return false;
		}
	}

	// Attempt to recover from worker failures
	async recover() {
		console.log('IPFS Worker Manager: Attempting recovery...');
		this.terminate();
		this.initialized = false;
		this.initializing = false;
		this.pendingRequests.clear();
		await this.ensureInitialized();
		console.log('IPFS Worker Manager: Recovery complete');
	}

	terminate() {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
			this.initialized = false;
			this.initializing = false;
			this.pendingRequests.clear();
			console.log('IPFS Worker Manager: Terminated');
		}
	}
}

// Create singleton instance
const ipfsWorkerManager = new IPFSWorkerManager();

// Export to window for backward compatibility
if (typeof window !== 'undefined') {
	window.ipfsWorkerManager = ipfsWorkerManager;
	
	// Clean up worker on page unload
	window.addEventListener('beforeunload', () => {
		ipfsWorkerManager.terminate();
	});
}
