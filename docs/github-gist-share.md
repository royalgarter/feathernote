# GitHub Gist Share Feature

## Overview

Add the ability to share a note as a GitHub Gist, with the user choosing between public or private visibility. This integrates into the existing `shareNote()` flow as a new sharing option.

## Requirements

- User can store a GitHub Personal Access Token (with `gist` scope) in encrypted settings
- User can toggle between public/private gist visibility
- Gist is created with the note title as filename (`.md` extension)
- Gist URL is copied to clipboard and opened in a new tab
- Integrates into the existing share fallback chain: Nostr → S3 → **GitHub Gist** → Server

## API

GitHub Gist REST API:
- `POST https://api.github.com/gists`
- Auth: `Authorization: token <GITHUB_TOKEN>`
- Body: `{ description, public, files: { "<title>.md": { content } } }`
- Response: `{ html_url, ... }`

## Files to Modify

1. `src/index.js` — Add data properties, settings persistence, gist creation method, share flow integration
2. `src/index.html` — Add settings UI for GitHub token and public/private toggle

## User Flow

1. User opens Settings → enters GitHub token (with gist scope)
2. User edits a note → clicks "Share" in the toolbar
3. If Nostr and S3 are not configured, or user cancels them, Gist share is attempted
4. If GitHub token is set, note is published as a Gist
5. User gets a toast with the Gist URL copied to clipboard
6. Gist opens in a new tab
