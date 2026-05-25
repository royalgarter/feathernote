# Share Image Implementation in Feathernote

## Overview
Feathernote supports sharing images (e.g., screenshots) from Android devices directly into the app's 'Shared Inbox' note via the PWA Share Target API.

## Manifest Configuration
The `src/manifest.json` file is configured with a `share_target` block using `multipart/form-data`. The `params` field includes an `image` entry within a `files` array, which tells the browser to accept shared files matching `image/*`.

```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url",
    "files": [
      {
        "name": "image",
        "accept": ["image/*"]
      }
    ]
  }
}
```

## Service Worker Handling (`/share`)
The `/share` handler in `src/serviceworker.js` processes incoming share requests:

1.  **Extraction**: It extracts the `FormData` from the POST request.
2.  **File Retrieval**: It retrieves the file using `data.get('image')`.
3.  **Storage**: If a valid `File` object is retrieved:
    *   A unique ID is generated via `generateUniqueId('img')`.
    *   The file blob is stored in the `IMAGE_STORE` IndexedDB using `addImageDB`.
    *   A markdown image reference `![Shared Image](/images/<id>)` is created.
## Note Integration
*   **Images**: If a file is shared, it is stored in the 'Shared Images' note (or created if it doesn't exist). Any text/link content associated with the share is appended after the image markdown.
*   **Text/Links**: If only text or a URL is shared, it is stored in the 'Shared Inbox' note as before.
*   **Unique Destinations**: The app uses `shared_images_id` and `shared_inbox_id` meta keys to keep these destinations separate.
5.  **Backward Compatibility**: The code checks `imageFile instanceof File`. If no image is shared, the reference remains empty and the text/link sharing logic proceeds as it did previously.
