import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadVolumeContext } from "./load-context";

let root: string;
let seriesRoot: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vol-ctx-"));
  seriesRoot = join(root, "demo");
  await mkdir(join(seriesRoot, "bible"), { recursive: true });
  await mkdir(join(seriesRoot, "seasons", "s1"), { recursive: true });

  await writeFile(join(seriesRoot, "state.json"),
    JSON.stringify({
      version: 1, series_slug: "demo", title: "Demo",
      created_at: "2026-05-14T00:00:00Z",
      bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
      seasons: { s1: { title: "S1", volumes_planned: 2, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 } },
      volumes: {}, omnibus: [],
    }, null, 2));
  await writeFile(join(seriesRoot, "bible", "series-meta.md"),
    `---\nslug: demo\ntitle: Demo\nage_range: 4-6\nlanguage: zh\ngenre: test\nseries_scale: short\ntypical_pages_per_volume: 10\ncreated_at: 2026-05-14T00:00:00Z\n---\n# meta\n`);
  await writeFile(join(seriesRoot, "bible", "world.md"), "# world\nminimal\n");
  await writeFile(join(seriesRoot, "bible", "characters.md"),
    `# 角色\n## 小熊\n- prompt_anchor: A small white bear cub.\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
  await writeFile(join(seriesRoot, "bible", "style.md"),
    `# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"),
    `---\nseason_id: s1\nrevision: 1\n---\n\n## s1v1 first volume\n\n- beat: 开篇\n- pov: 小熊\n- summary: a short summary.\n- characters: [小熊]\n- planned_pages: 10\n- mood: 温暖\n\n## s1v2 second volume\n\n- beat: 递进\n- pov: 小熊\n- summary: another summary.\n- characters: [小熊]\n- planned_pages: 12\n- mood: 期待\n`);
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("loadVolumeContext", () => {
  test("loads bible + outline entry + season for an in-season volume", async () => {
    const ctx = await loadVolumeContext(seriesRoot, "s1v1");
    expect(ctx.meta.slug).toBe("demo");
    expect(ctx.season?.id).toBe("s1");
    expect(ctx.outlineEntry?.title).toBe("first volume");
    expect(ctx.outlineEntry?.planned_pages).toBe(10);
    expect(ctx.characters.size).toBeGreaterThan(0);
    expect(ctx.style).toContain("warm pastel watercolor");
    expect(ctx.patch).toBeNull();
  });

  test("loads patch when characters-patch.md exists in volume dir", async () => {
    await mkdir(join(seriesRoot, "volumes", "s1v1"), { recursive: true });
    await writeFile(join(seriesRoot, "volumes", "s1v1", "characters-patch.md"),
      `---\nvolume_id: s1v1\napplies_to: 本册全部页\n---\n## 小熊\n- 追加锚定: wearing a flour-dusted apron\n`);
    const ctx = await loadVolumeContext(seriesRoot, "s1v1");
    expect(ctx.patch).not.toBeNull();
    expect(ctx.patch!.get("小熊")).toContain("flour-dusted apron");
  });

  test("supports standalone volume (--no-season) with no outline entry", async () => {
    await mkdir(join(seriesRoot, "volumes", "standalone-001"), { recursive: true });
    const ctx = await loadVolumeContext(seriesRoot, "standalone-001");
    expect(ctx.season).toBeNull();
    expect(ctx.outlineEntry).toBeNull();
  });

  test("throws when bible.frozen_at is null", async () => {
    const unfrozen = await mkdtemp(join(tmpdir(), "unfrozen-"));
    await writeFile(join(unfrozen, "state.json"),
      JSON.stringify({ version: 1, series_slug: "x", title: "x", created_at: "", bible: { version: 0, frozen_at: null }, seasons: {}, volumes: {}, omnibus: [] }));
    await expect(loadVolumeContext(unfrozen, "s1v1")).rejects.toThrow(/bible.*not frozen/i);
    await rm(unfrozen, { recursive: true, force: true });
  });

  test("throws on unknown volume in a known season (outline missing entry)", async () => {
    await expect(loadVolumeContext(seriesRoot, "s1v9")).rejects.toThrow(/s1v9/);
  });
});

