# Implementation Plan: Offline-First Direct IPFS (Helia)

This plan outlines the implementation of a direct, client-side IPFS node within FeatherNote using **Helia**. The focus is on a lightweight, serverless, and offline-first synchronization strategy.

## 1. Goal
Enable true decentralized synchronization by running an IPFS node directly in the browser. This eliminates the need for third-party services like Pinata or self-hosted RPC endpoints, allowing the app to function entirely offline and sync when a connection is available.

## 2. Technical Stack
- **Helia**: A modular, lightweight IPFS implementation for JS.
- **Blockstore-IDB / Datastore-IDB**: To persist IPFS data in the browser's IndexedDB.
- **Helia JSON**: For efficient handling of note objects as IPFS blocks.
- **libp2p**: Configured with WebRTC and WebSockets for browser-to-browser and browser-to-node connectivity.

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

## 5. Proposed Changes

### A. IPFS Module (`src/ipfs.js`)
- **Initialization**: Logic to start Helia with IndexedDB persistence.
- **`addNoteToHelia(note)`**: 
    - Convert note to JSON block -> get `noteCid`.
    - Update the local Index file -> get `newRootCid`.
    - Persist `newRootCid` to app settings.
- **`getNoteFromHelia(noteCid)`**: Retrieve and parse JSON from the IPFS network/local cache.
- **`syncIndex(remoteRootCid)`**: 
    - Fetch the remote index.
    - Compare with local index.
    - Download missing note CIDs.

### B. UI & Settings (`src/index.html`, `src/index.js`)
- **Toggle**: "Enable Direct IPFS Node".
- **Status Indicator**: Show if the node is starting, online (connected to peers), or offline.
- **Root CID Display**: Read-only field showing the current state's hash.

### C. Integration (`src/helpers.js`)
- **Sync Flow**: Modify the `synchronize` function to check the local Helia node for updates if enabled.
- **Conflict Resolution**: Use the `updatedAt` field within the `.feathernote.json` index to determine the latest global state.

## 6. Connectivity Requirements
Since browsers cannot accept direct incoming connections, we will use:
- **Public Gateways**: To fetch the index if no direct peers are found.
- **Circuit Relays**: To allow browser nodes to talk to each other through a middleman.
- **WST (Websocket-Star)** or **WebRTC-Star**: For peer discovery.

## 7. Verification Plan
1.  **Offline Add**: Disable network, add a note, and verify it exists in the local IPFS blockstore (via CID).
2.  **Local Peer Sync**: Open two different browsers on the same machine and verify they can sync notes via the local node.
3.  **Persistence**: Refresh the page and ensure the Helia node recovers its previous state from IndexedDB.
