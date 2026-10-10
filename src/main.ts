import { parseArgs } from "jsr:@std/cli@^1.0.0/parse-args";
import { ensureDirs, PATHS } from "./config.ts";
import { initFromSettingsExport, loadCredentials, saveCredentials } from "./settings.ts";
import { listLocalNotes, readNote, writeNote, createNote, deleteNote, generateUniqueId } from "./notes.ts";
import { editWithEditor } from "./editor.ts";
import { syncNotes, listRemoteNotes, type RemoteNoteMeta } from "./s3sync.ts";
import { Credentials } from "./settings.ts";

async function cmdInit(args: string[]) {
  ensureDirs();

  // userId is optional: pass as first arg after 'init', or via FEAUTHUSER_ID env
  const userId = args[0] && !args[0].startsWith("-")
    ? args[0]
    : Deno.env.get("FEATHERNOTE_USER_ID") || "anonymous";

  // Check for exported settings string via env var or file
  let encryptedString = Deno.env.get("FEATHERNOTE_SETTINGS");
  if (!encryptedString) {
    // Check if settings-export.txt / settings.json exists
    const candidates = [
      "./settings-export.txt",
      "./settings.json",
      `${PATHS.base}/settings-export.txt`,
    ];
    for (const c of candidates) {
      try {
        encryptedString = await Deno.readTextFile(c);
        break;
      } catch {}
    }
  }

  if (!encryptedString) {
    console.log("Usage:");
    console.log("  FEATHERNOTE_SETTINGS='<encrypted-json>' feathernote init [userId]");
    console.log("  OR place settings-export.txt / settings.json in current dir");
    console.log("");
    console.log("The encrypted string is the exported settings from the PWA");
    console.log("(copy from Settings > Export in the web app).");
    console.log("");
    console.log("If your PWA uses a Google user ID, pass it as the first arg or set");
    console.log("FEATHERNOTE_USER_ID so decryption uses the same identity.");
    return 1;
  }

  const trimmed = encryptedString.trim();

  // Also accept a file path if it looks like a path
  let source = "FEATHERNOTE_SETTINGS env var";
  if (trimmed.startsWith("./") || trimmed.startsWith("/")) {
    try {
      encryptedString = await Deno.readTextFile(trimmed);
      source = trimmed;
    } catch {
      console.error(`Cannot read file: ${trimmed}`);
      return 1;
    }
  }

  console.log(`Decrypting settings from ${source} (userId: ${userId})...`);
  const creds = await initFromSettingsExport(trimmed, userId);
  if (!creds) {
    console.error("Failed to decrypt settings. Check userId and encrypted string.");
    return 1;
  }

  console.log("Settings decrypted and saved to", PATHS.credentials);
  console.log(`  S3 Bucket: ${creds.s3Bucket || "none"}`);
  console.log(`  S3 Region: ${creds.s3Region || "none"}`);
  console.log(`  Nostr Key: ${creds.nostrPrivateKey ? "set" : "none"}`);
  console.log(`  Git Repo: ${creds.gitRepoUrl || "none"}`);
  return 0;
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
  feathernote init              Decrypt PWA settings export and save credentials
  feathernote list              List all local notes
  feathernote new [title]       Create a new note, open $EDITOR
  feathernote edit <id>         Open existing note in $EDITOR
  feathernote sync              Sync local notes with S3 (upload/download)
  feathernote delete <id>       Delete a note locally and from S3

Settings:
  The PWA exports an encrypted settings string (Settings > Export).
  Pass it via:
    FEATHERNOTE_SETTINGS='<encrypted-json>' feathernote init
  Or save it to settings.json and run: feathernote init

Credentials are stored in ~/.feathernote/credentials.json (decrypted).

Notes are stored as Markdown files in ~/.feathernote/notes/<id>.md
with YAML frontmatter matching the PWA Git provider format.
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

  // Simple arg parsing
  const parsed = parseArgs(args.slice(1), {
    string: ["title"],
    boolean: false,
  }) as { title?: string; [key: string]: unknown };

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
