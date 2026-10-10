import { parse as yamlParse, stringify as yamlStringify } from "npm:yaml@2.6.1";
import { PATHS } from "./config.ts";

function parseYamlFront(yamlBlock: string): Record<string, unknown> | null {
  try {
    const parsed = yamlParse(yamlBlock);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {}

  const metadata: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) { i++; continue; }
    const key = line.slice(0, colonIndex).trim();
    let raw = line.slice(colonIndex + 1).trim();
    if (raw.startsWith('"')) {
      const quoteCount = (raw.match(/"/g) || []).length;
      if (quoteCount < 2 && i + 1 < lines.length) {
        i++;
        raw += "\n" + lines[i];
        while (!raw.endsWith('"') && i + 1 < lines.length) {
          i++;
          raw += "\n" + lines[i];
        }
      }
      const inner = raw.slice(1, -1);
      try { metadata[key] = JSON.parse('"' + inner + '"'); } catch {
        metadata[key] = inner.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else if (raw.startsWith("'")) {
      while (!raw.endsWith("'") && i + 1 < lines.length) {
        i++;
        raw += "\n" + lines[i];
      }
      metadata[key] = raw.slice(1, -1);
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      metadata[key] = raw.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
    } else {
      metadata[key] = raw;
    }
    i++;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

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

function decodeBase64UTF8(b64: string): string {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return b64;
  }
}

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

function encodeUTF8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function noteToFile(note: NoteFile): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${note.id}`);
  lines.push(`title: ${note.title.replace(/:/g, "-")}`);
  lines.push(`updatedAt: ${note.updatedAt}`);
  if (note.createdAt) lines.push(`createdAt: ${note.createdAt}`);
  if (note.priority) lines.push(`priority: ${note.priority}`);
  if (note.reminder) lines.push(`reminder: ${note.reminder}`);
  lines.push(`body_encoded: false`);
  if (note.isEncrypted !== undefined) lines.push(`is_encrypted: ${note.isEncrypted}`);
  if (note.tags && note.tags.length > 0) {
    lines.push(`tags: [${note.tags.join(", ")}]`);
  }
  lines.push("---");
  lines.push("");
  lines.push(note.content);
  return lines.join("\n");
}

export function noteToS3File(note: NoteFile): string {
  const obj: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    content: encodeUTF8ToBase64(note.content || ""),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: note.tags || [],
    priority: note.priority ?? 0,
    bodyEncoded: true,
    isEncrypted: note.isEncrypted === true,
    body_encoding: "base64",
  };
  if (note.reminder) obj.reminder = note.reminder;
  return yamlStringify(obj);
}

export function fileToNote(text: string): NoteFile | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      return {
        id: String(obj.id || ""),
        title: String(obj.title || "Untitled"),
        content: String(obj.content || obj.body || ""),
        createdAt: String(obj.createdAt || ""),
        updatedAt: String(obj.updatedAt || ""),
        tags: Array.isArray(obj.tags) ? obj.tags : [],
        priority: typeof obj.priority === "number" ? obj.priority : undefined,
        reminder: typeof obj.reminder === "string" ? obj.reminder : undefined,
        bodyEncoded: obj.bodyEncoded !== false,
        isEncrypted: obj.isEncrypted === true,
      };
    } catch {}
  }

  const fmMatch = trimmed.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]+---\s*([\s\S]*)$/);
  let yamlBlock: string;
  let rawBody: string;

  let metadata: Record<string, unknown>;
  if (fmMatch) {
    metadata = parseYamlFront(fmMatch[1]) || {};
    rawBody = (fmMatch[2] || "").trim();
  } else {
    const parsed = parseYamlFront(trimmed);
    if (!parsed || Object.keys(parsed).length === 0) return null;
    metadata = parsed;
    rawBody = "";
  }

  const bodyEncoded = metadata.body_encoded !== false;
  let body: string;
  if (metadata.body_base64) {
    body = decodeBase64UTF8(String(metadata.body_base64 || ""));
  } else if (metadata.body_encoding === "base64") {
    body = decodeBase64UTF8(String(metadata.content || ""));
  } else {
    body = rawBody || String(metadata.content || "");
  }

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
    bodyEncoded,
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

export async function normalizeLocalNotes(): Promise<number> {
  ensureDirSync();
  let count = 0;
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(PATHS.notes)) {
      if (entry.isFile && entry.name.endsWith(".md")) names.push(entry.name);
    }
  } catch {
    return 0;
  }
  for (const name of names) {
    const text = await Deno.readTextFile(`${PATHS.notes}/${name}`);
    const note = fileToNote(text);
    if (!note) continue;
    const normalized = noteToFile(note);
    if (normalized !== text) {
      await Deno.writeTextFile(`${PATHS.notes}/${name}`, normalized);
      count++;
    }
  }
  return count;
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
