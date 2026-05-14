import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { orchestrateVolume } from "../orchestrate-volume";
import { loadState } from "../../../series-bible-creator/scripts/lib/state";

// 110KB filler PNG that passes the >100KB verifier.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);
const FAT_PNG = Buffer.concat([TINY_PNG, Buffer.alloc(110_000)]);

let root: string;
let seriesRoot: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "e2e-mini-"));
  seriesRoot = join(root, "demo");

  // Build a minimal Bible + outline by hand (could also `cp` the Task 8 fixture).
  await mkdir(join(seriesRoot, "bible", "portraits"), { recursive: true });
  await mkdir(join(seriesRoot, "seasons", "s1"), { recursive: true });

  await writeFile(join(seriesRoot, "state.json"), JSON.stringify({
    version: 1, series_slug: "demo", title: "Demo",
    created_at: "2026-05-14T00:00:00Z",
    bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
    seasons: { s1: { title: "S1", volumes_planned: 1, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 } },
    volumes: {}, omnibus: [],
  }, null, 2));
  await writeFile(join(seriesRoot, "bible", "series-meta.md"),
    `---\nslug: demo\ntitle: Demo\nage_range: 4-6\nlanguage: zh\ngenre: test\nseries_scale: short\ntypical_pages_per_volume: 3\ncreated_at: 2026-05-14T00:00:00Z\n---\n# meta\n`);
  await writeFile(join(seriesRoot, "bible", "world.md"), "# world\nminimal\n");
  await writeFile(join(seriesRoot, "bible", "characters.md"),
    `# 角色\n## 小熊\n- prompt_anchor: A small white bear cub.\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
  await writeFile(join(seriesRoot, "bible", "style.md"),
    `# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n- color_palette: cream, soft pink, sage\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "season-arc.md"),
    `---\nseason_id: s1\ntitle: S1\nvolumes_planned: 1\nopening_state: start\nending_state: end\narc_locked: true\n---\n# arc\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"),
    `---\nseason_id: s1\nrevision: 1\n---\n\n## s1v1 first volume\n\n- beat: 开篇\n- pov: 小熊\n- summary: short.\n- characters: [小熊]\n- planned_pages: 5\n- mood: 温暖\n`);
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("end-to-end mini-series volume creation", () => {
  test("orchestrateVolume runs Step 5-9 and ends in packaged state", async () => {
    const pages = [
      { pageNumber: 0, text: "封面", scene: "bear cub holding a sign", action: "smiling", emotion: "happy", composition: "full body, centered", characters: ["小熊"] },
      { pageNumber: 1, text: "第一页", scene: "kitchen", action: "kneading dough", emotion: "focused", composition: "medium shot", characters: ["小熊"] },
      { pageNumber: 2, text: "第二页", scene: "oven", action: "watching", emotion: "curious", composition: "close-up", characters: ["小熊"] },
    ];

    const result = await orchestrateVolume({
      seriesRoot,
      volumeId: "s1v1",
      pages,
      title: "首册",
      // mock image-generation: write FAT_PNG to the requested output path.
      generateImage: async (_prompt, outputPath) => {
        await writeFile(outputPath, FAT_PNG);
      },
    });

    expect(result.phase).toBe("packaged");
    const epubStat = await stat(result.epubPath);
    expect(epubStat.size).toBeGreaterThan(1024); // sane EPUB size
  });

  test("state.json reflects packaged + correct page count", async () => {
    const s = await loadState(seriesRoot);
    expect(s.volumes["s1v1"]?.phase).toBe("packaged");
    expect(s.volumes["s1v1"]?.pages).toBe(3);
    expect(s.volumes["s1v1"]?.season).toBe("s1");
  });

  test("outline planned_pages was rewritten + revision bumped", async () => {
    const text = await readFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"), "utf-8");
    expect(text).toContain("revision: 2");
    expect(text).toContain("planned_pages: 3");
  });

  test("per-page prompt files were written", async () => {
    for (const n of [0, 1, 2]) {
      const p = await readFile(join(seriesRoot, "volumes", "s1v1", "prompts", `${n}.txt`), "utf-8");
      expect(p).toContain("warm pastel watercolor");          // style prefix
      expect(p).toContain("A small white bear cub.");          // bible anchor verbatim
    }
  });

  test("per-volume meta.json was written with spec §4.7 fields", async () => {
    const text = await readFile(join(seriesRoot, "volumes", "s1v1", "meta.json"), "utf-8");
    const meta = JSON.parse(text);
    expect(meta.volume_id).toBe("s1v1");
    expect(meta.season).toBe("s1");
    expect(meta.title).toBe("首册");
    expect(meta.pages).toBe(3);
    expect(meta.outputs.epub).toContain(".epub");
  });

  test("omnibus mode merges this single packaged volume (with warning)", async () => {
    // After Task 5/6, parse-range warns on single-volume omnibus.
    const { parseRange } = await import("../../../series-omnibus-packager/scripts/parse-range");
    const s = await loadState(seriesRoot);
    const r = parseRange("s1", s);
    expect(r.ids).toEqual(["s1v1"]);
    expect(r.warnings).toContain("omnibus of a single volume — output will be a copy of that volume");
  });
});
