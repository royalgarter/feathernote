# Shared Inbox: split + hostname tag

## Hostname tag on share
- Each shared inbox line gets an inline tag: `- [ ] [Title](url) #youtube.com`.
- Redirects are followed server-side via `GET /api/resolve-url?url=` (browser cannot see cross-origin redirects).
  Falls back to the original URL when the server is unavailable (static hosting / offline), 4s timeout.
- Root hostname = registrable domain heuristic (`getRootHostname` in `helpers.js`): last 2 labels,
  or 3 for `co.uk`-style country second-level domains. Not the full Public Suffix List.

## Split button
- "Split into notes" button under the title, visible only on the Shared Inbox.
- Each task line (`- [ ]` / `- [x]`) becomes a note: title = link text (or line text), content = the line,
  tags = `shared` + inline `#tags`. Task lines are removed from the inbox; other lines stay.

## Known caveat
- Inbox sync is a line union (`mergeSharedInboxContent`). If another device holds an unsynced
  copy, split-out lines can reappear after the next merge.
