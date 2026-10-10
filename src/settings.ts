import { PATHS } from "./config.ts";
import { parse as yamlParse } from "npm:yaml@2.6.1";

// --- Base64 helpers (Deno-compatible) ---
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Crypto (reuse PWA's decryptSettings flow exactly) ---
async function getKey(userId: string, salt: Uint8Array<ArrayBuffer>) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(userId),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export interface Credentials {
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3Subfolder?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  nostrPrivateKey?: string;
  pinataJwt?: string;
  pinataApiKey?: string;
  pinataSecretApiKey?: string;
  ipfsGateway?: string;
  useDirectIpfs?: boolean;
  disableIPFS?: boolean;
  ipfsRootCid?: string;
  aiApiKey?: string;
  aiApiRoute?: string;
  aiModel?: string;
  firebaseConfig?: string;
  firebaseVapidKey?: string;
  firebaseScheduleUrl?: string;
  gitRepoUrl?: string;
  gitBranch?: string;
  gitUsername?: string;
  gitToken?: string;
  gitCorsProxy?: string;
  gitEmail?: string;
  githubGistToken?: string;
  gistPublic?: boolean;
  gistDescription?: string;
}

export interface EncryptedSettingsPackage {
  salt: string;
  iv: string;
  content: string;
}

export async function decryptSettings(
  encryptedString: string,
  userId = "anonymous",
): Promise<Credentials | null> {
  try {
    const { salt: saltB64, iv: ivB64, content: contentB64 } =
      JSON.parse(encryptedString) as EncryptedSettingsPackage;

    const salt = new Uint8Array(base64ToBuffer(saltB64)) as Uint8Array<ArrayBuffer>;
    const iv = new Uint8Array(base64ToBuffer(ivB64)) as Uint8Array<ArrayBuffer>;
    const content = base64ToBuffer(contentB64);

    const key = await getKey(userId, salt);

    const decryptedContent = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      content,
    );

    const dec = new TextDecoder();
    const credentials = JSON.parse(dec.decode(decryptedContent));

    // Normalize fields (same as PWA's decryptSettings)
    credentials.s3Region = credentials.s3Region || credentials.region || "";
    credentials.s3Bucket = credentials.s3Bucket || credentials.bucket || "";
    credentials.s3Endpoint = credentials.s3Endpoint || credentials.endpoint || "";
    credentials.s3Subfolder = credentials.s3Subfolder || credentials.subfolder || "";
    credentials.nostrPrivateKey = credentials.nostrPrivateKey || "";
    credentials.aiApiKey = credentials.aiApiKey || "";
    credentials.aiApiRoute = credentials.aiApiRoute || "";
    credentials.aiModel = credentials.aiModel || "";

    return credentials as Credentials;
  } catch (error) {
    return null;
  }
}

export async function loadCredentials(): Promise<{ creds: Credentials; userId: string } | null> {
  try {
    const encoded = await Deno.readTextFile(PATHS.credentials);
    const data = JSON.parse(encoded) as Credentials & { _userId?: string };
    return { creds: data as Credentials, userId: data._userId || "anonymous" };
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await Deno.writeTextFile(
    PATHS.credentials,
    JSON.stringify(creds, null, 2),
  );
}

export async function initFromSettingsExport(
  encryptedString: string,
  userId = "anonymous",
): Promise<Credentials | null> {
  const creds = await decryptSettings(encryptedString, userId) as Credentials & { _userId?: string };
  if (!creds) return null;
  // Store the userId used for encryption so we can decrypt later
  creds._userId = userId;
  await saveCredentials(creds as Credentials);
  return creds as Credentials;
}
