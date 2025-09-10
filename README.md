# FeatherNote

FeatherNote is a lightweight, privacy-focused offline-first notetaking application that runs entirely in your browser. It uses your browser's local storage (IndexedDB) to save your notes, and it offers an optional feature to sync your notes to a private S3 bucket for backup and multi-device access.

This version of FeatherNote is built with Alpine.js and Tailwind CSS, making it fast, simple, and easy to maintain.

## Features

*   **Offline First:** Your notes are stored locally in your browser, so you can access them even without an internet connection.
*   **Rich Text Editing:** Create and edit notes using a full-featured Markdown editor (EasyMDE) that supports formatting, lists, links, and more.
*   **Search:** Instantly search through the title, content, and tags of all your notes.
*   **Tag-Based Organization:** Organize your notes with comma-separated tags for easy filtering and retrieval.
*   **Reminders:** Set reminders for your notes and receive native desktop notifications.
*   **Optional S3 Sync:** For users who want to back up their notes or sync them across multiple devices, FeatherNote offers a secure S3 sync feature.
*   **Privacy Focused:** Your notes are your own. If you choose to use the S3 sync feature, your S3 credentials are encrypted in your browser and are never sent to any server other than your own S3 bucket.
*   **Google Sign-In:** Securely sign in with your Google account to associate your S3 settings with your identity.
*   **Import/Export Settings:** Easily move your encrypted S3 configuration between devices.
*   **PWA Ready:** FeatherNote can be "installed" as a Progressive Web App (PWA) on your desktop or mobile device for a more native-like experience.
*   **Share Target:** Use your browser's native share functionality on mobile or desktop to send links and text directly to FeatherNote to be saved as new notes.

## Tech Stack

*   **Frontend:** [Alpine.js](https://alpinejs.dev/)
*   **Markdown Editor:** [EasyMDE](https://github.com/Ionaru/easy-markdown-editor)
*   **Backend:** [Node.js](https://nodejs.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **Database:** [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via a simple wrapper)
*   **Authentication:** Google Identity Services (for client-side authentication)
*   **Encryption:** Web Crypto API (for encrypting S3 credentials)

## S3 Sync Configuration

The S3 sync feature is optional. To use it, you will need:

*   An AWS account (or an account with another S3-compatible storage provider).
*   An S3 bucket.
*   A set of IAM credentials (an `Access Key ID` and a `Secret Access Key`) with permissions to read, write, and list objects in your bucket.

**Important Security Note:** For maximum security, it is highly recommended that you create a new IAM user with a policy that restricts its access to *only* the bucket you are using for FeatherNote.

### CORS Configuration

For FeatherNote to be able to communicate with your S3 bucket, you will need to configure the bucket's CORS (Cross-Origin Resource Sharing) policy.

Here is an example CORS policy. You will need to replace `https://your-feathernote-domain.com` with the actual domain where you are hosting FeatherNote (or `http://localhost:7347` for local development).

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE"
        ],
        "AllowedOrigins": [
            "http://localhost:7347",
            "https://your-feathernote-domain.com"
        ],
        "ExposeHeaders": []
    }
]
```

### Setting up Sync in the App

1.  Click on the "Settings" icon in the top right corner of the app.
2.  Sign in with your Google account. This is used to securely store your encrypted settings in your browser's local storage, tied to your Google identity.
3.  Enter your S3 bucket name, region, and credentials.
4.  Click "Save Credentials".

Your notes will now automatically sync every 2 minutes, and you can trigger a manual sync at any time.