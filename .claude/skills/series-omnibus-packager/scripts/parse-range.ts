import type { SeriesState } from "../../series-bible-creator/scripts/lib/state";

export interface RangeResolution {
  ids: string[];                              // ordered, packaged-only volume ids
  skipped: { id: string; reason: string }[];  // matched but not packaged
  warnings: string[];                         // non-fatal advisories
}

const CN_SEASON_RE = /^第\s*([一二三四五六七八九十百零〇1234567890]+)\s*季$/;
const CN_NUMERALS: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  "〇": 0, "零": 0,
};

export function parseRange(input: string, state: SeriesState): RangeResolution {
  const trimmed = input.trim();

  // Branch 1: 全部 / all
  if (trimmed === "全部" || trimmed.toLowerCase() === "all") {
    return resolveAll(state);
  }

  // Branch 2: explicit comma list (contains a comma OR matches a volume id pattern)
  if (trimmed.includes(",") || trimmed.includes("，") || /v\d+|standalone-\d+/.test(trimmed)) {
    return resolveExplicit(trimmed, state);
  }

  // Branch 3: season id, either raw "sN" or Chinese "第N季"
  const seasonId = normalizeSeasonId(trimmed);
  if (!(seasonId in state.seasons)) {
    throw new Error(`unknown season "${trimmed}" (resolved to ${seasonId}); known: ${Object.keys(state.seasons).join(", ")}`);
  }
  return resolveBySeason(seasonId, state);
}

function normalizeSeasonId(s: string): string {
  if (/^s\d+$/.test(s)) return s;
  const m = s.match(CN_SEASON_RE);
  if (m) {
    const raw = m[1]!;
    // Try ASCII digits first.
    if (/^\d+$/.test(raw)) return `s${parseInt(raw, 10)}`;
    // Single-char Chinese numeral (一-十).
    if (raw.length === 1 && raw in CN_NUMERALS) return `s${CN_NUMERALS[raw]}`;
    // Compound like 十一, 二十 etc. — minimal support: 十X / X十 / X十Y
    const ten = CN_NUMERALS["十"]!;
    if (raw.length === 2) {
      if (raw[0] === "十" && raw[1]! in CN_NUMERALS) return `s${ten + CN_NUMERALS[raw[1]!]!}`;
      if (raw[1] === "十" && raw[0]! in CN_NUMERALS) return `s${CN_NUMERALS[raw[0]!]! * ten}`;
    }
  }
  return s; // fallthrough; caller will error on unknown
}

function resolveAll(state: SeriesState): RangeResolution {
  const all = sortVolumeIds(Object.keys(state.volumes), state);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of all) {
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error("no packaged volumes to omnibus");
  return { ids, skipped, warnings: warningsFor(ids) };
}

function resolveBySeason(seasonId: string, state: SeriesState): RangeResolution {
  const matched = Object.entries(state.volumes)
    .filter(([, v]) => v.season === seasonId)
    .map(([id]) => id);
  const ordered = sortVolumeIds(matched, state);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ordered) {
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error(`no packaged volumes in season ${seasonId}`);
  return { ids, skipped, warnings: warningsFor(ids) };
}

function resolveExplicit(spec: string, state: SeriesState): RangeResolution {
  const tokens = spec.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of tokens) {
    if (!(id in state.volumes)) {
      throw new Error(`unknown volume id "${id}"; known: ${Object.keys(state.volumes).join(", ")}`);
    }
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error("no packaged volumes selected");
  return { ids, skipped, warnings: warningsFor(ids) };
}

/**
 * Order: by season key (alphanumeric, with "null" — i.e. standalones — last),
 * then by volume id within season.
 */
function sortVolumeIds(ids: string[], state: SeriesState): string[] {
  return [...ids].sort((a, b) => {
    const sa = state.volumes[a]!.season ?? "￿";
    const sb = state.volumes[b]!.season ?? "￿";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function warningsFor(ids: string[]): string[] {
  if (ids.length === 1) {
    return ["omnibus of a single volume — output will be a copy of that volume"];
  }
  return [];
}
