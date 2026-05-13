// .claude/skills/scene-illustrator/scripts/lib/portrait-manager.ts

import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface AuditResult {
  existing: string[];
  missing: string[];
}

export async function audit(
  anchors: Map<string, string>,
  portraitsDir: string,
): Promise<AuditResult> {
  const existing: string[] = [];
  const missing: string[] = [];
  for (const name of anchors.keys()) {
    const path = join(portraitsDir, `${name}.png`);
    try {
      const s = await stat(path);
      if (s.isFile() && s.size > 0) existing.push(name);
      else missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { existing, missing };
}
