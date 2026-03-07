# FeatherNote Brainstorming: PWA, Mobile, and AI Improvements

This document outlines potential enhancements for FeatherNote across four key areas: PWA Performance, Mobile Experience, AI Integration, and Architectural Robustness.

## 1. PWA & Performance (The "Featherweight" Pillar)
FeatherNote's identity is defined by its speed and lightness.
*   **Workbox Migration:** Transition from a custom service worker to Workbox for advanced caching (stale-while-revalidate for UI, cache-first for libraries).
*   **Periodic Background Sync:** (Selected for Implementation) Use the Periodic Background Sync API to keep notes fresh even when the app is closed.
*   **Asset Bundling/Tree-shaking:** Use a lightweight build tool (e.g., Vite/Esbuild) to reduce the footprint of heavy dependencies like AWS SDK and EasyMDE.

## 2. Mobile App Experience (UX & Platform Integration)
Bridging the gap between a web app and a native mobile experience.
*   **Pull-to-Refresh:** Implement a native-feeling gesture to trigger manual synchronization.
*   **Biometric Authentication:** (Selected for Implementation) Leverage WebAuthn/Passkeys to allow users to unlock their notes with fingerprint or face ID.
*   **Native File System Access:** Allow desktop users to save/edit notes directly as `.md` files in their local filesystem.
*   **Haptic Feedback:** Add subtle haptics for critical actions (saving, deleting) on supported mobile devices.

## 3. AI Integration (Privacy-First Intelligence)
Enhancing the "AI-Powered Tools" while maintaining offline-first privacy.
*   **On-Device LLMs:** Use WebLLM or Transformers.js to run summarization and tagging entirely in the browser, no API key required.
*   **Local Semantic Search:** Use vector embeddings (via Voy or similar) to allow searching for notes by "meaning" rather than just keywords.
*   **Personal Knowledge RAG:** Enable a "Chat with your Notes" feature powered by a local vector store of the user's IndexedDB data.

## 4. Architectural Enhancements
Future-proofing the core sync and storage logic.
*   **CRDT Integration (Yjs/Automerge):** Replace "last-write-wins" with true conflict-free merging to support multi-device editing without data loss.
*   **Unified SyncProvider Interface:** Abstract S3, Google Drive, and Nostr into a single interface to easily add new providers (WebDAV, Dropbox).
*   **Binary Object Support:** Optimize storage and sync for images/attachments by handling them as Blobs rather than Base64 strings.
