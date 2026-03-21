# Implementation Plan: Offline-First Direct IPFS (Helia)

This plan outlines the implementation of a direct, client-side IPFS node within FeatherNote using **Helia**. The focus is on a lightweight, serverless, and offline-first synchronization strategy.

## 1. Goal
Enable true decentralized synchronization by running an IPFS node directly in the browser. This eliminates the need for third-party services like Pinata or self-hosted RPC endpoints, allowing the app to function entirely offline and sync when a connection is available.

## 2. Technical Stack
- **Helia**: A modular, lightweight IPFS implementation for JS.
- **Blockstore-IDB / Datastore-IDB**: To persist IPFS data in the browser's IndexedDB.
- **Helia JSON**: For efficient handling of note objects as IPFS blocks.
- **libp2p**: Configured with WebRTC and WebSockets for browser-to-browser and browser-to-node connectivity.
- **Web Workers**: To run Helia operations in a background thread, preventing UI blocking.

## 3. Core Logic: The "Index File" Approach
Instead of relying on an external metadata API, the app will maintain a local IPFS state:
1.  **Local Index (`.feathernote.json`)**: A JSON file containing:
    - Map of `noteId` -> `noteCid`
    - `updatedAt` timestamp
    - `deletedNoteIds` list
2.  **Root CID**: The CID of the latest version of this index file.
3.  **Persistence**: The Root CID is stored in the app's encrypted settings. When the settings sync (via S3, Git, etc.), other devices receive the Root CID and can "pull" the data from the IPFS network.

## 4. Offline-First Strategy
- **Local Cache**: IPFS blocks are stored in IndexedDB. Adding a note to IPFS while offline will still generate a valid CID and update the local index.
- **Deferred Syncing**: When the app regains connectivity, the Helia node will:
    - Connect to bootstrap nodes/relays.
    - Announce the Root CID to the network.
    - Fetch any missing blocks required by a newer Root CID received from settings.

## 5. Implementation Status

### A. IPFS Module (`src/ipfs.js`) ✅ Implemented (Non-Blocking Main Thread)
- **Non-Blocking Operations**: All Helia operations use async/await with strategic `setTimeout(0)` yields to prevent UI blocking.
- **Initialization**: `initHelia()` - Starts Helia with IndexedDB persistence using `IDBBlockstore` and `IDBDatastore`. Includes deduplication to prevent concurrent init.
- **Index Management**: `ensureIndexFile()` - Auto-creates `.feathernote.json` index file on app startup.
- **`uploadNoteToIPFS(note, creds, timeoutMs)`**:
    - Convert note to JSON block → get `noteCid`.
    - Update the local Index file → get `newRootCid`.
    - Persist `newRootCid` to app settings via callback.
    - Timeout: 30 seconds default, falls back to Pinata on error.
- **`downloadNoteFromIPFS(noteMeta, creds, timeoutMs)`**: Retrieve with AbortController timeout.
- **`listNotesInIPFS(creds, timeoutMs)`**: List all notes from local index with timeout.
- **`deleteNoteFromIPFS(noteId, creds, timeoutMs)`**: Remove note from index and update Root CID.
- **`downloadDeletedNotesFromIPFS(creds, timeoutMs)`** / **`uploadDeletedNotesToIPFS(deletedIds, creds, timeoutMs)`**: Handle soft-deleted notes tracking.
- **Status**: `window.getIPFSStatus()` returns `{ initialized, initializing, hasRootCid, rootCid }`.

**Module Load Order:**
1. `ipfs.js` loads first, exports functions to `window`
2. `index.js` initializes `window.updateIpfsRootCid` callback
3. Settings are loaded from encrypted IndexedDB
4. `ensureIndexFile()` is called automatically if Direct IPFS is enabled

**Non-Blocking Pattern:**
```javascript
// Before heavy operation, yield to UI thread
await new Promise(resolve => setTimeout(resolve, 0));

// Then perform the operation
const result = await heliaJson.add(data);
```

### B. UI & Settings (`src/index.html`, `src/index.js`) ✅ Implemented
- **Toggle**: "Enable Direct IPFS Node" checkbox in settings.
- **Root CID Display**: Read-only field showing the current state's hash (auto-populated).
- **Auto-Initialization**: Helia node starts automatically after settings load when Direct IPFS is enabled.
- **Settings Persistence**: Root CID is saved to encrypted settings and synced across devices.

### C. Integration (`src/helpers.js`) ✅ Implemented
- **Sync Flow**: The `synchronize()` function checks the local Helia node for updates when Direct IPFS is enabled.
- **Conflict Resolution**: Uses the `updatedAt` field within the `.feathernote.json` index to determine the latest global state.
- **Hybrid Support**: Falls back to Pinata gateway if Direct IPFS fails or is disabled.

## 6. Connectivity Requirements
Since browsers cannot accept direct incoming connections, we will use:
- **Public Gateways**: To fetch the index if no direct peers are found.
- **Circuit Relays**: To allow browser nodes to talk to each other through a middleman.
- **WST (Websocket-Star)** or **WebRTC-Star**: For peer discovery.

## 7. Verification Plan
1.  **Offline Add**: Disable network, add a note, and verify it exists in the local IPFS blockstore (via CID).
2.  **Local Peer Sync**: Open two different browsers on the same machine and verify they can sync notes via the local node.
3.  **Persistence**: Refresh the page and ensure the Helia node recovers its previous state from IndexedDB.

## 8. Recent Updates (March 2026)

### Non-Blocking Main Thread Operations (Performance Optimization)
- **Problem**: Running Helia in the main thread caused UI blocking and high resource consumption during sync operations. Web Workers were attempted but cannot load ES modules from CDN URLs.
- **Solution**: Implemented non-blocking operations using sequential processing with strategic `setTimeout(0)` yields and comprehensive timeouts.

**Implementation Details:**
- **Initialization Deduplication**: `initPromise` prevents concurrent initialization attempts
- **Sequential IPFS Processing**: Upload and download operations process one at a time with yields between each
- **Operation Separation**: IPFS operations separated from faster operations (S3, Git, Nostr)
- **Strategic Yielding**: `setTimeout(0)` calls between heavy operations allow UI thread to process events
- **Comprehensive Timeouts**: All operations have configurable timeouts (default 30s for uploads/downloads, 15s for list/delete)
- **AbortController**: Network requests use AbortController for proper cancellation
- **Status Method**: `window.getIPFSStatus()` returns initialization state

**Sync Flow:**
```
1. Non-IPFS uploads (parallel - fast)
2. Yield to UI thread
3. IPFS uploads (sequential with yields)
4. Deletes (parallel - fast)
5. Non-IPFS downloads (parallel)
6. Yield to UI thread  
7. IPFS downloads (sequential with yields)
```

**Benefits:**
- ✅ Non-blocking UI during IPFS operations (yields to main thread)
- ✅ All operations timeout properly (no hanging syncs)
- ✅ Proper error handling with fallback to Pinata
- ✅ No Web Worker complexity (CDN modules work correctly)
- ✅ Request deduplication prevents race conditions
- ✅ Sequential processing prevents resource exhaustion

### Other Updates
- Fixed module imports: Changed from `indexedDBBlockstore`/`indexedDBDatastore` to `IDBBlockstore`/`IDBDatastore` (blockstore-idb@2.0.1 API change).
- Added automatic `.feathernote.json` index file creation on app startup.
- Implemented proper load order to ensure settings are loaded before IPFS initialization.
- Root CID is now automatically persisted to encrypted settings when updated.
