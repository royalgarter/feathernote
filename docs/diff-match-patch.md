# Diff-Match-Patch Implementation Plan

This document outlines the plan to prevent data loss from concurrent edits by implementing a 3-way merge strategy. We will use the `diff-match-patch` JavaScript library, the industry standard for high-performance text differencing and patching.

The core concept is to perform a "3-way merge" when a sync conflict is detected. This requires three versions of a note's content:
1.  **`BASE`**: The original version of the note before the current user started editing.
2.  **`LOCAL`**: The current version in the user's editor, with their unsaved changes.
3.  **`REMOTE`**: The newer version from the server, modified by another client.

---

### Step 1: Library Integration

To make the library available to the application, a `<script>` tag will be added to the `<head>` of `src/index.html` to load `diff-match-patch` from a reliable CDN.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/diff-match-patch/20121119/diff_match_patch.js"></script>
```

---

### Step 2: Architectural Change: Capturing the `BASE` Version

The most significant architectural change is capturing the `BASE` version of a note. This will be handled within the main Alpine.js component in `src/index.js`.

1.  **Add New State Variable:** A new property, `noteEditorBaseContent: null`, will be added to the component's data object. This will hold the `BASE` content string during an editing session.

2.  **Update `editNote(id)`:** When a user begins editing a note, after the note's content is loaded from the database into the editor, this content will also be copied into the `this.noteEditorBaseContent` variable.

3.  **Update `saveNote()` and `cancelEdit()`:** When the user's editing session concludes (either by saving or canceling), `this.noteEditorBaseContent` will be reset to `null` to signify that no merge is necessary.

---

### Step 3: Implementing the Merge Logic

The core logic will be implemented by rewriting the `mergeRemoteNote(remoteNote)` function in `src/index.js`.

The new function will follow these steps:

1.  **Detect True Conflict:** A merge is only performed if a genuine conflict exists. The function will check for the following conditions:
    *   Is the user currently editing the note that was just received from the server? (`this.editingNoteId === remoteNote.id`)
    *   Has the user actually made changes? (`this.noteEditorBaseContent` is not null and is different from the current editor content).
    *   Is the remote note confirmed to be newer than the version the user started editing?

2.  **Perform 3-Way Merge:** If all conditions for a conflict are met:
    *   An instance of `diff_match_patch` will be created.
    *   The `BASE`, `LOCAL` (from the editor), and `REMOTE` text versions will be defined.
    *   A patch will be generated representing the user's changes: `dmp.patch_make(BASE, LOCAL)`.
    *   This patch will be applied to the `REMOTE` text: `dmp.patch_apply(patch, REMOTE)`.

3.  **Handle Merge Failures:** The `patch_apply` function returns a boolean array indicating the success of each part of the merge. If any part fails (e.g., the same line was edited in both `LOCAL` and `REMOTE`), a conflict block will be appended to the bottom of the merged text to warn the user:
    ```markdown
    --- MERGE CONFLICT ---
    Your changes could not be fully merged with a newer version from the server. Please review the note above.
    --- END CONFLICT ---
    ```

4.  **Update Application State:**
    *   The `mergedText` will be saved to the local IndexedDB.
    *   The live editor's content will be updated instantly with the `mergedText`, so the user immediately sees the result of the merge.
    *   A toast notification (e.g., "Your changes have been merged with a newer version from the server") will be displayed.

If no conflict is detected, the function will fall back to its original behavior of simply accepting the newer version from the server.
