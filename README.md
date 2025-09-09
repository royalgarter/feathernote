# FeatherNote

FeatherNote is a feather weight, privacy-focused offline-first notetaking application that runs entirely in your browser. It uses your browser's local storage (IndexedDB) to save your notes, and it offers an optional feature to sync your notes to a private S3 bucket for backup and multi-device access.

This version of FeatherNote is built with Alpine.js and Tailwind CSS, making it fast, simple, and easy to maintain.

## Features

*   **Offline First:** Your notes are stored locally in your browser, so you can access them even without an internet connection.
*   **Markdown Editor:** Create, edit, and format notes with a clean, intuitive interface and a side-by-side Markdown preview.
*   **Reminder Notifications:** Set reminders for your notes and receive push notifications.
*   **Optional S3 Sync:** For users who want to back up their notes or sync them across multiple devices, FeatherNote offers a secure S3 sync feature.
*   **Privacy Focused:** Your notes are your own. If you choose to use the S3 sync feature, your S3 credentials are encrypted in your browser and are never sent to any server other than your own S3 bucket.
*   **Google Sign-In:** Securely sign in with your Google account to associate your S3 settings with your identity.
*   **Import/Export Settings:** Easily move your encrypted S3 configuration between devices.
*   **PWA Ready:** FeatherNote can be "installed" as a Progressive Web App (PWA) on your desktop or mobile device for a more native-like experience.
*   **Share Target:** Enable to share from mobile / desktop browser using PWA Share Target API.

## Tech Stack

*   **Frontend:** [Alpine.js](https://alpinejs.dev/)
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

## Deployment

FeatherNote is designed to be deployed as a static web application, with all client-side logic residing in the `src/` directory.

### Normal NodeJS / Deno Hosting

If you wish to utilize the full functionality of FeatherNote, including the PWA Share Target feature, you can deploy the application using a Node.js or Deno environment. The `server.js` file provides the necessary backend routes.

To deploy:

1.  Ensure you have Node.js (or Deno) installed.
2.  Install dependencies: `npm install` (for Node.js).
3.  Start the server: `npm start` (for Node.js) or `deno run --allow-net --allow-read server.js` (for Deno, if compatible).
4.  Configure your hosting environment to run `server.js` and serve the static files from the `src/` directory.

### Static Site Hosting

You can deploy FeatherNote to any static site hosting service (e.g., GitHub Pages, Netlify, Vercel, AWS S3 + CloudFront) by simply serving the contents of the `src/` directory.

**Important Note on Share Target (`/share` route):**

The PWA Share Target feature, which allows other applications to share content directly with FeatherNote, relies on a server-side route (`/share`) to process incoming shared data. When deploying FeatherNote as a purely static site, this server-side route will **not** function.

If the Share Target feature is critical for your use case, you have a few options:

1.  **Node.js Server (as provided):** Deploy the `server.js` file alongside your static assets to a platform that supports Node.js (e.g., Heroku, AWS Elastic Beanstalk, Google App Engine). This ensures the `/share` route is active.
2.  **Serverless Function:** Implement the logic of the `/share` route as a serverless function (e.g., AWS Lambda, Google Cloud Functions, Azure Functions) and configure your static site to proxy requests to this function.
3.  **Client-Side Only Share Target (Advanced):** For very specific scenarios, you might be able to handle some share target functionality purely client-side using the `navigator.share` API, but this is generally more limited and complex than a server-side approach.

For most users who primarily use FeatherNote for personal note-taking and S3 sync, deploying as a static site is sufficient, and the absence of the `/share` route will not impact core functionality.
