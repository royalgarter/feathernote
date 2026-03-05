# Implementation Plan: Periodic Background Sync & Biometric Authentication

## 1. Periodic Background Sync

### Goal
Allow FeatherNote to synchronize notes with S3, Git, Nostr, or GDrive in the background at regular intervals (defined by the browser, usually 12-24 hours) even when the app is closed.

### Implementation Steps
1.  **Service Worker Updates (`src/serviceworker.js`):**
    *   Add `importScripts` for `git.js`, `nostr.js`, and `gdrive.js` so `synchronize` has access to all providers.
    *   Add a `periodicsync` event listener.
    *   In the listener, fetch the user ID and encrypted settings from IndexedDB.
    *   Decrypt settings and call the existing `synchronize` function.
2.  **App Initialization (`src/index.js`):**
    *   Request `periodic-background-sync` permission.
    *   Register the periodic sync tag (e.g., `'sync-notes'`) with a minimum interval.
3.  **Refactoring (`src/helpers.js`, `src/git.js`, etc.):**
    *   Ensure all functions assigned to `window` (like `window.initGit`) are also available in the Service Worker context (use `self` or check environment).

## 2. Biometric Authentication (PWA Screen Lock)

### Goal
Provide a privacy layer that requires fingerprint or face ID to unlock the app UI.

### Implementation Steps
1.  **State Management (`src/index.js`):**
    *   Add `isLocked` (boolean) and `biometricEnabled` (boolean) to the `mainApp` state.
    *   Persist `biometricEnabled` in `localStorage`.
2.  **WebAuthn Helpers (`src/helpers.js`):**
    *   Add `registerBiometric()`: Creates a new WebAuthn credential and saves the ID.
    *   Add `authenticateBiometric()`: Requests a signature from the saved credential.
3.  **UI Updates (`src/index.html`):**
    *   Add a "Lock Screen" overlay that appears when `isLocked` is true.
    *   Add a "Use Biometric Lock" toggle in the Settings menu.
4.  **App Logic:**
    *   If `biometricEnabled` is true, set `isLocked = true` on app launch or when the app becomes hidden (using `visibilitychange` event).
    *   Trigger `authenticateBiometric()` when the user clicks "Unlock".
