# IPFS Sync Implementation Plan

This document outlines the plan to add IPFS as an optional synchronization provider for FeatherNote, using the **Pinata API** for pinning and management.

## 1. Goal
Provide users with a decentralized storage option by allowing them to sync their notes to IPFS. We will use Pinata as the primary interface due to its robust REST API and support for custom metadata, which is essential for our sync logic.

## 2. Technical Approach

### A. IPFS Module (`src/ipfs.js`)
Create a new module to encapsulate all IPFS operations:
- **Authentication**: Support both Pinata JWT (recommended) and API Key/Secret pairs.
- **`uploadNoteToIPFS(note, creds)`**: Use Pinata's `/pinning/pinJSONToIPFS` endpoint.
    - Store the note object as the CID content.
    - Attach metadata (keyvalues): `noteId`, `updatedAt`, `app: feathernote`, `type: note`.
- **`listNotesInIPFS(creds)`**: Use Pinata's `/data/pinList` endpoint.
    - Filter by `status=pinned` and metadata `app=feathernote` and `type=note`.
    - Return a list of metadata (ID, CID, updatedAt).
- **`downloadNoteFromIPFS(noteMeta, creds)`**: Fetch the JSON content from an IPFS gateway (defaulting to Pinata's or a public one).
- **`deleteNoteFromIPFS(noteId, creds)`**: Find all CIDs associated with the `noteId` via metadata and call `/pinning/unpin/[CID]`.
- **`syncDeletedNoteIds` support**: Implement `uploadDeletedNotesToIPFS` and `downloadDeletedNotesFromIPFS` using a specific metadata type (`type: deleted-notes`).

### B. Integration (`src/helpers.js`)
Update the central synchronization logic:
- **`listNotes`**: Add a call to `listNotesInIPFS` and merge the results into the `mergedNotes` map.
- **`synchronize`**: Handle IPFS credentials and pass them down the chain.
- **`uploadNote`**: Include IPFS in the parallel upload process.
- **`deleteNoteFromRemotes`**: Add a call to `deleteNoteFromIPFS`.
- **`syncDeletedNoteIds`**: Include IPFS in the deleted IDs reconciliation.

### C. UI & State (`src/index.html`, `src/index.js`)
- **Settings Dialog**: Add a new "IPFS Sync (Pinata)" section:
    - Pinata JWT (Primary)
    - API Key & Secret (Fallback)
    - Custom IPFS Gateway URL (Optional)
- **Main App State**:
    - Add `ipfsSettings` to track connection status.
    - Update `loadSettingsFromStorage` and `saveSettings` to include IPFS credentials (encrypted via Web Crypto).

## 3. Data Model
Notes on IPFS will be pinned as JSON.
Metadata is CRITICAL for discovery since IPFS is content-addressed and doesn't have a native "directory listing" for a user's account without a service like Pinata.

**Pinata Metadata Example:**
```json
{
  "name": "feathernote-note-12345",
  "keyvalues": {
    "noteId": "12345",
    "updatedAt": "2026-03-08T12:00:00Z",
    "app": "feathernote",
    "type": "note"
  }
}
```

## 4. Security
- **Credential Protection**: Like S3 and Git credentials, Pinata keys will be encrypted using the user's master key (derived from Google ID or local salt) before being stored in IndexedDB.
- **Privacy**: Notes are stored as-is (JSON). Users concerned about IPFS being public should be aware that anyone with the CID can read the note if they discover it, although Pinata listing is private to the API key holder.

## 5. Implementation Steps
1.  **Create `src/ipfs.js`** with core API functions.
2.  **Update `src/index.html`** to add the Settings UI.
3.  **Update `src/index.js`** to handle IPFS state and settings.
4.  **Update `src/helpers.js`** to wire IPFS into the `synchronize` flow.
5.  **Verify** by syncing a note to IPFS and checking the Pinata dashboard.
