<p align="center"><img src="https://feathernote.deno.dev/icons/ios/128.png" alt="FeatherNote Logo" width="128"></p>

# FeatherNote: featherweight, offline-first PWA Note with Markdown, S3 Sync, and Share Target API.

**Try FeatherNote now: [feathernote.newsrss.org](https://feathernote.newsrss.org)**

**In a world of data breaches and ever-growing cloud subscriptions, haven't you ever wished for a note-taking app that puts you back in control?**

That's the question that sparked the creation of FeatherNote. We were tired of our personal thoughts and important reminders being locked away in someone else's database, subject to their terms, their security, and their pricing. We wanted something simple, fast, and private. Something that worked offline as seamlessly as it worked online.

**FeatherNote is our answer. It's a story of digital independence.**

Imagine a notebook that's always with you, whether you're on a plane, in a subway, or simply disconnected from the grid. That's FeatherNote. It's an offline-first Progressive Web App (PWA) that lives entirely in your browser. Your notes are yours, stored securely on your own device in IndexedDB.

But what about backups? What about using your notes on your phone *and* your laptop?

This is where the magic happens. FeatherNote doesn't force you into a proprietary cloud. Instead, it empowers you to **use your own.** With an optional S3 Sync feature, you can connect FeatherNote to your own private S3 bucket—be it on AWS or any other S3-compatible provider. Your notes are synced, encrypted, and backed up in a space that you own and manage.

## Why FeatherNote?

-   ✍️ **Effortless Markdown:** A clean, beautiful Markdown editor with a live preview. Formatting your thoughts has never been more satisfying.
-   🚩 **Prioritize Your Notes:** Easily reorder your notes by priority to keep the most important ones at the top.
-   ✂️ **Clip Note Content:** Easily clip and save snippets of content from your notes.
-   ✈️ **Truly Offline-First:** No internet? No problem. Write, read, and edit your notes anytime, anywhere.
-   🔒 **Privacy is Paramount:** Your S3 credentials are encrypted in your browser and are never sent to any server but your own. We can't see your notes, and neither can anyone else.
-   🔔 **Stay on Track:** Set reminders for your notes and get push notifications so you never miss a beat.
-   🌐 **Web Clipper:** Found something interesting online? Paste a URL into a new note and watch FeatherNote automatically fetch and save the content. It's like a "read it later" feature, but for your own private notebook.
-   📲 **Installable & Shareable:** As a PWA, you can install FeatherNote on your desktop or mobile device for a native-app feel. You can even share content directly to it from other apps!
-   🚀 **Feather-light & Fast:** Built with Alpine.js and Tailwind CSS, the interface is snappy, responsive, and a joy to use.
-   🎨 **Excalidraw Integration (Non-Offline-able-Yet because of React Dependencies):** Sketch your ideas, create diagrams, and embed them directly into your notes.
-   ☁️ **Sync to Your Own Cloud (Optional):** Securely sync your notes across devices using your own S3 bucket. Your data, your rules.
-   💜 **Nostr Integration (Optional):** Sync or Publish your notes with the decentralized Nostr protocol.
-   💾 **Google Drive Backup (Optional):** Simple, zero-configuration sync using your Google Drive.
-   🤖 **AI-Powered Tools (Optional):**
    -   **Automatic Tagging:** Let FeatherNote suggest relevant tags for your notes based on their content.
    -   **Improve with AI:** Enhance your writing, fix grammar, and rephrase sentences.
    -   **Summarize with AI:** Quickly get the gist of long notes with AI-powered summaries.

## Concern on AI-Powered features?

FeatherNote integrates powerful AI capabilities to enhance your note-taking experience. What sets our approach apart is our commitment to user control and flexibility. You are not locked into a specific AI provider; instead, you can connect to the AI of your choice, whether it's a third-party service or your own self-hosted model.

### Your AI, Your Choice

We believe that you should have the freedom to choose the AI that best suits your needs for performance, privacy, and cost. FeatherNote supports connecting to any AI provider that offers an API OpenAI compatible endpoint.

-   **Third-Party AI Services:** Easily connect to popular AI services like OpenAI, Google AI, Anthropic, and more. All you need is your API key.
-   **Self-Hosted AI:** For maximum privacy and control, you can run your own AI models (e.g., using Ollama, Llamafile, or a custom solution) and point FeatherNote to your local or private server. As long as your model is served via an API endpoint, FeatherNote can integrate with it.

### Secure and Private

Your API keys and credentials are encrypted and stored locally in your browser. They are only used to communicate directly with your chosen AI provider and are never sent to our servers.

### How it Works

1.  **Go to Settings:** Navigate to the settings page in FeatherNote.
2.  **Enter Your AI Configuration:** Provide the API endpoint URL and your authentication credentials (e.g., API key, bearer token).
3.  **Start Using AI Features:** Once configured, you can use features like "Improve with AI" and "Summarize with AI" throughout the app.

This approach allows you to leverage the power of AI while maintaining full ownership and control over your data and tools.

## Philosophy

We believe that your personal notes are just that: personal. You shouldn't have to trade your privacy for convenience. FeatherNote is designed for the privacy-conscious individual who wants the convenience of the cloud without sacrificing ownership of their data. It's for the developer who already has an S3 bucket, the student who needs a reliable offline notebook, and anyone who believes in a more decentralized, user-empowered web.

Welcome to a new era of note-taking. Welcome to FeatherNote.

## Tech Stack

-   **Frontend:** [Alpine.js](https://alpinejs.dev/)
-   **Backend:** [Node.js](https://nodejs.org/), [Deno](https://deno.com/)
-   **Styling:** [Tailwind CSS](https://tailwindcss.com/), [Tailwind Lite](https://github.com/reallygoodsoftware/litewind)
-   **Database:** [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via a simple wrapper)
-   **S3:** [AWS SDK for JavaScript](https://aws.amazon.com/sdk-for-javascript/)
-   **Google Drive:** [Google Drive API](https://developers.google.com/drive/api)
-   **Authentication:** [Google Identity Services](https://developers.google.com/identity/gsi/web/guides/display-google-one-tap) (for client-side authentication)
-   **Encryption:** Web Crypto API (for encrypting S3 credentials)
-   **Nostr:** [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
-   **Markdown Editor:** [EasyMDE](https://github.com/Ionaru/easy-markdown-editor)
-   **Drawing:** [Excalidraw](https://excalidraw.com/)
-   **Article Parsing:** [mozilla/readability](https://github.com/mozilla/readability)

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

## Syncing

FeatherNote supports multiple providers for syncing your notes across devices. All providers use the same underlying sync logic to ensure consistency.

### Sync Logic

FeatherNote employs a robust synchronization strategy to ensure your notes are kept up-to-date across multiple devices while protecting against common data loss scenarios like conflicts and race conditions. This logic is used by all sync providers (S3, Google Drive, etc.).

The core strategy is **"last-write-wins,"** determined by comparing timestamps. Here’s how it works each time a sync is triggered:

1.  **Fetch Remote State:** The client fetches a complete list of all notes currently in the remote storage, along with their last modification times. This provides a clear picture of the remote state *before* any local changes are pushed.

2.  **Compare and Decide (Uploads):** The client then iterates through its local notes:
    *   If a local note does not exist in the remote storage, it is marked for **upload**.
    *   If a note exists in both places, its `updatedAt` timestamp is compared with the remote note's `lastModified` timestamp. The local note is only marked for **upload** if it is demonstrably newer. This prevents an older, offline change from overwriting a newer change that was synced from a different device.

3.  **Compare and Decide (Downloads):** Next, the client examines the list of remote notes:
    *   If a remote note does not exist in the local database, it is marked for **download**.
    *   If a note exists in both places, it is only marked for **download** if the remote version is newer than the local version.

4.  **Handle Deletions:** Notes deleted in the app are tracked in a temporary queue. During the sync, these notes are permanently deleted from the remote storage. When another device syncs, it will see the note is gone and delete it locally, keeping all devices consistent.

5.  **Execute:** Finally, the client executes all the planned uploads, downloads, and deletions in an efficient, parallel process.

This "fetch-then-compare" methodology ensures that the most recent version of any note always wins, providing a reliable and consistent note-taking experience across all your devices without silently losing your work.

### S3 Sync Configuration

The S3 sync feature is optional. To use it, you will need:

-   An AWS account (or an account with another S3-compatible storage provider).
-   An S3 bucket.
-   A set of IAM credentials (an `Access Key ID` and a `Secret Access Key`) with permissions to read, write, and list objects in your bucket.

**Important Security Note:** For maximum security, it is highly recommended that you create a new IAM user with a policy that restricts its access to *only* the bucket you are using for FeatherNote.

#### CORS Configuration

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

#### Setting up Sync in the App

1.  Click on the "Settings" icon in the top right corner of the app.
2.  Sign in with your Google account. This is used to securely store your encrypted settings in your browser's local storage, tied to your Google identity.
3.  Enter your S3 bucket name, region, and credentials.
4.  Click "Save Credentials".

Your notes will now automatically sync every 2 minutes, and you can trigger a manual sync at any time.

### Nostr Sync Configuration

FeatherNote also supports syncing with the Nostr protocol. To use this feature, you will need a Nostr private key and a list of relays.

1.  Click on the "Settings" icon in the top right corner of the app.
2.  Enter your Nostr private key (in `nsec...` format) or generate a new one.
3.  Enter a comma-separated list of Nostr relays (e.g., `wss://relay.damus.io,wss://relay.primal.net`).
4.  Click "Save".

Your notes will now be synced with the configured Nostr relays in addition to S3.

### Google Drive Sync (Simple Sync)

For users who want a simple, zero-configuration sync experience, FeatherNote offers syncing via Google Drive. This is the recommended option for most users, providing a "just works" experience by leveraging the user's own Google account for storage.

The entire implementation is **fully client-side**, meaning there is no custom backend server to build, host, or maintain.

#### How it Works

1.  **Client-Side Authentication:** The app uses the **Google Identity Services for Web** library to handle the sign-in and consent flow securely in the browser. When you sign in, the app receives a temporary `access token`.

2.  **Persistent Sessions:** Your connection is saved in the browser's `localStorage`. When you reopen FeatherNote, the app automatically verifies your session and reconnects you, providing a seamless experience.

3.  **Private App Data Folder:** FeatherNote requests permission to access a special, hidden folder in your Google Drive (`drive.appdata` scope). This folder is **only accessible by FeatherNote**, ensuring your notes don't clutter your main Drive view and remain private to the app.

4.  **Direct API Communication:** Using the access token, the app's client-side code communicates directly with the Google Drive API. Google's services are configured to allow this, removing the need for a server to proxy requests.

5.  **Syncing:** The feature uses the same robust **"last-write-wins"** sync logic as all other sync providers. See the "Sync Logic" section for a detailed explanation.

#### For Developers: Setting Up Your Own Instance

If you are forking or self-hosting FeatherNote, you must obtain your own Google Cloud credentials for the sync feature to work.

1.  **Google Cloud Console:** Create a new project in the [Google Cloud Console](https://console.cloud.google.com/).
2.  **Enable API:** In the "APIs & Services" dashboard, enable the **Google Drive API**.
3.  **Create Credentials:** Go to "Credentials" and create an **OAuth 2.0 Client ID**.
4.  **Configure OAuth Client ID:**
    *   Set the "Application type" to **Web application**.
    *   Under "Authorized JavaScript origins", add the URL where you will host your instance (e.g., `https://notes.example.com`).
    *   For local development, you must also add `http://localhost:7347` (or your specific port).
5.  **Add Client ID to App:**
    *   Copy the generated **Client ID**.
    *   Open the `src/index.js` file.
    *   Find the `GOOGLE_CLIENT_ID` property within the `mainApp` data object and paste your Client ID there.

This process ensures that Google trusts your instance of the application and allows your users to grant it access to their Drive.

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

## Share Note

When you click the share button on a note, it will be published and a shareable link will be generated. You can publish to Nostr or to S3 with a pre-signed URL. If you have both configured, Nostr will be prioritized.

### S3 Pre-signed URL

If you have S3 credentials configured, the note will be uploaded to your S3 bucket and a pre-signed URL will be generated. This URL will be valid for 7 days and can be shared with anyone. The note content will be publicly accessible to anyone with the link.

To configure S3, go to the settings and enter your S3 bucket, region, and credentials. Make sure the S3 bucket has the correct permissions to allow public access to the files.

Once you have configured S3, you can share a note by clicking the share button. A pre-signed URL will be generated and copied to your clipboard.
