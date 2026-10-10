import { parseArgs } from "node:util";
import { ensureDirs, PATHS } from "./config.ts";
import { initFromSettingsExport, loadCredentials, saveCredentials } from "./settings.ts";
import { listLocalNotes, readNote, writeNote, createNote, deleteNote, generateUniqueId, normalizeLocalNotes } from "./notes.ts";
import { editWithEditor } from "./editor.ts";
import { syncNotes, listRemoteNotes, type RemoteNoteMeta } from "./s3sync.ts";
import { Credentials } from "./settings.ts";

const USER_ID_GUIDE = `
That didn't unlock — no worries, this just means your settings were
saved while you were signed in with Google, so I need your User ID
to unlock them (it's just a long number, not your password).

To find it (takes about 20 seconds):
  1. On the device where FeatherNote already works, open FeatherNote
     in your browser and check you're signed in — you should see
     your profile picture at the top.
  2. Click the gear (Settings) at the top, then click "Export".
  3. You'll see a box labelled "Your User ID (needed for the CLI)".
     Click Copy next to it.
  4. Come back here and paste it when asked.
`;

async function cmdInit(args: string[]) {
  ensureDirs();

  // userId from --user-id/-u flag, positional arg, or FEATHERNOTE_USER_ID env
  let flagUserId: string | undefined;
  let noPrompt = false;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--user-id" || args[i] === "-u") && args[i + 1]) {
      flagUserId = args[++i];
    } else if (args[i].startsWith("--user-id=")) {
      flagUserId = args[i].slice("--user-id=".length);
    } else if (args[i] === "--no-prompt") {
      noPrompt = true;
    } else if (!args[i].startsWith("-")) {
      positionals.push(args[i]);
    }
  }
  let userId = flagUserId
    || (positionals[0] ? positionals[0] : undefined)
    || Deno.env.get("FEATHERNOTE_USER_ID")
    || "anonymous";

  // Check for exported settings string via env var or file
  let encryptedString = Deno.env.get("FEATHERNOTE_SETTINGS");
  let source = "FEATHERNOTE_SETTINGS env var";
  if (!encryptedString) {
    // Check if settings-export.txt / settings.json exists
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "~";
    const candidates: Array<[string, string]> = [
      ["./settings-export.txt", "./settings-export.txt"],
      ["./settings.json", "./settings.json"],
      [`${PATHS.base}/settings-export.txt`, `${PATHS.base}/settings-export.txt`],
      [`${PATHS.base}/settings.json`, `${PATHS.base}/settings.json`],
      [`${home}/settings.json`, "~/settings.json"],
    ];
    for (const [path, label] of candidates) {
      try {
        encryptedString = await Deno.readTextFile(path);
        source = label;
        break;
      } catch {}
    }
  }

  if (!encryptedString) {
    console.log("Usage:");
    console.log("  FEATHERNOTE_SETTINGS='<encrypted-json>' feathernote init [--user-id <id>]");
    console.log("  OR place settings-export.txt / settings.json in current dir,");
    console.log("     ~/.feathernote/, or ~/ and run: feathernote init");
    console.log("");
    console.log("The encrypted string is the exported settings from the PWA");
    console.log("(Settings > Export in the web app).");
    console.log("");
    console.log("If your PWA uses Google sign-in, also pass your User ID:");
    console.log("  feathernote init --user-id <id>");
    console.log("or set FEATHERNOTE_USER_ID. Find it in the PWA under");
    console.log("Settings > Export > Your User ID.");
    return 1;
  }

  let trimmed = encryptedString.trim();

  // Also accept a file path if it looks like a path
  if (trimmed.startsWith("./") || trimmed.startsWith("/") || trimmed.startsWith("~")) {
    const expanded = trimmed.startsWith("~")
      ? trimmed.replace(/^~(?=\/|$)/, Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "~")
      : trimmed;
    try {
      trimmed = (await Deno.readTextFile(expanded)).trim();
      source = trimmed === encryptedString.trim() ? source : expanded;
    } catch {
      console.error(`Cannot read file: ${trimmed}`);
      return 1;
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Decrypting settings from ${source} (userId: ${userId})...`);
    const creds = await initFromSettingsExport(trimmed, userId);
    if (creds) {
      console.log("Settings decrypted and saved to", PATHS.credentials);
      console.log(`  S3 Bucket: ${creds.s3Bucket || "none"}`);
      console.log(`  S3 Region: ${creds.s3Region || "none"}`);
      console.log(`  Nostr Key: ${creds.nostrPrivateKey ? "set" : "none"}`);
      console.log(`  Git Repo: ${creds.gitRepoUrl || "none"}`);
      return 0;
    }

    if (noPrompt || !Deno.stdin.isTerminal()) {
      console.error("Failed to decrypt settings: wrong User ID or corrupted export.");
      console.error("Find your User ID in the PWA under Settings > Export > Your User ID,");
      console.error("then run: feathernote init --user-id <id>  (or set FEATHERNOTE_USER_ID).");
      return 1;
    }

    console.log(USER_ID_GUIDE);
    const pasted = prompt("Paste your User ID here (or press Enter to quit):")?.trim();
    if (!pasted) {
      console.error("Cancelled. Run again with: feathernote init --user-id <id>");
      return 1;
    }
    userId = pasted;
  }

  console.error("Still can't unlock after 3 tries. Double-check the User ID in");
  console.error("Settings > Export > Your User ID and try again.");
  return 1;
}

async function cmdList() {
  const loaded = await loadCredentials();
  const creds = loaded?.creds || null;
  const localNotes = await listLocalNotes();

  console.log(`\nLocal notes (${localNotes.length}):\n`);

  if (localNotes.length === 0) {
    console.log("  No notes yet. Create one with: feathernote new [title]\n");
    return 0;
  }

  const maxId = Math.max(...localNotes.map((n) => n.id.length), 36);
  const maxTitle = Math.max(...localNotes.map((n) => n.title.length), 4);

  for (const note of localNotes) {
    let s3Status = "no-s3";
    if (creds?.s3Bucket) {
      try {
        const r = await listRemoteNotes(creds);
        s3Status = r.find((rm) => rm.id === note.id) ? "synced" : "local-only";
      } catch {
        s3Status = "unknown";
      }
    }

    console.log(
      `  ${note.id.padEnd(maxId)} | ${note.title.slice(0, maxTitle).padEnd(maxTitle)} | ${note.updatedAt} | ${s3Status}`,
    );
    if (note.tags.length > 0) {
      console.log(`  ${" ".repeat(maxId + 3)}${note.tags.join(", ")}`);
    }
  }

  console.log("");
  return 0;
}

async function cmdNew(title: string) {
  ensureDirs();
  const note = await createNote(title);
  console.log(`Creating new note: ${note.id}`);
  console.log(`Title: ${note.title}`);

  const result = await editWithEditor(note);

  if (result.cancelled) {
    console.log("Edit cancelled.");
    return 1;
  }

  if (result.changed || !result.note.content) {
    await writeNote(result.note);
    console.log(`Note saved: ${result.note.id}`);
    console.log(`  Path: ${PATHS.notes}/${result.note.id}.md`);
  } else {
    // Empty content, delete the note
    await deleteNote(result.note.id);
    console.log("Empty note discarded.");
  }

  return 0;
}

async function cmdEdit(id: string) {
  ensureDirs();
  const note = await readNote(id);
  if (!note) {
    console.error(`Note not found: ${id}`);
    return 1;
  }

  console.log(`Editing note: ${note.id}`);
  console.log(`Title: ${note.title}`);

  const result = await editWithEditor(note);

  if (result.cancelled) {
    console.log("Edit cancelled.");
    return 1;
  }

  if (result.changed) {
    await writeNote(result.note);
    console.log(`Note updated: ${result.note.id}`);
  } else {
    console.log("No changes.");
  }

  return 0;
}

async function cmdSync() {
  ensureDirs();
  const loaded = await loadCredentials();
  if (!loaded) {
    console.error("No credentials. Run 'feathernote init' first.");
    return 1;
  }
  const creds = loaded.creds;

  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) {
    console.log("S3 not configured. Skipping sync.");
    console.log("Configure S3 in the PWA, export settings, and re-run init.");
    return 0;
  }

  const normalized = await normalizeLocalNotes();
  if (normalized > 0) {
    console.log(`Normalized ${normalized} local note file(s) to plain text.`);
  }

  const localNotes = await listLocalNotes();
  console.log(`Syncing ${localNotes.length} local notes with S3...`);

  const result = await syncNotes(localNotes, creds);

  console.log(`\nSync results:`);
  console.log(`  Uploaded: ${result.uploaded.length} (${[...result.uploaded].join(", ") || "none"})`);
  console.log(`  Downloaded: ${result.downloaded.length} (${[...result.downloaded].join(", ") || "none"})`);
  console.log(`  Deleted (remote): ${result.deleted.length}`);

  if (result.error) {
    console.error("Error:", result.error);
    return 1;
  }

  const after = await normalizeLocalNotes();
  if (after > 0) {
    console.log(`Normalized ${after} downloaded note file(s) to plain text.`);
  }

  return 0;
}

async function cmdDelete(id: string) {
  ensureDirs();
  const note = await readNote(id);
  if (!note) {
    console.error(`Note not found: ${id}`);
    return 1;
  }

  const loaded = await loadCredentials();
  const creds = loaded?.creds || null;

  // Remove from S3 if configured
  if (creds?.accessKeyId && creds?.secretAccessKey && creds?.s3Bucket) {
    const { deleteNoteFromS3 } = await import("./s3sync.ts");
    const removed = await deleteNoteFromS3(id, creds);
    if (removed) console.log(`Removed from S3: ${id}`);
  }

  const removed = await deleteNote(id);
  if (removed) {
    console.log(`Deleted: ${id}`);
  } else {
    console.error(`Failed to delete: ${id}`);
    return 1;
  }

  return 0;
}

async function cmdHelp() {
  console.log(`
feathernote — Deno CLI for Feather Note

Usage:
  feathernote init [--user-id <id>] [--no-prompt]   Decrypt PWA settings export and save credentials
  feathernote list              List all local notes
  feathernote new [title]       Create a new note, open $EDITOR
  feathernote edit <id>         Open existing note in $EDITOR
  feathernote sync              Sync local notes with S3 (upload/download)
  feathernote delete <id>       Delete a note locally and from S3

Settings:
  The PWA exports an encrypted settings string (Settings > Export).
  If you signed in with Google, also copy the "Your User ID" shown
  in that same Export dialog — the CLI needs it to unlock the file.
  Pass it via:
    feathernote init --user-id <id>
    FEATHERNOTE_USER_ID=<id> feathernote init
    FEATHERNOTE_SETTINGS='<encrypted-json>' feathernote init --user-id <id>
  Or save the export to settings.json and run: feathernote init
  (if decryption fails you'll be guided to paste the User ID).

Credentials are stored in ~/.feathernote/credentials.json (decrypted).

Notes are stored as Markdown files in ~/.feathernote/notes/<id>.md
with YAML frontmatter and the note body as plain editable text.
On S3, note bodies are stored base64-encoded (synced automatically).
`);
  return 0;
}

async function main() {
  const args = Deno.args;
  if (args.length === 0) {
    await cmdHelp();
    return;
  }

  const command = args[0];

  // Simple arg parsing (tolerant: unknown flags passed to subcommands)
  const parsed = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    strict: false,
  }) as { positionals: string[]; values: Record<string, unknown> };

  let exitCode = 0;

  switch (command) {
    case "init":
      exitCode = await cmdInit(args.slice(1));
      break;
    case "list":
    case "ls":
      exitCode = await cmdList();
      break;
    case "new":
      exitCode = await cmdNew(args[1] || "");
      break;
    case "edit":
      exitCode = await cmdEdit(args[1] || "");
      break;
    case "sync":
      exitCode = await cmdSync();
      break;
    case "delete":
    case "rm":
      exitCode = await cmdDelete(args[1] || "");
      break;
    case "help":
    case "--help":
    case "-h":
      exitCode = await cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log("Run 'feathernote help' for usage.");
      exitCode = 1;
  }

  Deno.exit(exitCode);
}

await main();
