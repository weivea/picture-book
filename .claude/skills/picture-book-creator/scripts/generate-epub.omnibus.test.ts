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

let root: string;
let seriesRoot: string;
let outPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "omnibus-test-"));
  seriesRoot = join(root, "demo-series");
  // Build two minimal "packaged" volumes.
  for (const vid of ["s1v1", "s1v2"]) {
    const vdir = join(seriesRoot, "volumes", vid);
    await mkdir(vdir, { recursive: true });
    for (const n of [0, 1, 2]) {
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
      "--volumes", "s1v1,s1v2",
      "--title", "合订本测试",
      "--author", "tester",
      "--lang", "zh",
      "--output", outPath,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);

    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);

    // Images namespaced by volume id.
    expect(zip.file("OEBPS/images/s1v1/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v1/1.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v1/2.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v2/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v2/2.png")).not.toBeNull();

    // Per-volume divider XHTML present.
    expect(zip.file("OEBPS/divider-s1v1.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/divider-s1v2.xhtml")).not.toBeNull();
  });

  test("nav.xhtml groups pages by volume", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    // Each volume id appears in nav as a group label.
    expect(nav).toContain("s1v1");
    expect(nav).toContain("s1v2");
    // Nested ordered list (group → pages).
    expect(nav.match(/<ol>/g)!.length).toBeGreaterThanOrEqual(3); // 1 outer + 2 inner
  });

  test("opf spine starts with first volume cover then alternates dividers + pages", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    // Cover of omnibus is first volume's page 0.
    expect(opf).toMatch(/properties="cover-image"[^>]*href="images\/s1v1\/0\.png"|href="images\/s1v1\/0\.png"[^>]*properties="cover-image"/);
    // Both volumes' page 1 idrefs in spine.
    expect(opf).toContain('idref="page-s1v1-1"');
    expect(opf).toContain('idref="page-s1v2-1"');
  });

  test("per-page text from each volume's script.md is rendered", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const p1 = await zip.file("OEBPS/page-s1v1-1.xhtml")!.async("string");
    expect(p1).toContain("s1v1 第一页");
    const p2 = await zip.file("OEBPS/page-s1v2-2.xhtml")!.async("string");
    expect(p2).toContain("s1v2 第二页");
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
      "--volumes", "s1v1,sNOPE",
      "--title", "x",
    ], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/sNOPE/);
  });
});
