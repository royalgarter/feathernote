import { NoteFile, noteToFile, fileToNote } from "./notes.ts";

export interface EditorResult {
  note: NoteFile;
  changed: boolean;
  cancelled: boolean;
}

export async function editWithEditor(note: NoteFile): Promise<EditorResult> {
  const editor = Deno.env.get("EDITOR") || "nano";
  const filePath = `${Deno.cwd()}/.feathernote-edit-${note.id}.md`;

  // Write current content to temp file
  const initialContent = noteToFile(note);
  await Deno.writeTextFile(filePath, initialContent);

  // Spawn editor and wait for it to exit
  const status = await runEditor(editor, filePath);

  // Read back the file
  let newNote: NoteFile;
  try {
    const text = await Deno.readTextFile(filePath);
    const parsed = fileToNote(text);
    if (!parsed) {
      // If frontmatter is broken, keep original note structure but update content
      newNote = {
        ...note,
        content: text,
        updatedAt: new Date().toISOString(),
      };
    } else {
      // Preserve id, createdAt; update title from frontmatter if changed
      newNote = {
        ...note,
        ...parsed,
        id: note.id, // keep original id
        createdAt: note.createdAt, // preserve original createdAt
        updatedAt: new Date().toISOString(),
      };
    }
  } catch {
    // File may have been deleted by editor
    newNote = note;
  } finally {
    // Clean up temp file
    try { await Deno.remove(filePath); } catch {}
  }

  const changed =
    newNote.content !== note.content ||
    newNote.title !== note.title ||
    JSON.stringify(newNote.tags) !== JSON.stringify(note.tags);

  return { note: newNote, changed, cancelled: status !== 0 };
}

function runEditor(editor: string, filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const parts = editor.split(/\s+/);
    const exe = parts[0];
    const args = parts.slice(1).concat([filePath]);

    const proc = new Deno.Command(exe, {
      args,
      stdout: "inherit",
      stderr: "inherit",
    });

    proc.output().then(
      (out) => resolve(out.code),
      () => resolve(1),
    );
  });
}
