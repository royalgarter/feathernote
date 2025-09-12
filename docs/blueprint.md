# **App Name**: FeatherNote

## Core Features:

- Note Creation & Editing: Create, edit, and format notes using a Markdown editor. Side-by-side preview.
- Offline Storage: Store notes locally using the browser's IndexedDB for offline access.
- Share Target Integration: Receive shared content (text, links) from other apps via the Share Target API.
- Google One Tap Sign-On: Enable seamless login using Google One Tap.
- Reminder Notifications: Set reminders for notes that trigger push notifications via a service worker.
- Minimalist UI: Clean, distraction-free writing environment focused on content.
- S3 Sync: Allow the user to input S3 credentials to sync to an S3 bucket.

## Future Features

### Paste Image from Clipboard

- **Goal:** Allow users to paste images from their clipboard directly into the editor, with a robust offline-first approach and optional S3 backup.
- **Implementation Strategy (Hybrid Approach):**

    1.  **Event Listener & Local Storage:**
        - Attach a `paste` event listener to the editor.
        - On paste, check the clipboard for image files.
        - Generate a unique ID (e.g., UUID) for each pasted image.
        - Store the image Blob in **IndexedDB** with its unique ID as the key. This makes the paste operation instant and fully available offline.
        - Insert a Markdown image tag with a local, interceptable URL into the editor (e.g., `![](/images/your-unique-image-id)`).

    2.  **Service Worker for Local Serving:**
        - The application's **Service Worker** will intercept `fetch` requests for the `/images/*` path.
        - When a request is caught, the service worker retrieves the corresponding image Blob from IndexedDB.
        - It then constructs and returns a `Response` with the image data and the correct `Content-Type` header, effectively serving the image from the local database.

    3.  **S3 Background Sync (Enhancement):**
        - If the user has configured S3 credentials, a background process will manage synchronization.
        - This process will periodically check IndexedDB for images that have not yet been uploaded to S3.
        - For each unsynced image, it will request a **presigned PUT URL** from a backend service.
        - The client-side background process will use this URL to upload the image file directly to the private S3 bucket.
        - Once the upload is successful, the image's status is marked as "synced" in IndexedDB.

    4.  **Cross-Device/Remote Access:**
        - When a note is opened, if an image's local URL points to an image not found in the local IndexedDB (e.g., on a different device), the application will attempt to fetch it from S3.

### Nostr Implementation - Potential Issues

#### 1. Insecure Private Key Storage
*   **Issue**: The Nostr private key is stored in `localStorage`, which is not a secure location. Malicious browser extensions or scripts on the same page could potentially access the private key.
*   **Priority**: High
*   **Complexity**: Medium

#### 2. Lack of Granular Error Handling for Nostr Publications
*   **Issue**: The application does not provide specific feedback if publishing a note to a Nostr relay fails. The S3 upload might succeed while the Nostr publication fails silently.
*   **Priority**: High
*   **Complexity**: Medium

#### 3. Implicit Nostr Publishing
*   **Issue**: Notes are published to Nostr automatically as a side-effect of S3 synchronization. The user may not be fully aware that their notes are being broadcast to a public network.
*   **Priority**: Medium
*   **Complexity**: Low

#### 4. Non-standard Nostr Content Formatting
*   **Issue**: The entire note object is published as a JSON string. This makes the note content difficult to read for other Nostr clients, limiting interoperability.
*   **Priority**: Low
*   **Complexity**: Medium

## References

### SilverBullet
- Markdown-based Notes
- Self-Hosted & Web-Based
- Offline Capability & Synchronization
- Lua Scripting API
- Tagging System
- Bi-directional Linking
- Powerful Querying & Templating
- Search Functionality
- Keyboard-based Navigation
- Markdown Extensions
- Extensibility
- Open Source
- No Electron Shell

### OpenNotas
- Cross-platform compatibility
- Offline functionality
- Installable as an app
- Persistent storage
- User-friendly interface
- Security (AES encryption)
- Synchronization capabilities
- Markdown support
- Customizable themes
- Search and tagging system
- Free and open-source

### TiddlyWiki
- Single-File System
- Portability and Longevity
- High Customization and Extensibility
- Open-Source Nature
- Tiddlers
- Plugin Architecture
- Interlinking and Transclusion
- Tagging and Search
- Metaprogramming
- Versatile Applications
- Community-Driven
- Multilingual Support
- Quine-like Functionality

### Notepad (Offline capable)
- Offline Functionality
- Local Data Storage
- Autosaving
- Installability
- App-like Experience
- Cross-Platform Compatibility
- Fast Loading
- Privacy-Focused Design
- User Interface Enhancements
- Productivity Tools
- Data Export
- Background Synchronization

### Notesnook
- End-to-End Encryption
- Zero-Knowledge
- Cross-Platform Sync with Encryption
- Vault Security
- Two-Factor Authentication (2FA)
- Encrypted Backups
- Per-Note Password Protection
- Metadata Protection
- PIN codes, Biometric Locks, Hardware Security Keys
- Open-Source
- Self-Hostable
- Advanced Editor
- Organizational Tools
- Note Pinning
- Callouts
- Wikilinks
- Cross-Platform Access
- Offline Access
- Unlimited Devices
- Monograph Sharing
- File Sharing/Attachments
- Web Clipper
- Import Tools
- Export Options
- Custom Interface
- Reminders
- To-do List & Task Tracking
- Recurring Tasks
- Templates
- Version Control
- Widgets
- Share Extensions
- Shortcut Integration
