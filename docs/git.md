# Client-Side Git Sync Implementation

This document outlines the implementation of the client-side Git synchronization feature in FeatherNote, allowing users to sync their notes as Markdown files to a Git repository directly from the browser.

## Overview

FeatherNote now supports a "Git" sync provider alongside S3, Google Drive, and Nostr. This feature is built using **[isomorphic-git](https://isomorphic-git.org/)**, a pure JavaScript implementation of Git that runs in the browser, and **[LightningFS](https://github.com/isomorphic-git/lightning-fs)**, an IndexedDB-backed file system emulation.

### Key Features
- **Markdown Storage:** Notes are stored as individual `.md` files in the Git repository.
- **Metadata Preservation:** Note metadata (ID, tags, priority, dates) is stored in YAML Frontmatter at the top of each Markdown file.
- **Offline-First:** The Git repository is cloned to a local virtual file system (IndexedDB), allowing offline access and modifications.
- **Secure Credentials:** Git credentials (PAT/Token) are encrypted using the app's existing Web Crypto API implementation and stored locally.

## Technical Implementation

### 1. Libraries
The following libraries were added to `src/libs/`:
- `isomorphic-git.min.js`: The core Git logic.
- `lightning-fs.min.js`: Provides a Node.js-like `fs` API backed by IndexedDB.
- `http.min.js`: The HTTP client for `isomorphic-git` to communicate with remote repositories.

### 2. Core Logic (`src/git.js`)
A new module `src/git.js` was created to encapsulate all Git-related operations:
- **FileSystem Initialization:** Sets up `LightningFS` mounted at `/repo`.
- **`initGit(creds)`:** Handles the initial `git clone` if the repo doesn't exist locally, or `git pull` if it does.
- **`listNotesInGit(creds)`:** Reads `.md` files from the virtual FS, parses Frontmatter, and converts them into FeatherNote note objects.
- **`uploadNoteToGit(note, creds)`:** Converts a note object into Markdown + Frontmatter, writes it to the virtual FS, and stages it (`git add`).
- **`deleteNoteFromGit(noteId, creds)`:** Removes the file from the virtual FS and stages the deletion (`git remove`).
- **`finishGitSync(creds)`:** Commits any staged changes (uploads/deletes) and pushes them to the remote repository.

### 3. Integration (`src/helpers.js`)
The central `synchronize` function was updated to orchestrate the Git flow:
1.  **Init:** Calls `initGit` to pull the latest changes from the remote.
2.  **List:** Fetches the state of the local Git repo (via `listNotesInGit`) and merges it with states from S3/Nostr.
3.  **Upload/Delete:** When a note needs to be uploaded or deleted, `uploadNoteToGit` or `deleteNoteFromGit` is called respectively. These update the *local* Git repo state.
4.  **Push:** After all note operations are complete, `finishGitSync` is called to create a commit and push it to the remote server.

### 4. UI & State (`src/index.js`, `src/index.html`)
- **Settings Dialog:** Added a new fieldset for Git configuration:
    - Repository URL
    - Branch (default: `main`)
    - Username
    - Personal Access Token (PAT) / Password
    - Email (for commit authorship)
    - CORS Proxy (default: `https://cors.isomorphic-git.org`)
- **State Management:** `mainApp` now tracks Git credentials, handles their encryption/decryption, and passes them to the sync logic.

## Usage Guide

1.  **Open Settings:** Click the settings icon in the top-right.
2.  **Configure Git:** Scroll to the "Git Sync" section.
3.  **Repository URL:** Enter the HTTPS URL of your repository (e.g., `https://github.com/username/notes.git`).
    *   *Note:* The repository must theoretically be empty or contain compatible Markdown files.
4.  **Authentication:**
    *   **Username:** Your GitHub/GitLab username.
    *   **Token:** A Personal Access Token (PAT) with `repo` (read/write) scopes. *Password authentication is deprecated on most platforms.*
5.  **CORS Proxy:** Browser security prevents direct requests to most Git hosts. A CORS proxy is required. The default `https://cors.isomorphic-git.org` works for testing, but you may want to host your own for privacy/stability.
6.  **Save & Sync:** Click "Save". The app will attempt to clone/pull the repository. Subsequent syncs will push your notes as Markdown.

## Note Format

Notes are saved as `[id].md`.

**Example File Content:**
```markdown
---
id: 1733305200000
title: My Project Idea
updatedAt: 2025-12-04T10:00:00.000Z
createdAt: 2025-12-04T09:00:00.000Z
tags: [ideas, project, work]
priority: 1
---

# My Project Idea

This is the content of the note. It is standard Markdown.
```

## Limitations / Future Work
- **Conflict Resolution:** Currently relies on "Last Write Wins" based on timestamps. Git merge conflicts during `pull` might require more advanced handling.
- **CORS Proxy:** Dependency on a third-party CORS proxy is a potential bottleneck or privacy concern. Users are encouraged to self-host a proxy (e.g., using [cors-buster](https://github.com/isomorphic-git/cors-proxy)).
- **Performance:** Large repositories might be slow to clone initially inside the browser.
