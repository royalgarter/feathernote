# Audit fixes: a11y, motion, list perf, offline deps, lazy providers

1. **Labels**: icon-only controls get `aria-label`; clickable `div`/`span` get `role="button"`, `tabindex="0"`, Enter/Space handlers (note card, tags, suggestions, user profile).
2. **Reduced motion**: `index.css` `prefers-reduced-motion` block (no global kill): drops the lock-overlay fade and smooth scroll.
3. **List perf**: `getNoteSyncStatusByProvider` called once per card via `x-for` over its entries; tags filtered once when notes load (`note.tags` is already filtered in the template with `.filter(x=>x)` per render).
4. **Offline deps**: Alpine, Readability, MiniSearch, nostr-tools, tailwind-lite, Font Awesome 4.7 vendored in `src/libs/` at pinned versions; SW precache points at local copies.
5. **Lazy providers**: `ensureGit()` / `ensureGDrive()` in `helpers.js` load git libs and `gdrive.js` on first use (provider enabled or Connect clicked). The service worker keeps importing them.
