# Auto host tags on save

On manual save (`saveNote`), every link in the note content adds its root hostname as a tag
(`https://www.github.com/x` → `github.com`, `news.bbc.co.uk` → `bbc.co.uk`).

- Helpers: `getContentHostTags`, `appendContentHostTags` in `helpers.js` (reuse `getRootHostname`).
- Read from plaintext before encryption; existing tags kept, duplicates skipped case-insensitively.
- Skipped: image embeds `![](url)`, the Shared Inbox (lines carry inline `#host` tags).
- No redirect lookup: hostname as written, so save stays instant and offline-safe.
- Tags only added, never removed when a link is deleted.
