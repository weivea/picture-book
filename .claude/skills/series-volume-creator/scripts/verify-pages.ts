import { stat } from "fs/promises";
import { join } from "path";

const MIN_BYTES = 100 * 1024; // <100KB → suspect failure (per spec §6.3 + parent doc)

export interface VerifyResult {
  ok: number[];
  failed: { page: number; reason: string }[];
}

/** Check that volumeDir/<n>.png exists for n in [0, totalPages] and is >100KB. */
export async function verifyPages(volumeDir: string, totalPages: number): Promise<VerifyResult> {
  const ok: number[] = [];
  const failed: { page: number; reason: string }[] = [];
  for (let n = 0; n < totalPages; n++) {
    const p = join(volumeDir, `${n}.png`);
    try {
      const s = await stat(p);
      if (s.size < MIN_BYTES) {
        failed.push({ page: n, reason: `too small (${s.size} < ${MIN_BYTES} bytes)` });
      } else {
        ok.push(n);
      }
    } catch {
      failed.push({ page: n, reason: "missing file" });
    }
  }
  return { ok, failed };
}
