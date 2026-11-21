# Paste Image on Chrome Android

## Problem

On Chrome for Android, Gboard often shows "Chrome does not support image pasting here".
That toast comes from the keyboard when the focused field does not advertise image MIME
support. Chrome only advertises it for `contenteditable` elements, never `<textarea>`.
Page JS cannot suppress it.

## Plan

1. **Force contenteditable input** — set `inputStyle: "contenteditable"` in the EasyMDE
   config so CodeMirror never falls back to its hidden textarea on mobile.
2. **"Paste image" toolbar button** — calls `navigator.clipboard.read()` (Chrome 84+,
   HTTPS, user gesture, permission prompt) and inserts the first `image/*` blob.
   Bypasses the keyboard entirely.
3. **"Insert image from file" toolbar button** — hidden `<input type=file accept="image/*">`.
   Always-works fallback (gallery picker).
4. **Share Target** — already supported: `manifest.json` accepts `image/*` under `image`,
   and `serviceworker.js` saves it into a new note. No change.

All three in-editor paths share one helper, `insertImageBlob(cm, blob)`, extracted from
the existing `paste` handler (data URL placeholder → `addImageDB` → swap to `/images/<id>`).
