# P0 Share Fixes

From the share-view and share-target audits (`.impeccable/audit/`).

## 1. Stored XSS on `/publish/:noteId`

`POST /publish` is unauthenticated and `GET /publish/:id` rendered `note.title` and raw `marked` output on the app origin.

- Escape the title everywhere it is interpolated (HTML page + self-decrypting template).
- Render Markdown with a marked renderer that escapes raw HTML blocks/inline HTML and drops `javascript:`/`data:`/`vbscript:` link and image URLs.
- No new dependency.

## 2. Share target reports "Saved" on failure

`handleShareTarget` swallowed errors and still rendered "Saved to Shared Inbox".

- Track `saveError`; on failure render an error state that shows the shared text/URL with a **Copy** button so nothing is lost.
- Image shares say "Saved as new note" instead of "Saved to Shared Inbox".

## 3. Shared Inbox loses items across devices

Sync is last-write-wins per note; the inbox is prepended on every device, so concurrent shares overwrite each other.

- `mergeSharedInboxContent(local, remote)`: line-level union. Remote order kept, local-only lines prepended (newest first). Checkbox state normalised for the key; checked wins.
- Track `shared_inbox_synced_at` (meta store) = remote `updatedAt` last merged.
- In `synchronize()`: if the inbox's remote `updatedAt` differs from both local and `shared_inbox_synced_at`, the remote changed since our last merge → don't upload; download, merge, stamp `updatedAt = now` if content changed. The next sync then uploads the merged note through normal LWW.

Trade-off: a line deleted on device A while device B still has it can reappear after merge. Re-appearing is preferred over silent loss.

## 4. Exact `#tag` filter + pinned Shared Inbox

- Search query made only of `#tag` tokens filters by exact (case-insensitive) tag match, ANDed; any other query keeps the MiniSearch fuzzy search.
- Clicking a tag chip on a card sets `#tag`.
- `filteredNotes` moves the Shared Inbox to the front of the list (also when filtering).
