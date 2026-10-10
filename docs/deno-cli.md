# Deno CLI for FeatherNote

## Goal
A simple binary Deno CLI that:
- Uses the same encrypted settings export from the PWA (the `s3-credentials` blob: `{salt, iv, content}` JSON string)
- Stores notes as Markdown files on disk (`~/.feathernote/notes/`)
- Opens `$EDITOR` to edit note content
- Syncs to S3 using the same credentials/decryption flow as the PWA

## Acceptance Criteria
1. `feathernote init` — decrypts settings from the exported string (passed via env var `FEATHERNOTE_SETTINGS` or `settings.json`), writes decrypted creds to `~/.feathernote/credentials.json` (plain, since CLI is local).
2. `feathernote list` — lists notes from local disk + S3 (if configured), shows title, id, updatedAt, source.
3. `feathernote new [title]` — creates a new note (generates id with same `generateUniqueId` logic), opens `$EDITOR` on a temp markdown file, saves to `~/.feathernote/notes/<id>.md` after editor exits.
4. `feathernote edit <id>` — opens `$EDITOR` on the existing note file, saves back if changed.
5. `feathernote sync` — uploads local notes newer than S3, downloads remote notes newer than local (same LWW logic as PWA).
6. `feathernote delete <id>` — deletes local file + removes from S3.

## Note file format (Markdown with YAML frontmatter, matching Git provider)
```
---
id: <note-id>
title: <title>
updatedAt: 2026-01-01T00:00:00.000Z
createdAt: 2026-01-01T00:00:00.000Z
tags: [tag1, tag2]
---
<markdown content>
```

## Settings decryption
Reuse the exact `decryptSettings` flow from `src/helpers.js`:
- Parse the exported JSON string: `{ salt, iv, content }` (all base64)
- Derive AES-GCM key via PBKDF2 from userId (default `anonymous`) + salt
- Decrypt `content`, parse JSON → credentials object
- CLI stores decrypted creds locally in `~/.feathernote/credentials.json`

## Dependencies
- `yaml` npm package for YAML parse/stringify (same as PWA's js-yaml)
- Deno std lib for FS, path, env
- AWS SDK v3 (`@aws-sdk/client-s3`) for S3 operations (deno-compatible via npm:)

## Out of scope for v1
- Nostr, IPFS, GDrive, Git sync (S3 only)
- Encryption of individual notes
- Search/miniSearch
- Image sync