// --- Tightened-validation regression tests (separate fixtures so they don't pollute the shared seriesRoot). ---

/** Minimal helper: writes the same valid bible+outline shape used by the suite above
 *  but allows the caller to override one or more files before loadVolumeContext runs. */
async function makeFixture(): Promise<{ root: string; seriesRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "vol-ctx-extra-"));
  const seriesRoot = join(root, "demo");
  await mkdir(join(seriesRoot, "bible"), { recursive: true });
  await mkdir(join(seriesRoot, "seasons", "s1"), { recursive: true });
  await writeFile(join(seriesRoot, "state.json"),
    JSON.stringify({
      version: 1, series_slug: "demo", title: "Demo",
      created_at: "2026-05-14T00:00:00Z",
      bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
      seasons: { s1: { title: "S1", volumes_planned: 2, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 } },
      volumes: {}, omnibus: [],
    }, null, 2));
  await writeFile(join(seriesRoot, "bible", "series-meta.md"),
    `---\nslug: demo\ntitle: Demo\nage_range: 4-6\nlanguage: zh\ngenre: test\nseries_scale: short\ntypical_pages_per_volume: 10\ncreated_at: 2026-05-14T00:00:00Z\n---\n# meta\n`);
  await writeFile(join(seriesRoot, "bible", "world.md"), "# world\nminimal\n");
  await writeFile(join(seriesRoot, "bible", "characters.md"),
    `# 角色\n## 小熊\n- prompt_anchor: A small white bear cub.\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
  await writeFile(join(seriesRoot, "bible", "style.md"),
    `# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "season-arc.md"), "# arc\nminimal arc\n");
  await writeFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"),
    `---\nseason_id: s1\nrevision: 1\n---\n\n## s1v1 first volume\n\n- beat: 开篇\n- pov: 小熊\n- summary: a short summary.\n- characters: [小熊]\n- planned_pages: 10\n- mood: 温暖\n`);
  return { root, seriesRoot };
}

describe("loadVolumeContext (tightened validation)", () => {
  test("throws when characters.md has a character section missing prompt_anchor", async () => {
    const { root, seriesRoot } = await makeFixture();
    // Overwrite characters.md to drop the required prompt_anchor field.
    await writeFile(join(seriesRoot, "bible", "characters.md"),
      `# 角色\n## 小熊\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
    await expect(loadVolumeContext(seriesRoot, "s1v1")).rejects.toThrow(/prompt_anchor/i);
    await expect(loadVolumeContext(seriesRoot, "s1v1")).rejects.toThrow(/小熊/);
    await rm(root, { recursive: true, force: true });
  });

  test("re-throws non-ENOENT errors when reading characters-patch.md", async () => {
    // Create the patch *path* as a directory rather than a file. stat() succeeds
    // (it exists), so the existence probe doesn't short-circuit; the subsequent
    // readFile then raises EISDIR on Linux/macOS, which must propagate (NOT be
    // swallowed into a "no patch" no-op).
    const { root, seriesRoot } = await makeFixture();
    await mkdir(join(seriesRoot, "volumes", "s1v1", "characters-patch.md"), { recursive: true });
    await expect(loadVolumeContext(seriesRoot, "s1v1")).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  test("readFileOrEmpty re-throws non-ENOENT errors (season-arc.md is a directory)", async () => {
    // Same trick as above: replace season-arc.md with a directory so readFile
    // raises EISDIR. The narrowed catch must let it bubble up instead of
    // returning "" silently.
    const { root, seriesRoot } = await makeFixture();
    await rm(join(seriesRoot, "seasons", "s1", "season-arc.md"));
    await mkdir(join(seriesRoot, "seasons", "s1", "season-arc.md"));
    await expect(loadVolumeContext(seriesRoot, "s1v1")).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });
});
