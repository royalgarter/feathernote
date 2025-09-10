# **App Name**: FeatherNote

## Core Features:

- Note Creation & Editing: Create, edit, and format notes using a Markdown editor. Side-by-side preview.
- Offline Storage: Store notes locally using the browser's IndexedDB for offline access.
- Share Target Integration: Receive shared content (text, links) from other apps via the Share Target API.
- Google One Tap Sign-On: Enable seamless login using Google One Tap.
- Reminder Notifications: Set reminders for notes that trigger push notifications via a service worker.
- Minimalist UI: Clean, distraction-free writing environment focused on content.
- S3 Sync: Allow the user to input S3 credentials to sync to an S3 bucket.

## Style Guidelines:

- Primary color: A serene light-blue (#A0D2EB), promoting calmness and focus.
- Background color: A very light blue-gray (#F0F4F8), for a gentle, unobtrusive backdrop.
- Accent color: A soft, muted violet (#B39DDB), providing subtle contrast for interactive elements.
- Body and headline font: 'PT Sans' (sans-serif) for a modern, accessible reading experience.
- Use simple, minimalist icons. Line icons with consistent stroke weight.
- Prioritize a clean, single-column layout for note-taking. Ample whitespace to improve readability.
- Subtle animations and transitions to enhance the user experience. Smooth fade-ins and transitions for opening/closing notes or settings panels.

## Future Features

### Paste Image from Clipboard

- **Goal:** Allow users to paste images from their clipboard directly into the EasyMDE editor.
- **Implementation Strategy:**
    1.  **Event Listener:** Attach a `paste` event listener to the CodeMirror instance within EasyMDE.
    2.  **Clipboard Processing:** In the listener, check the clipboard for items of type `file` and `image/*`.
    3.  **Offline-First (Base64):** Read the image file as a Base64 `data:` URL using the `FileReader` API.
    4.  **Markdown Insertion:** Insert the Base64 string into the editor at the cursor position as a Markdown image tag (`![](data:image/png;base64,...)`).
- **Future Enhancement:** If S3 is configured, provide an option to automatically upload the image to S3 and insert the public URL instead of using Base64.

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