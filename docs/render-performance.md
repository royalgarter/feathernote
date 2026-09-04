# Render Performance Optimization Plan

## Goal

Make FeatherNote super blazing fast to render and edit notes, especially long Markdown notes.

## Background

Audit identified key bottlenecks in the rendering pipeline. Optimizations organized in 4 phases, ordered by impact vs. risk. Each checkbox is a concrete, verifiable task.

---

## Checklist

### Phase 1 — Editor Performance (critical for long notes)

- [x] **T1. Debounce `previewRender`**
  - Location: `src/index.js:1765-1785`
  - Problem: Full `marked.parse` + synchronous `hljs.highlight` runs per keystroke when preview active. No throttle.
  - Fix: Add 200ms debounce so preview only re-renders after typing pauses. Cache last result; return cached HTML immediately, re-parse in background on trailing edge.
  - Status: **DONE** — notes > `PREVIEW_DEBOUNCE_THRESHOLD` (5000 chars) return cached HTML and re-render after 200ms pause. Cache invalidated when switching notes.

- [x] **T2. Adaptive editor options for long notes**
  - Location: `src/index.js:1737-1985`
  - Problem: `lineNumbers: true`, `lineWrapping: true`, `previewImagesInEditor: true` all cost more as note grows.
  - Fix: When loading a note into the editor, check content length. For notes above threshold (e.g. >50,000 chars):
    - Turn off `lineNumbers`
    - Turn off `previewImagesInEditor`
  - Status: **DONE (partial)** — `lineNumbers` toggled off via `cm.setOption('lineNumbers', false)` for notes > `EDITOR_LONG_NOTE_THRESHOLD` (50k chars). `previewImagesInEditor` is constructor-only, skipped (debounce covers preview cost).

- [ ] **T3. Defer syntax highlighting**
  - Location: `src/index.js:1723-1735`
  - Problem: `hljs.highlight` runs synchronously on main thread during every preview parse.
  - Fix: Only run highlight for code blocks; defer via `requestIdleCallback`. Low-priority — revisit after T1.
  - Status: **NOT DONE** — deferred; T1 debounce mitigates most cost.

### Phase 2 — Sync & Index Efficiency

- [x] **T4. Incremental MiniSearch updates**
  - Location: `src/index.js:1018-1021`, `1185-1218`
  - Problem: `fetchNotes()` does full `removeAll` + `addAll` rebuild every sync. Deleted notes never removed from index.
  - Fix:
    - On `deleteNote()` call `this.miniSearch?.remove(note.id)`.
    - Track indexed state via `_indexedNoteSig` Map (id → title+content sig). `fetchNotes()` only adds changed notes and removes gone ones — no full rebuild.
  - Status: **DONE**

- [x] **T5. Skip full re-fetch after sync when no remote changes**
  - Location: `src/index.js:1482`
  - Problem: `await this.fetchNotes()` unconditionally runs full DB read + sort + re-index after every sync cycle.
  - Fix: Only call `fetchNotes()` if `result.downloadedNotes` merged successfully or deletions occurred.
  - Status: **DONE** — `fetchNotes()` now runs only when `downloadedCount > 0` or `notesToDeleteLocally.length > 0`.

- [x] **T6. Incremental sync state hash**
  - Location: `src/index.js:1388-1404`
  - Problem: `YAML.stringify` of ALL note content + SHA-256 runs every sync (60s interval) to detect changes.
  - Fix: Drop full `content`/`reminder` from hash — hash only `id`, `updatedAt`, `title`, `tags` (content changes always bump `updatedAt`).
  - Status: **DONE**

### Phase 3 — DOM & Reactivity

- [x] **T7. Cache note preview snippets**
  - Location: `src/index.js:389-395`
  - Problem: `getNotePreview` runs full-content regex `.replace(/(\r?\n)+/g, '\n')` then truncates — regex scans entire note body each render, per card.
  - Fix: Truncate (`substring(0,300)`) FIRST, then clean newlines on the small slice. Cache result on `note._preview`.
  - Status: **DONE**

- [x] **T8. Editor/list toggle uses `x-show` instead of `x-if`**
  - Location: `src/index.html:137,176`
  - Problem: `x-if` tears down entire notes grid DOM and re-mounts editor subtree on every enter/exit of editing. Recreates all 100 cards.
  - Fix: Convert both to `x-show` with `x-cloak`. Preserves DOM node identity, avoids full re-creation. Added `[x-cloak]` CSS rule.
  - Status: **DONE**

### Phase 4 — Images

- [ ] **T9. Immediate blob URL for pasted images**
  - Location: `src/index.js:2003-2034`
  - Problem: Pasted image inserted as full base64 `data:` URL into editor + CodeMirror, then swapped later. Base64 megabytes bloat editor internals and preview rendering temporarily.
  - Fix: Insert a reference placeholder immediately, store blob, then let the normal `/images/<id>` flow resolve it. Avoid inserting base64 into the editor string.
  - Files: `src/index.js`, `src/helpers.js`
  - Status: **NOT DONE** — higher risk, deferred.

- [ ] **T10. Lazy-load preview images**
  - Location: `src/index.css` / `previewRender`
  - Problem: Every `<img>` in preview loads through SW → IndexedDB immediately, blocking decode on the main-thread event loop.
  - Fix: Post-process rendered HTML to add `loading="lazy"` + `decoding="async"` to `<img>` tags in `previewRender`.
  - Files: `src/index.js`
  - Status: **NOT DONE** — deferred.

---

## Verification

- [ ] No console errors introduced.
- [ ] Long note (>100KB) edit: typing stays responsive, preview updates after pause, no main-thread freeze.
- [ ] Short note: editor options restored (lineNumbers, image preview).
- [ ] Search still works after edits/deletes/sync (no stale or missing entries).
- [ ] Sync completes without full list re-render churn when nothing changed.
- [ ] Notes list renders instantly on startup (YAML cache path unaffected).

## Notes / Non-Goals

- No Web Worker for main-thread sync (out of scope; IPFS already yields).
- No markdown streaming/pagin (out of scope).
- Service worker note caching is a separate concern — not addressed here.
