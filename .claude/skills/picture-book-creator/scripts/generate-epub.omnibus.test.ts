import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import JSZip from "jszip";

const SCRIPT = join(import.meta.dir, "generate-epub.ts");

// Tiny valid 1×1 PNG (red pixel). Reused across all fixture pages.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);

const V1 = "s1v1";
const V2 = "s1v2";

let root: string;
let seriesRoot: string;
let outPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "omnibus-test-"));
  seriesRoot = join(root, "demo-series");
  // Build two minimal "packaged" volumes.
  // Per spec: v1 has 0.png + 1.png + script.md (2 pages); v2 has 0.png + 1.png + 2.png (3 pages).
  const pagesByVolume: Record<string, number[]> = {
    [V1]: [0, 1],
    [V2]: [0, 1, 2],
  };
  for (const vid of [V1, V2]) {
    const vdir = join(seriesRoot, "volumes", vid);
    await mkdir(vdir, { recursive: true });
    for (const n of pagesByVolume[vid]!) {
      await writeFile(join(vdir, `${n}.png`), TINY_PNG);
    }
    await writeFile(
      join(vdir, "script.md"),
      `# ${vid}\n\n## 第 0 页\n**text**：${vid} 封面\n\n## 第 1 页\n**text**：${vid} 第一页\n\n## 第 2 页\n**text**：${vid} 第二页\n`
    );
  }
  await mkdir(join(seriesRoot, "omnibus"), { recursive: true });
  outPath = join(seriesRoot, "omnibus", "demo.epub");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("generate-epub.ts --omnibus", () => {
  test("produces an EPUB containing both volumes' images", async () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--volumes", `${V1},${V2}`,
      "--title", "合订本测试",
      "--author", "tester",
      "--lang", "zh",
      "--output", outPath,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);

    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);

    // Images namespaced by volume id. v1 has 0/1.png; v2 has 0/1/2.png.
    expect(zip.file(`OEBPS/images/${V1}/0.png`)).not.toBeNull();
    expect(zip.file(`OEBPS/images/${V1}/1.png`)).not.toBeNull();
    expect(zip.file(`OEBPS/images/${V1}/2.png`)).toBeNull();
    expect(zip.file(`OEBPS/images/${V2}/0.png`)).not.toBeNull();
    expect(zip.file(`OEBPS/images/${V2}/1.png`)).not.toBeNull();
    expect(zip.file(`OEBPS/images/${V2}/2.png`)).not.toBeNull();

    // Per-volume divider XHTML present.
    expect(zip.file(`OEBPS/divider-${V1}.xhtml`)).not.toBeNull();
    expect(zip.file(`OEBPS/divider-${V2}.xhtml`)).not.toBeNull();

    // Byte-equality: stored image bytes match the source TINY_PNG fixture.
    const v1Img = await zip.file(`OEBPS/images/${V1}/0.png`)!.async("nodebuffer");
    expect(Buffer.from(v1Img).equals(TINY_PNG)).toBe(true);
    const v2Img = await zip.file(`OEBPS/images/${V2}/2.png`)!.async("nodebuffer");
    expect(Buffer.from(v2Img).equals(TINY_PNG)).toBe(true);

    // Cover page actually references the first volume's page-0 image.
    const cover = await zip.file("OEBPS/cover.xhtml")!.async("string");
    expect(cover).toContain(`src="images/${V1}/0.png"`);
  });

  test("nav.xhtml groups pages by volume", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    // Each volume id appears in nav as a group label.
    expect(nav).toContain(V1);
    expect(nav).toContain(V2);
    // Nested ordered list (group → pages).
    expect(nav.match(/<ol>/g)!.length).toBeGreaterThanOrEqual(3); // 1 outer + 2 inner
  });

  test("opf spine is exactly cover, divider+pages of v1, divider+pages of v2 in order", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    // Cover of omnibus is first volume's page 0.
    expect(opf).toMatch(
      new RegExp(
        `properties="cover-image"[^>]*href="images/${V1}/0\\.png"|href="images/${V1}/0\\.png"[^>]*properties="cover-image"`
      )
    );
    // Ordered spine extraction: every <itemref idref="..."/> in document order.
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"\/>/g)].map((m) => m[1]);
    expect(spine).toEqual([
      "cover",
      `divider-${V1}`,
      `page-${V1}-1`,
      `divider-${V2}`,
      `page-${V2}-0`,
      `page-${V2}-1`,
      `page-${V2}-2`,
    ]);
  });

  test("per-page text from each volume's script.md is rendered", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const p1 = await zip.file(`OEBPS/page-${V1}-1.xhtml`)!.async("string");
    expect(p1).toContain(`${V1} 第一页`);
    const p2 = await zip.file(`OEBPS/page-${V2}-2.xhtml`)!.async("string");
    expect(p2).toContain(`${V2} 第二页`);
  });

  test("--omnibus errors if --volumes is missing", () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--title", "x",
    ], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--volumes/);
  });

  test("--omnibus errors if a listed volume directory is missing", () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--volumes", `${V1},sNOPE`,
      "--title", "x",
    ], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/sNOPE/);
  });
});
