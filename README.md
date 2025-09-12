# FeatherNote: Your Notes, Your Cloud, Your Privacy.

A featherweight, offline-first PWA Note with Markdown, S3 Sync, and Share Target API.

**Try FeatherNote now: [feathernote.deno.dev](https://feathernote.deno.dev)**

**In a world of data breaches and ever-growing cloud subscriptions, haven't you ever wished for a note-taking app that puts you back in control?**

That's the question that sparked the creation of FeatherNote. We were tired of our personal thoughts and important reminders being locked away in someone else's database, subject to their terms, their security, and their pricing. We wanted something simple, fast, and private. Something that worked offline as seamlessly as it worked online.

**FeatherNote is our answer. It's a story of digital independence.**

Imagine a notebook that's always with you, whether you're on a plane, in a subway, or simply disconnected from the grid. That's FeatherNote. It's an offline-first Progressive Web App (PWA) that lives entirely in your browser. Your notes are yours, stored securely on your own device in IndexedDB.

But what about backups? What about using your notes on your phone *and* your laptop?

This is where the magic happens. FeatherNote doesn't force you into a proprietary cloud. Instead, it empowers you to **use your own.** With an optional S3 Sync feature, you can connect FeatherNote to your own private S3 bucket—be it on AWS or any other S3-compatible provider. Your notes are synced, encrypted, and backed up in a space that you own and manage.

## Why FeatherNote?

-   ✍️ **Effortless Markdown:** A clean, beautiful Markdown editor with a live preview. Formatting your thoughts has never been more satisfying.
-   ✈️ **Truly Offline-First:** No internet? No problem. Write, read, and edit your notes anytime, anywhere.
-   ☁️ **Sync to Your Own Cloud:** Securely sync your notes across devices using your own S3 bucket. Your data, your rules.
-   🔒 **Privacy is Paramount:** Your S3 credentials are encrypted in your browser and are never sent to any server but your own. We can't see your notes, and neither can anyone else.
-   🔔 **Stay on Track:** Set reminders for your notes and get push notifications so you never miss a beat.
-   📲 **Installable & Shareable:** As a PWA, you can install FeatherNote on your desktop or mobile device for a native-app feel. You can even share content directly to it from other apps!
-   🚀 **Feather-light & Fast:** Built with Alpine.js and Tailwind CSS, the interface is snappy, responsive, and a joy to use.

## Philosophy

We believe that your personal notes are just that: personal. You shouldn't have to trade your privacy for convenience. FeatherNote is designed for the privacy-conscious individual who wants the convenience of the cloud without sacrificing ownership of their data. It's for the developer who already has an S3 bucket, the student who needs a reliable offline notebook, and anyone who believes in a more decentralized, user-empowered web.

Welcome to a new era of note-taking. Welcome to FeatherNote.

## Tech Stack

-   **Frontend:** [Alpine.js](https://alpinejs.dev/)
-   **Backend:** [Node.js](https://nodejs.org/), [Deno](https://deno.com/)
-   **Styling:** [Tailwind CSS](https://tailwindcss.com/), [Tailwind Lite](https://github.com/reallygoodsoftware/litewind)
-   **Database:** [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via a simple wrapper)
-   **S3:** [AWS SDK for JavaScript](https://aws.amazon.com/sdk-for-javascript/)
-   **Authentication:** [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/display-google-one-tap) (for client-side authentication)
-   **Encryption:** Web Crypto API (for encrypting S3 credentials)

## Your Own S3 Bucket

FeatherNote empowers you to use your own S3-compatible storage for syncing your notes. Many cloud providers offer free tiers or very affordable options for S3-compatible storage, making it easy to set up your personal cloud.

Here are some popular providers where you can create an S3 bucket:

-   **[Amazon Web Services (AWS) S3](https://aws.amazon.com/s3/):** The original S3. AWS offers a free tier that includes 5GB of standard storage for new accounts.
-   **[Google Cloud Storage](https://cloud.google.com/storage):** Google's object storage solution, compatible with S3 APIs. Offers a free tier with 5GB of standard storage.
-   **[Cloudflare R2](https://www.cloudflare.com/developer/r2/):** A highly competitive S3-compatible storage offering with a generous free tier and no egress fees.
-   **[Backblaze B2 Cloud Storage](https://www.backblaze.com/cloud-storage/b2):** Known for its affordable pricing and S3 compatibility. Offers 10GB of free storage.
-   **[Wasabi Hot Cloud Storage](https://wasabi.com/cloud-storage/hot-cloud-storage/):** Offers a single tier of high-performance, S3-compatible storage with no egress fees. They often have trial periods.
-   **[iDrive e2](https://www.idrive.com/e2/):** Another S3-compatible cloud storage provider with competitive pricing.
-   **[MinIO](https://min.io/):** For users who prefer to self-host their S3-compatible storage, MinIO provides high-performance, S3-compatible object storage that can be run on your own infrastructure. This is an excellent option for those who want complete control over their data, especially for AI/ML workloads where data locality and privacy are crucial.

When choosing a provider, consider their free tier limits, pricing after the free tier, and ease of use. Once you have an S3 bucket, you'll need to generate Access Key ID and Secret Access Key credentials with appropriate permissions for FeatherNote to access it.

## S3 Sync Configuration

The S3 sync feature is optional. To use it, you will need:

-   An AWS account (or an account with another S3-compatible storage provider).
-   An S3 bucket.
-   A set of IAM credentials (an `Access Key ID` and a `Secret Access Key`) with permissions to read, write, and list objects in your bucket.

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

### Sync Logic

FeatherNote employs a robust synchronization strategy to ensure your notes are kept up-to-date across multiple devices while protecting against common data loss scenarios like conflicts and race conditions. The sync process can be thought of as a three-way merge between the client's local database, the remote S3 bucket, and a list of notes pending deletion.

The core strategy is **"last-write-wins,"** determined by comparing timestamps. Here’s how it works each time a sync is triggered:

1.  **Fetch Remote State:** The first and most crucial step is that the client fetches a complete list of all notes currently stored in your S3 bucket, along with their last modification times. This provides a clear picture of the server's state *before* any changes are made.

2.  **Compare and Decide (Uploads):** The client then iterates through its local notes and compares each one against the remote state:
    *   If a local note does not exist on the server, it is marked for **upload**.
    *   If a note exists in both places, the client compares the local note's `updatedAt` timestamp with the server's `lastModified` timestamp. The local note is only marked for **upload** if it is demonstrably newer. This is the key step that prevents an older, offline change from overwriting a newer change that was synced from a different device.

3.  **Compare and Decide (Downloads):** Next, the client examines the list of remote notes fetched in step 1:
    *   If a note on the server does not exist in the local database, it is marked for **download**.
    *   If a note exists in both places, it is only marked for **download** if the server's version is newer than the local version. This ensures your device always gets the most up-to-date copy.

4.  **Handle Deletions:** Notes that you delete in the app are tracked in a temporary deletion queue. During the sync, these notes are permanently deleted from the S3 bucket. When another device syncs, it will see that the note is no longer on the server and will delete it from its own local database, keeping everything consistent.

5.  **Execute:** Finally, the client executes all the planned uploads, downloads, and deletions in an efficient, parallel process.

This "fetch-then-compare" methodology ensures that the most recent version of any note always wins, providing a reliable and consistent note-taking experience across all your devices without silently losing your work.

## Deployment

FeatherNote is designed to be deployed as a static web application, with all client-side logic residing in the `src/` directory.

### Normal NodeJS / Deno Hosting

If you wish to utilize the full functionality of FeatherNote, (such as `/publish` for publish your note), you can deploy the application using a Node.js or Deno environment. The `server.js` file provides the necessary backend routes.

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

For most users who primarily use FeatherNote for personal note-taking and S3 sync, deploying as a static site is sufficient, and the absence of the `/share` route will not impact core functionality.s sufficient, and the absence of the `/share` route will not impact core functionality.
