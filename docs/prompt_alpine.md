Current this code base is using React NextJS. I want to build new version v2 for this App using AlpineJS, with all other logic for client side is kept

- `index.html` (that contains all the UI `src/components`,`src/contexts`, inherit main components NoteCard, SettingsDialog, UserProfile, SWRegistration. Load AlpineJS and TailwindCSS (and Heroicons) from CDN
- `index.js` (includes all the AlpineJS logic for client side (that should includes all logic in `src/lib`)
- `server.js` is implemented for the server side purely in Deno (http server) or Node ExpressJS
- Remove all the next packages, react packages, genkit AI. 

Draft me a plan to build version v2. First, you also need to re-list all features of this app. Then plan to implement step by step.

---

Okay, here is the plan to build the v2 of your application.

  Phase 1: Project Setup & Scaffolding

   1. Create `v2` directory: I will create a v2 directory to house the new application, keeping it
      separate from the existing Next.js code.
   2. Create `v2/index.html`: This will be the main entry point, including CDN links for TailwindCSS,
      AlpineJS, and Heroicons, along with the basic UI structure.
   3. Create `v2/index.js`: This file will contain the client-side logic using AlpineJS.
   4. Create `v2/server.js`: A simple Deno/Node.js with Express server to serve the files and provide
      API endpoints.

  Phase 2: UI & Logic Migration

   1. Translate React Components: I will convert the React components from src/components into HTML
      with TailwindCSS classes in v2/index.html, and wire them up with AlpineJS.
   2. Port Client-Side Logic: The logic from src/lib, src/contexts, and src/hooks will be migrated to
      v2/index.js and adapted for AlpineJS.

  Phase 3: Backend Implementation

   1. Create API Endpoints: I will implement the necessary API endpoints in v2/server.js for features
      like authentication and note management.

  Phase 4: Cleanup

   1. Remove Old Code: Once v2 is functional, I will remove the Next.js/React dependencies and the old
      src directory.
   2. Update Documentation: I will update the README.md to reflect the new architecture.

  I will now begin with Phase 1. Do you approve this plan?

---
I've thoroughly reviewed v2/index.html and v2/index.js for x-data scope errors. All properties and
  methods are now correctly referenced within the single mainApp() scope, and intentional local
  x-data scopes are properly implemented. The consolidation appears robust.

  Next steps for completing the v2 migration:

   1. Testing: Thoroughly test the application:
       * Start the server (node v2/server.js).
       * Open http://localhost:3000 in your browser.
       * Verify notes can be added, edited (including reminders), and deleted.
       * Test Google Sign-in/Sign-out.
       * Configure S3 credentials in settings and test synchronization.
       * Test the import/export functionality for settings.
       * Test the shared content import (via PWA share target).
   2. Refinement:
       * Improve UI/UX where needed.
       * Consider adding a loading indicator for loading on the main page.
   3. Cleanup (Phase 4):
       * Remove Next.js and React dependencies from package.json.
       * Delete the old src directory.
       * Update README.md with instructions for running v2.
       * Delete `v2/note.html` (as requested by the user).

  I will now provide instructions on how to run the application for testing.

---

Excellent, I will now analyze the Alpine.js version of your application in the /v2
  directory to identify potential bugs.

  Code Review and Bug Analysis: v2/index.html & v2/index.js

  After a careful walkthrough of the code, I've identified several potential issues,
  ranging from security vulnerabilities to user experience and robustness problems.

  High-Priority Issues:

   1. Critical Security Flaw: No JWT Signature Validation:
       * Problem: The jwtDecode function in index.js only decodes the payload of the Google
         ID token. It does not validate the cryptographic signature. This means a malicious
         actor could create a fake token with any user data they want, and the application
         would accept it as legitimate, granting them access to the app and potentially
         other users' data if the user ID is used for data separation.
       * Impact: High. This completely undermines the security of your authentication
         system.
       * Recommendation: The signature MUST be validated. The standard way to do this on the
          client-side is to fetch Google's public keys (JWKs) and use the Web Crypto API to
         verify the token's signature.

   2. Data Loss Potential: No Conflict Resolution in Sync:
       * Problem: The syncNotes function sends all local notes to the server and receives a
         list of updated notes back. This process does not account for scenarios where a
         note has been edited on two different devices since the last sync. The current
         logic appears to be a simple "server wins" or "client wins" model, which is not
         explicitly defined and can easily lead to data loss.
       * Impact: High. Users could lose their work without warning.
       * Recommendation: Implement a "last-write-wins" strategy. When syncing, compare the
         updatedAt timestamp for each note. The note with the most recent timestamp is kept.
         This logic needs to be implemented on both the client and the server (server.js) to
         be effective.

  Medium-Priority Issues:

   3. Poor UX and Security: `secretAccessKey` Handling:
       * Problem: The AWS secretAccessKey is treated like a regular input field. It is
         cleared every time the settings dialog is opened, forcing the user to re-enter it
         to save any changes. It is also stored in memory as a plain string.
       * Impact: Medium. This creates a frustrating user experience and is a minor security
         risk.
       * Recommendation: The input should be a password field. When saving, if the field is
         blank, the application should retain the previously saved key. The key should not
         be re-displayed in the UI after being set.

   4. Brittle Error Handling in `syncNotes`:
       * Problem: The sync error handling relies on string matching
         (error.message.includes(...)) to identify CORS or network failures. This is
         unreliable as error messages can change between browser versions or libraries.
       * Impact: Medium. The app may fail to provide clear and correct error messages to the
         user, making debugging difficult.
       * Recommendation: Check for error.name (e.g., TypeError for network failures) or use
         a more structured way to handle different error types returned from the fetch API.

  Low-Priority & Code Quality Issues:

   5. Hardcoded `GOOGLE_CLIENT_ID`: This should be externalized into a configuration object
      or file for better maintainability.
   6. Potential Race Condition in `initDB`: Multiple simultaneous calls to initDB when the
      app starts could lead to unexpected behavior. The initialization should be managed
      with a single promise.
   7. Stale Caching Strategy: The service worker's "cache-first" strategy means users might
      not get the latest version of the app's code immediately after an update. A
      "stale-while-revalidate" strategy would be more appropriate.
   8. Missing Input Validation: There is no client-side validation for the S3 settings,
      which could lead to confusing errors from the backend.
   9. Lack of Visual Feedback: The UI doesn't clearly indicate when a manual sync is in
      progress.