# Live Note Sync While Editing (S3-First, 10s Poll)

## Problem Review

**Goal:** When the same note is open on 2+ devices, keep both nearly up-to-date (≤10s) so a device never autosaves stale content over a newer remote version.

### How it works today

1. **On open** (`editNote()` in `src/index.js`): a **one-time** S3 `headObject` check (`getNoteMetadataFromS3`) downloads the note if remote is newer, then `mergeRemoteNote()` runs (3-way merge via `diff_match_patch` when the user has local edits).
2. **While editing**: `editorAutosaveIntervalId` fires `autosaveCurrentNote()` every **60s** → `updateNote()` → `syncNotes(isSilent, 1, [updatedNote])`, which uploads the edited note to **all** providers.
3. **Downloads while editing**: only happen if a full `syncNotes()` runs (60s idle interval, and only when the state hash changes). There is **no recurring remote check** for the open note.

### The overwrite window

- Device A and B both open the note. A edits and autosaves → remote is now newer.
- B never re-checks after its one-time open check. B's editor still holds stale content.
- B's autosave (up to 60s later) writes that stale content with a **newer `updatedAt`** → last-write-wins discards A's work.

**Worst-case data-loss window today: ~60s (autosave interval).**

## Goals / Non-Goals

**Goals**
- Recurring remote check for the **open note only**, every **10s**.
- Reuse the existing `mergeRemoteNote()` 3-way merge — no new conflict logic.
- **S3-first**: the poll touches S3 only (1 HEAD per tick, 1 GET when changed). Never Git/GDrive/Nostr/IPFS in the loop.

**Non-Goals**
- No CRDT/OT, no websocket/realtime backend.
- No change to the full-sync engine (`synchronize()` in `src/helpers.js`).
- No change to autosave cadence (stays 60s; the 10s poll makes stale content impossible to linger past 10s).

## Design

### Poll loop (download-only)

New `mainApp` method `checkActiveNoteForRemoteUpdate()`:

1. **Guards (early returns):**
	- `liveSyncEnabled` is off → return.
	- No `editingNoteId`, or `noteEditorNoteId` is `null`/`'new'` (unsaved new note) → return.
	- `document.visibilityState !== 'visible'` → return (tab in background).
	- `!navigator.onLine` → return.
	- `this.isSyncing` or a previous tick still in flight (`liveSyncInFlight`) → return.
2. **S3 HEAD** via existing `_GLOBAL.getNoteMetadataFromS3(localNote || id, credentials)` — pass the local note object so the dated key path resolves (same pattern as the existing check in `editNote()`).
	- Credentials: reuse the `getEncryptedSettingsDB()` + `decryptSettings()` flow already used in `editNote()`.
	- If S3 is not configured (`!credentials.secretAccessKey`) or HEAD fails → return silently. **No fallback to other providers** — that's the spam we're avoiding.
3. **Compare:** `new Date(remoteMeta.lastModified) > new Date(localNote.updatedAt)` → else return.
4. **Download:** `_GLOBAL.downloadNoteFromS3(localNote || id, credentials)`.
5. **Merge:** `await this.mergeRemoteNote(remoteNote)` — it already:
	- skips encrypted notes when the password is missing/undecryptable,
	- 3-way merges when the user has edits (base = `noteEditorBaseContent`),
	- refreshes the EasyMDE instance and resets the merge base,
	- bumps local `updatedAt` so the next HEAD comparison is clean.

### Wiring

| Touch point | Change |
|---|---|
| `src/index.js` state | Add `liveSyncIntervalId: null`, `liveSyncInFlight: false`, `liveSyncEnabled` (from `localStorage 'feathernote-live-sync'`, default `true`). |
| `editNote()` | After the existing one-time check, start `liveSyncIntervalId = setInterval(() => this.checkActiveNoteForRemoteUpdate(), 10000)`. Guard against double-start. |
| `cancelEdit()` | `clearInterval(this.liveSyncIntervalId); this.liveSyncIntervalId = null;` (mirrors the existing autosave-interval cleanup). |
| Settings UI (`src/index.html`) | One checkbox in a settings fieldset, `x-model="liveSyncEnabled"`, persisted like `biometricEnabled` (`feathernote-live-sync` in localStorage) — user preference, not a secret, so it does **not** go into the encrypted settings blob. |

### Why this kills the overwrite

- Stale content on device B can now exist for at most **10s** before being merged into B's editor.
- B's autosave always saves **merged** content (merge resets `noteEditorBaseContent`; `autosaveCurrentNote()` also no-ops when content is unchanged), so it can no longer push a stale version.
- Uploads still happen only via autosave/save — the poll never uploads, so two devices editing simultaneously can't ping-pong writes every 10s.

### Cost

- 1 S3 HEAD request per 10s per actively-edited note, only while the tab is visible and the editor is open. Zero requests to Git/GDrive/Nostr/IPFS from this feature.

## Edge Cases

- **Encrypted notes without password in the editor** → `mergeRemoteNote()` already returns `false`; poll stays harmless.
- **Merge vs. autosave race** → both funnel through `updateNoteDB` (put); `autosaveCurrentNote()` returns early while `isSyncing`. Acceptable residual risk; same as today.
- **S3 clock skew** → strict `>` comparison; a tie simply means "no download this tick", retried next tick.
- **Note deleted remotely while open** → HEAD returns `NotFound` → treated like any HEAD failure (skip). Full sync still handles deletion; out of scope here.
- **`updatedAt` in S3 metadata is upload-time** vs. local save-time — comparable, same assumption the existing `editNote()` check already makes.

## Implementation Steps

1. Add `liveSyncEnabled` / `liveSyncIntervalId` / `liveSyncInFlight` state + `LIVE_SYNC_INTERVAL_MS = 10000` constant in `src/index.js`.
2. Add `checkActiveNoteForRemoteUpdate()` to `mainApp` (guards → HEAD → GET → `mergeRemoteNote`).
3. Start the interval in `editNote()`; clear it in `cancelEdit()`.
4. Add the settings checkbox + localStorage persistence.
5. Verify: `node --check src/index.js` (syntax), then manual two-device/tab test: edit on tab A, confirm tab B's editor updates within ~10s without losing B's local edits (3-way merge toast path).

## Future Improvements (out of scope)

- Tighten autosave to 15–30s while editing for faster outbound propagation.
- `updatedAt`/device-id echo in the note payload to make LWW comparisons clock-skew-proof.
- BroadcastChannel to dedupe polls across tabs of the same device.
