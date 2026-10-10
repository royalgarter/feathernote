import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NoteFile, noteToFile, noteToS3File, fileToNote, generateUniqueId } from "./notes.ts";
import { Credentials } from "./settings.ts";
import { PATHS } from "./config.ts";

export interface RemoteNoteMeta {
  id: string;
  path: string;
  updatedAt: string;
  source: "s3";
}

export interface SyncResult {
  uploaded: string[];
  downloaded: string[];
  deleted: string[];
  error?: string;
}

function getS3Client(creds: Credentials): S3Client {
  return new S3Client({
    region: creds.s3Region || (creds.s3Endpoint ? "auto" : "us-east-1"),
    endpoint: creds.s3Endpoint || undefined,
    credentials: creds.accessKeyId && creds.secretAccessKey
      ? { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey }
      : undefined,
    forcePathStyle: !!creds.s3Endpoint,
  });
}

function getNoteKey(noteId: string, creds: Credentials): string {
  const sub = creds.s3Subfolder ? `${creds.s3Subfolder.replace(/\/$/, "")}/` : "";
  return `${sub}${noteId}.json`;
}

export async function listRemoteNotes(creds: Credentials): Promise<RemoteNoteMeta[]> {
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) {
    return [];
  }

  const client = getS3Client(creds);
  const prefix = creds.s3Subfolder ? `${creds.s3Subfolder.replace(/\/$/, "")}/` : "";
  const notes: RemoteNoteMeta[] = [];

  try {
    let continuationToken: string | undefined;
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: creds.s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const resp = await client.send(cmd);

      const contents = resp.Contents || [];
      for (const item of contents) {
        if (!item.Key || item.Key.endsWith("/") || !item.Key.includes(".json") || item.Key.includes("/images/") || item.Key.endsWith("deleted-notes.json")) {
          continue;
        }
        const relativeKey = item.Key.replace(prefix, "").replace(/\.json$/, "");
        notes.push({
          id: relativeKey.split("/").pop() || "",
          path: relativeKey,
          updatedAt: item.LastModified?.toISOString() || new Date().toISOString(),
          source: "s3",
        });
      }
      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);
  } catch (err: any) {
    console.error("S3 list error:", err.message);
    return [];
  }

  return notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function downloadNote(meta: RemoteNoteMeta, creds: Credentials): Promise<NoteFile | null> {
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) return null;

  const client = getS3Client(creds);
  const prefix = creds.s3Subfolder ? `${creds.s3Subfolder.replace(/\/$/, "")}/` : "";
  const key = `${prefix}${meta.path}.json`;

  try {
    const cmd = new GetObjectCommand({ Bucket: creds.s3Bucket, Key: key });
    const resp = await client.send(cmd);
    const body = await streamToString(resp.Body);
    if (!body) return null;
    const note = fileToNote(body);
    if (note) {
      note.updatedAt = meta.updatedAt;
    }
    return note;
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.name === "NotFound") return null;
    console.error(`S3 download error for ${meta.id}:`, err.message);
    return null;
  }
}

function getPwaNoteKey(note: NoteFile, creds: Credentials): string {
  const d = new Date(note.createdAt || note.updatedAt || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const sub = creds.s3Subfolder ? `${creds.s3Subfolder.replace(/\/$/, "")}/` : "";
  return `${sub}${y}/${m}/${day}/${note.id}.json`;
}

export async function uploadNote(note: NoteFile, creds: Credentials): Promise<boolean> {
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) return false;

  const client = getS3Client(creds);
  const key = getPwaNoteKey(note, creds);
  const body = noteToS3File(note);

  try {
    const cmd = new PutObjectCommand({
      Bucket: creds.s3Bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    });
    await client.send(cmd);
    return true;
  } catch (err: any) {
    console.error(`S3 upload error for ${note.id}:`, err.message);
    return false;
  }
}

export async function deleteNoteFromS3(noteId: string, creds: Credentials): Promise<boolean> {
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) return false;

  const client = getS3Client(creds);
  const sub = creds.s3Subfolder ? `${creds.s3Subfolder.replace(/\/$/, "")}/` : "";
  const key = `${sub}${noteId}.json`;

  try {
    const cmd = new DeleteObjectCommand({ Bucket: creds.s3Bucket, Key: key });
    await client.send(cmd);
    return true;
  } catch (err: any) {
    console.error(`S3 delete error for ${noteId}:`, err.message);
    return false;
  }
}

async function streamToString(body: any): Promise<string | null> {
  if (!body) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    if (chunk) chunks.push(chunk as Uint8Array);
  }
  const buf = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(buf);
}

export async function syncNotes(
  localNotes: NoteFile[],
  creds: Credentials,
): Promise<SyncResult> {
  const result: SyncResult = { uploaded: [], downloaded: [], deleted: [] };

  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.s3Bucket) {
    console.log("No S3 credentials configured, skipping sync.");
    return result;
  }

  // 1. List remote state
  const remoteMetas = await listRemoteNotes(creds);
  const remoteMap = new Map(remoteMetas.map((m) => [m.id, m]));
  const remoteIds = new Set(remoteMetas.map((m) => m.id));

  // 2. Determine uploads (local newer than remote)
  for (const local of localNotes) {
    const remote = remoteMap.get(local.id);
    const localDate = new Date(local.updatedAt);
    const remoteDate = remote ? new Date(remote.updatedAt).getTime() : 0;

    if (!remote || localDate.getTime() > remoteDate) {
      if (await uploadNote(local, creds)) {
        result.uploaded.push(local.id);
      }
    }
  }

  // 3. Determine downloads (remote newer than local) — batched parallel
  const localMap = new Map(localNotes.map((n) => [n.id, n]));
  const toDownload = remoteMetas.filter((remote) => {
    const local = localMap.get(remote.id);
    if (!local) return true;
    return new Date(remote.updatedAt) > new Date(local.updatedAt);
  });

  const BATCH = 10;
  for (let i = 0; i < toDownload.length; i += BATCH) {
    const batch = toDownload.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (remote) => {
        const note = await downloadNote(remote, creds);
        if (note) {
          const saved = await saveRemoteNote(note);
          if (saved) result.downloaded.push(note.id);
        }
      }),
    );
    for (const r of results) {
      if (r.status === "rejected") console.error("Download failed:", r.reason);
    }
  }

  // 4. Determine deletions (gone from remote, not locally new)
  const uploadedIds = new Set(result.uploaded);
  for (const local of localNotes) {
    if (!remoteIds.has(local.id) && !uploadedIds.has(local.id)) {
      // Deleted on remote, remove locally
      await deleteNoteFromS3(local.id, creds);
      // We don't delete local file here — user may want it.
      // Just note it for awareness.
      result.deleted.push(local.id);
    }
  }

  return result;
}

async function saveRemoteNote(note: NoteFile): Promise<boolean> {
  try {
    await Deno.writeTextFile(
      `${PATHS.notes}/${note.id}.md`,
      noteToFile(note),
    );
    return true;
  } catch {
    return false;
  }
}
