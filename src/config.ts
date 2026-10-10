const HOME = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
const BASE_DIR = `${HOME}/.feathernote`;

export const PATHS = {
  base: BASE_DIR,
  notes: `${BASE_DIR}/notes`,
  credentials: `${BASE_DIR}/credentials.json`,
  config: `${BASE_DIR}/config.json`,
} as const;

export function ensureDirs() {
  try { Deno.mkdir(PATHS.base, { recursive: true }); } catch {}
  try { Deno.mkdir(PATHS.notes, { recursive: true }); } catch {}
}
