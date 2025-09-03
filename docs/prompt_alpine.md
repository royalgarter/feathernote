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
   5. Update `.gitignore`: I'll add the v2/ directory to the .gitignore file.

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
Fix below errors:
1. Uncaught TypeError: Cannot read properties of undefined (reading 'processSharedContent')
    at index.js:270:40
    at cdn.min.js:5:5713
    at je (cdn.min.js:5:5770)
    at cdn.min.js:5:5675

2. Uncaught TypeError: Cannot read properties of undefined (reading 'isSyncing')

3. Uncaught TypeError: Cannot read properties of undefined (reading 'user')