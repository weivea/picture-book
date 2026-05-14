import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readState, writeState, loadState, updateState, type SeriesState } from "./state";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "state-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SAMPLE: SeriesState = {
  version: 1,
  series_slug: "demo",
  title: "Demo",
  created_at: "2026-05-14T00:00:00Z",
  bible: { version: 1, frozen_at: "2026-05-14T00:01:00Z" },
  seasons: {},
  volumes: {},
  omnibus: [],
};

describe("readState", () => {
  test("returns null when state.json does not exist", async () => {
    const s = await readState(dir);
    expect(s).toBeNull();
  });

  test("parses a valid state.json", async () => {
    await writeFile(join(dir, "state.json"), JSON.stringify(SAMPLE), "utf-8");
    const s = await readState(dir);
    expect(s).toEqual(SAMPLE);
  });

  test("throws on malformed JSON", async () => {
    await writeFile(join(dir, "state.json"), "{not json", "utf-8");
    await expect(readState(dir)).rejects.toThrow();
  });
});

describe("writeState", () => {
  test("creates state.json with pretty JSON", async () => {
    await writeState(dir, SAMPLE);
    const content = await readFile(join(dir, "state.json"), "utf-8");
    expect(content).toContain("\n  \"series_slug\"");
    const roundtrip = JSON.parse(content);
    expect(roundtrip).toEqual(SAMPLE);
  });

  test("is atomic: temp file does not remain after success", async () => {
    await writeState(dir, SAMPLE);
    await expect(stat(join(dir, "state.json.tmp"))).rejects.toThrow();
  });

  test("does not corrupt existing state.json if rename throws", async () => {
    await writeState(dir, SAMPLE);
    // Force failure by passing a non-existent dir.
    await expect(writeState(join(dir, "no-such-dir"), SAMPLE)).rejects.toThrow();
    // Original survives unchanged.
    const stillThere = await readState(dir);
    expect(stillThere).toEqual(SAMPLE);
  });
});

describe("loadState", () => {
  test("throws when state.json does not exist (vs. readState which returns null)", async () => {
    await expect(loadState(dir)).rejects.toThrow(/state\.json/i);
  });
  test("returns the parsed state when present", async () => {
    await writeState(dir, SAMPLE);
    expect(await loadState(dir)).toEqual(SAMPLE);
  });
});

describe("updateState", () => {
  test("creates state.json by initializing when absent and applying the mutator", async () => {
    await updateState(dir, (s) => {
      s.series_slug = "fresh";
      s.title = "Fresh";
      s.created_at = "2026-05-14T00:00:00Z";
    }, { initialize: () => structuredClone(SAMPLE) });
    const s = await loadState(dir);
    expect(s.series_slug).toBe("fresh");
    expect(s.title).toBe("Fresh");
  });

  test("applies the mutator to existing state and persists atomically", async () => {
    await writeState(dir, SAMPLE);
    await updateState(dir, (s) => {
      s.bible.frozen_at = "2026-05-14T01:00:00Z";
      s.volumes["s1v1"] = { season: "s1", phase: "drafting" };
    });
    const s = await loadState(dir);
    expect(s.bible.frozen_at).toBe("2026-05-14T01:00:00Z");
    expect(s.volumes["s1v1"]).toEqual({ season: "s1", phase: "drafting" });
  });

  test("throws when state.json is absent and no initializer is provided", async () => {
    await expect(updateState(dir, (s) => { s.title = "x"; })).rejects.toThrow(/state\.json/i);
  });
});
