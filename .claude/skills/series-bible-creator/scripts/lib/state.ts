import { readFile, writeFile, rename, unlink } from "fs/promises";
import { join } from "path";

export type Phase = "drafting" | "scripted" | "imaged" | "packaged";

export interface SeasonState {
  title: string;
  volumes_planned: number;
  arc_locked: boolean;
  started_at?: string;
  outline_revision: number;
}

export interface VolumeState {
  season: string | null;
  phase: Phase;
  audio?: boolean;
  pages?: number;
  score?: number;
  built_at?: string;
}

export interface OmnibusEntry {
  range: string;
  built_at: string;
  file: string;
}

export interface SeriesState {
  version: 1;
  series_slug: string;
  title: string;
  created_at: string;
  bible: {
    version: number;
    frozen_at: string | null;
  };
  seasons: Record<string, SeasonState>;
  volumes: Record<string, VolumeState>;
  omnibus: OmnibusEntry[];
}

const FILENAME = "state.json";
const TMP = "state.json.tmp";

export async function readState(seriesRoot: string): Promise<SeriesState | null> {
  let raw: string;
  try {
    raw = await readFile(join(seriesRoot, FILENAME), "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as SeriesState;
}

export async function writeState(seriesRoot: string, state: SeriesState): Promise<void> {
  const tmpPath = join(seriesRoot, TMP);
  const finalPath = join(seriesRoot, FILENAME);
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    // Best-effort cleanup; ignore if temp already gone.
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Convenience wrapper used by every series-* skill: like readState but errors
 * (rather than returning null) when state.json is missing. Most skills depend
 * on it existing — only series-bible-creator's first run uses readState.
 */
export async function loadState(seriesRoot: string): Promise<SeriesState> {
  const s = await readState(seriesRoot);
  if (s === null) {
    throw new Error(`state.json not found in ${seriesRoot} — has the series been created?`);
  }
  return s;
}

/**
 * Atomic read-modify-write. The mutator receives a deep clone of the current
 * state and mutates it in place. If `state.json` does not exist and an
 * `initialize` callback is supplied, that callback's return value is used as
 * the seed before mutation; otherwise this function throws.
 *
 * Concurrency: each call is atomic via tmp-file + rename, but two concurrent
 * callers of updateState() can still race (last-writer-wins). Series skills
 * are session-serial (one Claude session at a time per series), so this is
 * intentional and acceptable.
 */
export async function updateState(
  seriesRoot: string,
  mutator: (state: SeriesState) => void,
  options: { initialize?: () => SeriesState } = {},
): Promise<void> {
  const existing = await readState(seriesRoot);
  let next: SeriesState;
  if (existing === null) {
    if (!options.initialize) {
      throw new Error(`state.json not found in ${seriesRoot} and no initializer was provided`);
    }
    next = options.initialize();
  } else {
    next = structuredClone(existing);
  }
  mutator(next);
  await writeState(seriesRoot, next);
}
