import { describe, test, expect } from "bun:test";
import { parseRange } from "./parse-range";
import type { SeriesState } from "../../series-bible-creator/scripts/lib/state";

const STATE: SeriesState = {
  version: 1,
  series_slug: "demo",
  title: "demo",
  created_at: "2026-05-14T00:00:00Z",
  bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
  seasons: {
    s1: { title: "S1", volumes_planned: 3, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 },
    s2: { title: "S2", volumes_planned: 2, arc_locked: true, started_at: "2026-05-15T00:00:00Z", outline_revision: 1 },
  },
  volumes: {
    s1v1: { season: "s1", phase: "packaged", audio: true, pages: 12 },
    s1v2: { season: "s1", phase: "packaged", audio: true, pages: 12 },
    s1v3: { season: "s1", phase: "imaged" },              // not yet packaged
    s2v1: { season: "s2", phase: "packaged", audio: false, pages: 10 },
    "standalone-001": { season: null, phase: "packaged", audio: true, pages: 8 },
  },
  omnibus: [],
};

describe("parseRange", () => {
  test("season id selects all packaged volumes in that season", () => {
    const r = parseRange("s1", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2"]);
    expect(r.skipped).toEqual([{ id: "s1v3", reason: "not packaged (phase=imaged)" }]);
  });

  test("Chinese season alias 第一季 maps to s1", () => {
    const r = parseRange("第一季", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2"]);
  });

  test("Chinese season alias 第二季 maps to s2", () => {
    const r = parseRange("第二季", STATE);
    expect(r.ids).toEqual(["s2v1"]);
  });

  test("'全部' selects every packaged volume across seasons + standalones", () => {
    const r = parseRange("全部", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2", "s2v1", "standalone-001"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["s1v3"]);
  });

  test("'all' is an alias for 全部", () => {
    const r = parseRange("all", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2", "s2v1", "standalone-001"]);
  });

  test("explicit comma list preserves user-given order", () => {
    const r = parseRange("s2v1, s1v1", STATE);
    expect(r.ids).toEqual(["s2v1", "s1v1"]);
    expect(r.skipped).toEqual([]);
  });

  test("explicit list skips not-yet-packaged volumes with reason", () => {
    const r = parseRange("s1v1, s1v3", STATE);
    expect(r.ids).toEqual(["s1v1"]);
    expect(r.skipped).toEqual([{ id: "s1v3", reason: "not packaged (phase=imaged)" }]);
  });

  test("explicit list errors on unknown volume id", () => {
    expect(() => parseRange("s1v1, s9v9", STATE)).toThrow(/s9v9/);
  });

  test("unknown season id throws", () => {
    expect(() => parseRange("s99", STATE)).toThrow(/s99/);
  });

  test("warns when result has only one volume (omnibus of 1 makes no sense)", () => {
    const r = parseRange("s2", STATE);
    expect(r.ids).toEqual(["s2v1"]);
    expect(r.warnings).toEqual(["omnibus of a single volume — output will be a copy of that volume"]);
  });

  test("throws when result is empty", () => {
    const empty: SeriesState = { ...STATE, volumes: {} };
    expect(() => parseRange("全部", empty)).toThrow(/no .*volumes/i);
  });
});
