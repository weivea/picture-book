import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { spawnSync } from "child_process";
import { existsSync, statSync, rmSync, readFileSync } from "fs";
import JSZip from "jszip";

const fixtureDir = join(import.meta.dir, "fixtures/mini-book");
const epubPath = join(fixtureDir, "迷你测试-audio.epub");

describe("integration: generate-audio-epub", () => {
  beforeAll(() => {
    if (existsSync(epubPath)) rmSync(epubPath);
  });

  afterAll(() => {
    if (existsSync(epubPath)) rmSync(epubPath);
  });

  test("从 fixture 打包出有效 EPUB3 Media Overlays", async () => {
    const result = spawnSync(
      "bun",
      [
        "run",
        ".claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts",
        "--topic-dir",
        fixtureDir,
        "--title",
        "迷你测试",
        "--author",
        "Tester",
        "--lang",
        "zh",
        "--voice",
        "zh-CN-XiaoyiNeural",
      ],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);
    expect(existsSync(epubPath)).toBe(true);
    expect(statSync(epubPath).size).toBeGreaterThan(10000);

    const buf = readFileSync(epubPath);
    const zip = await JSZip.loadAsync(buf);

    expect(zip.file("mimetype")).not.toBeNull();
    expect(zip.file("META-INF/container.xml")).not.toBeNull();
    expect(zip.file("OEBPS/content.opf")).not.toBeNull();
    expect(zip.file("OEBPS/nav.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/page-0.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/page-1.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/images/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/1.png")).not.toBeNull();
    expect(zip.file("OEBPS/audio/0.mp3")).not.toBeNull();
    expect(zip.file("OEBPS/audio/1.mp3")).not.toBeNull();
    expect(zip.file("OEBPS/smil/page-0.smil")).not.toBeNull();
    expect(zip.file("OEBPS/smil/page-1.smil")).not.toBeNull();

    const mimetype = await zip.file("mimetype")!.async("string");
    expect(mimetype).toBe("application/epub+zip");

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("media:active-class");
    expect(opf).toContain("media:narrator");
    expect(opf).toContain('media-overlay="smil-0"');
    expect(opf).toContain('media-overlay="smil-1"');

    const smil1 = await zip.file("OEBPS/smil/page-1.smil")!.async("string");
    expect(smil1).toContain('src="../audio/1.mp3"');
    expect(smil1).toContain('src="../page-1.xhtml#p1-s');

    const xhtml1 = await zip.file("OEBPS/page-1.xhtml")!.async("string");
    expect(xhtml1).toContain('id="p1-s1"');
  }, 30000);
});
