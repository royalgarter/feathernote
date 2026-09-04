# Sync Status Speed — First-Open Optimization Plan

## Goal

On first open of the PWA, sync latest notes ASAP and show per-provider sync status progressively, without janking the initial render.

## Checklist

### P1 — Start first sync sooner without jank

- [x] **P1a. Replace fixed 3s delay with idle-priority kickoff**
  - Location: `src/index.js:324-326`
  - Problem: First sync waits a hard-coded `setTimeout(..., 3e3)`.
  - Fix: Use `requestIdleCallback` when available (runs only when browser is idle, so first paint/typing still win), with a 1.5s fallback timeout so it can't be starved.
  - Add a **once** guard so the 60s interval and the idle kickoff don't double-fire on load.

### P2 — Progressive per-provider sync status

- [x] **P2a. Add `onProgress` callback to `synchronize()`**
  - Location: `src/helpers.js:481` (`synchronize`)
  - Fix: Accept optional `onProgress` callback; invoke it at phase boundaries:
    - `{ type: 'list-done', providers }` — after `listNotes` returns, with which providers succeeded/failed
    - `{ type: 'uploaded', noteIds }` — after upload batch
    - `{ type: 'downloaded', noteIds }` — after downloads
  - These are `await` points already, so the callback runs between async turns (non-blocking).
  - **Extra:** `listNotes` now also fires `{ type: 'provider-listed', provider }` as each provider's list settles (via a `.then/.catch` wrapper), giving true per-provider lighting before all lists finish.

- [x] **P2b. Wire `onProgress` in `syncNotes` to update `noteSyncStatus` live**
  - Location: `src/index.js` `syncNotes`
  - Fix: Pass a callback that:
    - On `provider-listed`: mark that provider `ok` for local notes (progressive, as each provider completes).
    - On `list-done`: confirm all succeeded providers `ok`.
    - On `uploaded`/`downloaded`: mark specific notes `ok`.
  - Added `syncProviders()` + `_providerStatusFor()` helper methods; `markProviderStatus()` normalizes per-note status to a per-provider map.
  - **Perf-guard:** `markProviderStatus()` only targets notes currently on screen (`paginatedNotes`) and skips providers already at status — avoids churn that slowed interaction. (Original `markProvider` hit ALL notes every event.)

### P3 — Faster full sync

- [x] **P3a. Lower provider list timeout**
  - Location: `src/helpers.js:43` (`promiseTimeout` default 30s)
  - Fix: Reduce default list timeout from 30s to 20s. A slow/failed provider is already handled gracefully via `failedProviders` (skipped, not fatal). Shorter timeout = status icons update faster on first open. Download/upload calls pass explicit `30000` so payload transfer keeps headroom.
  - Also speeds image-sync listing (uses the same default).

- [x] **P3b. Fast providers not blocked by slow ones**
  - Location: `src/helpers.js:966-980`
  - Fix: `promiseTimeout` + per-provider `onProgress` means each provider notifies when IT settles; a slow provider no longer delays faster providers' status icons.

### P4 — Background first-sync without UI jank

- [x] **P4a. Yield between per-note merges**
  - Location: `syncNotes` merge loop
  - Fix: `await new Promise(r => setTimeout(r, 0))` between each `mergeRemoteNote` so many downloads don't starve the event loop.
  - The main-thread Web Worker refactor for sync is explicitly OUT OF SCOPE (large; existing `ipfs-worker` only covers IPFS).

## Verification

- [ ] On open: notes render instantly (unchanged), first sync starts within ~1.5s of idle.
- [ ] Provider status icons light up progressively as each provider lists, not all at once at the end.
- [ ] No double-sync on load (idle kickoff + interval guard).
- [ ] UI stays responsive (60fps) while first sync downloads many notes.
- [ ] Slow/failed provider doesn't block others or delay status.

## Notes / Non-Goals

- Full sync-in-Web-Worker: NOT scheduling (large refactor).
- Image sync ordering unchanged.
- Per-note 3-way merge stays on main thread but yields between notes (P4a).
