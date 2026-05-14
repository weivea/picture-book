import { readFile, stat } from "fs/promises";
import { join } from "path";
import { loadState } from "../../series-bible-creator/scripts/lib/state";
import { parseSeriesMeta, type SeriesMeta } from "../../series-bible-creator/scripts/series-meta-parse";
import { parseOutline, type OutlineVolume } from "../../series-season-planner/scripts/outline-parse";

export interface VolumeContext {
  seriesRoot: string;
  volumeId: string;
  meta: SeriesMeta;
  world: string;                            // raw markdown
  style: string;                            // raw markdown (composer reads keys from it)
  characters: Map<string, CharacterCard>;   // by name
  season: { id: string; arcMd: string } | null;
  outlineEntry: OutlineVolume | null;
  patch: Map<string, string> | null;        // patch anchors keyed by character name
}

export interface CharacterCard {
  name: string;
  prompt_anchor: string;
  voice_profile?: string;
  appearance?: string;
  negative?: string;
  raw: string;
}

export async function loadVolumeContext(seriesRoot: string, volumeId: string): Promise<VolumeContext> {
  const state = await loadState(seriesRoot);
  if (!state.bible.frozen_at) throw new Error("Series bible is not frozen — run series-bible-creator first");

  const meta = parseSeriesMeta(await readFile(join(seriesRoot, "bible", "series-meta.md"), "utf-8"));
  const world = await readFile(join(seriesRoot, "bible", "world.md"), "utf-8");
  const style = await readFile(join(seriesRoot, "bible", "style.md"), "utf-8");
  const charactersMd = await readFile(join(seriesRoot, "bible", "characters.md"), "utf-8");
  const characters = parseCharacters(charactersMd);

  // Resolve season + outline entry.
  let season: VolumeContext["season"] = null;
  let outlineEntry: OutlineVolume | null = null;

  // Volume id pattern "sNvM" → season "sN".
  const m = volumeId.match(/^(s\d+)v\d+$/);
  if (m) {
    const seasonId = m[1]!;
    if (!(seasonId in state.seasons)) {
      throw new Error(`volume ${volumeId} references unknown season ${seasonId}`);
    }
    const arcPath = join(seriesRoot, "seasons", seasonId, "season-arc.md");
    const outlinePath = join(seriesRoot, "seasons", seasonId, "volumes-outline.md");
    const arcMd = await readFileOrEmpty(arcPath);
    const outline = parseOutline(await readFile(outlinePath, "utf-8"));
    const entry = outline.volumes.find((v) => v.id === volumeId);
    if (!entry) throw new Error(`volume ${volumeId} not found in ${outlinePath}`);
    season = { id: seasonId, arcMd };
    outlineEntry = entry;
  } else if (!/^standalone-\d+$/.test(volumeId)) {
    throw new Error(`unrecognized volume id "${volumeId}" (expected sNvM or standalone-NNN)`);
  }

  // Load patch if present. `stat` is used purely as an existence probe — only ENOENT
  // is treated as "no patch". Any other stat error, and any readFile/parsePatch error,
  // must propagate.
  let patch: Map<string, string> | null = null;
  const patchPath = join(seriesRoot, "volumes", volumeId, "characters-patch.md");
  let patchExists = true;
  try {
    await stat(patchPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") patchExists = false;
    else throw err;
  }
  if (patchExists) {
    patch = parsePatch(await readFile(patchPath, "utf-8"));
  }

  return { seriesRoot, volumeId, meta, world, style, characters, season, outlineEntry, patch };
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function parseCharacters(md: string): Map<string, CharacterCard> {
  const out = new Map<string, CharacterCard>();
  // Each character starts with "## <name>".
  const sections = md.split(/^(?=## )/m).filter((s) => s.trim().length > 0);
  for (const sec of sections) {
    const head = sec.match(/^## (.+)$/m);
    if (!head) continue;
    const name = head[1]!.trim();
    const anchor = field(sec, "prompt_anchor");
    if (!anchor) throw new Error(`character "${name}" missing required prompt_anchor in characters.md`);
    out.set(name, {
      name,
      prompt_anchor: anchor,
      voice_profile: field(sec, "voice_profile"),
      appearance: field(sec, "appearance"),
      negative: field(sec, "negative"),
      raw: sec,
    });
  }
  return out;
}

function parsePatch(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const sections = md.split(/^(?=## )/m).filter((s) => s.trim().length > 0);
  for (const sec of sections) {
    const head = sec.match(/^## (.+)$/m);
    if (!head) continue;
    const name = head[1]!.trim();
    const append = sec.match(/^- 追加锚定:\s*(.+)$/m);
    if (append) out.set(name, append[1]!.trim());
  }
  return out;
}

function field(section: string, key: string): string | undefined {
  const re = new RegExp(`^- ${key}:\\s*(.+)$`, "m");
  const m = section.match(re);
  return m ? m[1]!.trim() : undefined;
}
