# Development Workflow

-   **Plan First:** Before implementing, draft a plan in `docs/<feature_name>.md`.
-   **Iterate:** Implement changes step-by-step. Avoid large, sweeping modifications.
-   **Preserve Code:** When removing code, comment it out with a `DEPRECATED` notice instead of deleting it outright.

# Core Principles

-   **Simplicity & Readability:** Write simple, straightforward, and easy-to-understand code.
-   **Performance:** Consider performance without sacrificing readability.
-   **Maintainability & Testability:** Write code that is easy to update and test.
-   **Reusability:** Create reusable components and functions.
-   **Minimalism:** Less code is less debt. Keep the footprint small.
-   **Clarification & Specificity:** Ask for more details and provide open-ended suggestions if the request is ambiguous.

# Best Practices

-   **Vanilla JavaScript First:** Avoid introducing new frameworks (e.g., React, Vue) or large libraries (e.g., jQuery).
-   **Leverage Alpine.js:** Use the existing `mainApp` data object for UI logic and state.
-   **Global Scope Awareness:** All JavaScript is loaded via `<script>` tags; be mindful of the global scope.
-   **Functional Style:** Prefer functional, immutable, and stateless approaches where they improve clarity.
-   **Early Returns:** Use early returns to avoid nested conditions.
-   **Descriptive Naming:** Use clear names for variables and functions (e.g., `handle` prefix for handlers).
-   **Constants:** Use constants instead of functions where possible.
-   **DRY (Don't Repeat Yourself):** Avoid code duplication.
-   **Minimal Changes:** Only modify code relevant to the current task.
-   **TODOs:** Mark issues in existing code with a `TODO:` prefix.
-   **Clean Logic:** Keep core logic clean and push implementation details to the edges.

# Formatting

-   **Indentation:** Use tabs.
-   **Semicolons:** Always use semicolons.
-   **Braces:** Use One True Brace Style (1TBS).

# Naming Conventions

-   **camelCase:** For variables and functions (e.g., `noteEditorVisible`, `fetchNotes`).
-   **UPPER_SNAKE_CASE:** For constants and globals (e.g., `DB_NAME`, `NOTE_STORE`).
-   **\_prefix:** Consider for internal/private functions (e.g., `_doSomethingInternal`).

---

# Repository Architecture — FeatherNote

## Overview

FeatherNote is an offline-first Progressive Web App (PWA) for note-taking with Markdown, multi-provider sync, and optional encryption. It runs entirely in the browser with an optional Node.js server for publishing and share-target support.

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | Alpine.js (`src/index.js` — `mainApp` data object) |
| Styling | Tailwind CSS (utility classes in `src/index.html`) |
| Markdown Editor | EasyMDE (loaded via `<script>`) |
| Local Database | IndexedDB (wrapped in `src/helpers.js`) |
| Encryption | Web Crypto API (AES-GCM, PBKDF2) |
| Search | MiniSearch (client-side full-text search) |
| Server | Express 5 (`src/server.js`) |
| Sync Providers | S3, Google Drive, Git (isomorphic-git), Nostr, IPFS |

## Directory Layout

```
/
├── src/                    # Application source (all client + server code)
│   ├── index.html          # Single-page app shell (Alpine.js templates)
│   ├── index.js            # Alpine.js mainApp data object (UI state + logic)
│   ├── index.css           # Styles (Tailwind-based)
│   ├── helpers.js          # Core utilities: YAML, crypto, IndexedDB, sync orchestration
│   ├── server.js           # Express server (publishing, share target, /api/*)
│   ├── s3.js               # S3 sync provider (upload, download, list, delete)
│   ├── gdrive.js           # Google Drive sync provider
│   ├── git.js              # Git sync provider (isomorphic-git)
│   ├── ipfs.js             # IPFS sync provider (Pinata + direct Helia)
│   ├── nostr.js            # Nostr sync provider (NIP-04 encrypted kind 4 events)
│   ├── ipfs-worker.js      # Web Worker for IPFS operations
│   ├── ipfs-worker-manager.js # Manager for IPFS web worker
│   ├── serviceworker.js    # Service worker (caching, offline, periodic sync)
│   ├── manifest.json       # PWA manifest
│   ├── self-decrypting.html # Standalone encrypted note page
│   ├── libs/               # Vendored third-party libraries
│   │   ├── aws-sdk-2.1692.0.min.js
│   │   ├── js-yaml.min.js
│   │   ├── isomorphic-git.min.js
│   │   ├── lightning-fs.min.js
│   │   ├── diff_match_patch.js
│   │   └── http.min.js
│   ├── icons/              # App icons (multiple sizes)
│   └── published_notes/    # Server-side rendered published notes
├── docs/                   # Feature plans, design docs, reference material
├── .github/workflows/      # CI/CD workflows
└── apphosting.yaml         # Firebase App Hosting config
```

## Core Architecture

### 1. Single-Page App with Alpine.js

All UI logic lives in `src/index.js` inside the `Alpine.data('mainApp', ...)` registration. The `mainApp` object holds:

- **App state** — dark mode, version, lock status, sync settings
- **Note CRUD** — `addNote()`, `updateNote()`, `deleteNote()`, `fetchNotes()`
- **Editor state** — EasyMDE instance management, autosave, merge conflict handling
- **Sync orchestration** — `syncNotes()` coordinates multi-provider sync
- **Auth** — Google Identity Services (One Tap sign-in)
- **Notifications** — local `setTimeout` + optional Firebase Cloud Messaging
- **Search** — MiniSearch for fuzzy full-text search across notes

### 2. Local-First Data Layer

Notes are persisted in **IndexedDB** (`FeatherNoteDB`, stores: `notes`, `s3-credentials`, `images`, `shared-content`, `meta`). The wrapper in `src/helpers.js` provides promise-based CRUD:

- `getNotesDB()`, `getNoteDB(id)`, `addNoteDB(note)`, `updateNoteDB(note)`, `deleteNoteDB(id)`

A YAML cache in `localStorage` (`feathernote-notes-cache`) provides instant startup loads.

### 3. Multi-Provider Sync Engine

The `synchronize()` function in `src/helpers.js` is the heart of the sync system. It follows a **fetch-then-compare, last-write-wins** strategy:

1. **List remote state** — queries all enabled providers in parallel (S3, GDrive, Git, Nostr, IPFS)
2. **Determine uploads** — local notes newer than any remote version are uploaded
3. **Determine downloads** — remote notes newer than local are downloaded
4. **Handle deletions** — a shared `deleted-notes` queue tracks deletions across providers
5. **Execute** — uploads run in parallel; IPFS operations yield between steps to avoid UI blocking

Each provider (`src/s3.js`, `src/gdrive.js`, `src/git.js`, `src/nostr.js`, `src/ipfs.js`) exposes a consistent interface: `list`, `upload`, `download`, `delete`.

### 4. Encryption & Security

- **Settings encryption**: S3/Nostr credentials are encrypted with AES-GCM (PBKDF2 key derivation from user ID) before storage in IndexedDB and localStorage.
- **Note-level encryption**: Optional per-note password encryption using Web Crypto API. Encrypted notes show `**********` in previews.
- **Biometric lock**: WebAuthn API for device-level authentication (register/authenticate).

### 5. Server (`src/server.js`)

Minimal Express 5 server providing:
- Static file serving for `src/`
- `/api/version` — returns app version hash
- `/share` — PWA Share Target handler
- `/publish` — server-side Markdown-to-HTML rendering (optional, for Deno KV or Cloudflare KV)
- Google Calendar integration endpoint

### 6. Service Worker (`src/serviceworker.js`)

Handles:
- Static asset caching (offline-first)
- Periodic background sync (12-hour interval)
- Push notification delivery
- Share target reception

## Key Patterns

### Global Namespace

All JS files attach to `_GLOBAL` (which resolves to `window` in browser, `self` in workers). Functions like `uploadNoteToS3`, `publishNoteToRelays`, etc. are set on `_GLOBAL` for cross-module access. This is by design — no bundler, no modules.

### Data Flow

```
User Action → Alpine.js handler → IndexedDB (local) → syncNotes() → Providers (S3/GDrive/Git/Nostr/IPFS)
                                                                         ↓
User Action ← Alpine.js state  ← IndexedDB (local) ← mergeRemoteNote() ← Remote response
```

### Sync Status Tracking

Each note has a per-provider sync status (`noteSyncStatus[note.id]`) with states: `ok`, `syncing`, `partial`, `error`, `idle`. The UI displays these as colored icons.

### Merge Conflict Resolution

When editing a note that gets updated remotely, a **3-way merge** is attempted using `diff_match_patch`:
- Base = content when editor opened
- Local = current editor content
- Remote = newly downloaded content
- Patch from base→local is applied to remote

## Development Guidelines

### When Adding a New Sync Provider

1. Create `src/<provider>.js` exposing `listNotes`, `uploadNote`, `downloadNote`, `deleteNote` (attach to `_GLOBAL`)
2. Register in `helpers.js` → `listNotes()`, `uploadNote()`, `deleteNoteFromRemotes()`
3. Add credential fields to the encrypted settings schema
4. Add UI toggle in the settings panel (`index.html`)
5. Add provider icon/name to `getProviderIcon()` and `getProviderName()` in `index.js`

### When Adding a New Feature

1. Draft a plan in `docs/<feature_name>.md`
2. Add state properties to the `mainApp` data object in `index.js`
3. Keep UI logic in `index.js`, utility/helper functions in `helpers.js`
4. Use `localStorage` for persistent user preferences (prefix: `feathernote-`)
5. Use IndexedDB for structured data (notes, images, credentials)

### Performance Considerations

- IPFS operations run in a Web Worker to avoid blocking the main thread
- IPFS uploads/downloads yield (`setTimeout(resolve, 0)`) between each note to keep the UI responsive
- Non-IPFS provider operations run in parallel via `Promise.allSettled()`
- MiniSearch indexing is deferred via `setTimeout` after note fetch
- YAML cache limits to 12 most recent notes for fast startup
- Sync skips when a state hash matches the previous hash (no changes detected)
