import { parse as yamlParse, stringify as yamlStringify } from "npm:yaml@2.6.1";
import { PATHS } from "./config.ts";

export interface NoteFile {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  priority?: number;
  reminder?: string;
  bodyEncoded?: boolean;
  isEncrypted?: boolean;
}

const FRONTMATTER_FIELDS = [
  "id",
  "title",
  "createdAt",
  "updatedAt",
  "tags",
  "priority",
  "reminder",
  "bodyEncoded",
  "isEncrypted",
];

export function generateUniqueId(title: string): string {
  const slug = title
    ?.toLowerCase()
    ?.replace(/[^a-z0-9\s]/g, "")
    ?.replace(/\s/g, "-")
    ?.slice(0, 80) || "";
  const ts = Date.now().toString(36).substr(4);
  const rnd = Math.random().toString(36).substring(2, 6);
  return `${slug}-${ts}${rnd}`.replace(/-$/, "");
}

function nowISO(): string {
  return new Date().toISOString();
}

export function noteToFile(note: NoteFile): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${note.id}`);
  lines.push(`title: ${note.title.replace(/:/g, "-")}`);
  lines.push(`updatedAt: ${note.updatedAt}`);
  if (note.createdAt) lines.push(`createdAt: ${note.createdAt}`);
  if (note.priority) lines.push(`priority: ${note.priority}`);
  if (note.reminder) lines.push(`reminder: ${note.reminder}`);
  if (note.bodyEncoded !== undefined) lines.push(`body_encoded: ${note.bodyEncoded}`);
  if (note.isEncrypted !== undefined) lines.push(`is_encrypted: ${note.isEncrypted}`);
  if (note.tags && note.tags.length > 0) {
    lines.push(`tags: [${note.tags.join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(note.content);
  return lines.join("\n");
}

export function fileToNote(text: string): NoteFile | null {
  const match = text.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]+---\s*([\s\S]*)$/);
  if (!match) return null;

  const yamlBlock = match[1];
  const body = (match[2] || "").trim();

  const metadata: Record<string, unknown> = {};
  yamlBlock.split("\n").forEach((line) => {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) return;
    const key = line.slice(0, colonIndex).trim();
    let raw = line.slice(colonIndex + 1).trim();
    let value: unknown = raw;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      value = raw.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
    } else if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      value = raw.slice(1, -1);
    }
    metadata[key] = value;
  });

  // Parse createdAt/updatedAt safely
  const parseDate = (v: unknown): string => {
    if (typeof v === "string") return v;
    return "";
  };

  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];

  return {
    id: String(metadata.id || ""),
    title: String(metadata.title || "Untitled"),
    content: body,
    createdAt: parseDate(metadata.createdAt),
    updatedAt: parseDate(metadata.updatedAt),
    tags,
    priority: typeof metadata.priority === "number" ? metadata.priority : undefined,
    reminder: typeof metadata.reminder === "string" ? metadata.reminder : undefined,
    bodyEncoded: metadata.body_encoded !== false,
    isEncrypted: metadata.is_encrypted === "true" || metadata.is_encrypted === true,
  };
}

export async function listLocalNotes(): Promise<NoteFile[]> {
  ensureDirSync();
  const entries = [];
  try {
    for await (const entry of Deno.readDir(PATHS.notes)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const text = await Deno.readTextFile(`${PATHS.notes}/${entry.name}`);
      const note = fileToNote(text);
      if (note) entries.push(note);
    }
  } catch {
    // directory may not exist
  }
  entries.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return entries;
}

export async function readNote(id: string): Promise<NoteFile | null> {
  ensureDirSync();
  try {
    const text = await Deno.readTextFile(`${PATHS.notes}/${id}.md`);
    return fileToNote(text);
  } catch {
    return null;
  }
}

export async function writeNote(note: NoteFile): Promise<void> {
  ensureDirSync();
  const text = noteToFile(note);
  await Deno.writeTextFile(`${PATHS.notes}/${note.id}.md`, text);
}

export async function createNote(title: string): Promise<NoteFile> {
  const id = generateUniqueId(title);
  const now = nowISO();
  return {
    id,
    title: title || "Untitled",
    content: "",
    createdAt: now,
    updatedAt: now,
    tags: [],
  };
}

export async function deleteNote(id: string): Promise<boolean> {
  ensureDirSync();
  try {
    await Deno.remove(`${PATHS.notes}/${id}.md`);
    return true;
  } catch {
    return false;
  }
}

function ensureDirSync(): void {
  try { Deno.mkdir(PATHS.notes, { recursive: true }); } catch {}
}
