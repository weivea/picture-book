// .claude/skills/image-generation/scripts/lib/ref-image.ts
//
// Reference-image validation helpers for /edits multipart upload.
// Detect mime by magic bytes; reject anything that isn't PNG or JPEG.
// Size cap (50 MB) matches Azure server-side limit so we fail fast.

export type RefMime = "image/png" | "image/jpeg";

export const MAX_REF_BYTES = 50 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

function startsWith(buf: Buffer, magic: readonly number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

export function detectRefMime(buf: Buffer): RefMime | null {
  if (startsWith(buf, PNG_MAGIC)) return "image/png";
  if (startsWith(buf, JPEG_MAGIC)) return "image/jpeg";
  return null;
}
