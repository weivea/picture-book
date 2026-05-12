import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { spawnSync } from "child_process";
import { existsSync, statSync, rmSync, readFileSync } from "fs";
import JSZip from "jszip";

const fixtureDir = join(import.meta.dir, "fixtures/mini-book");
const epubPath = join(fixtureDir, "迷你测试-audio.epub");
const scriptPath = join(import.meta.dir, "../generate-audio-epub.ts");

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
        scriptPath,
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

    if (result.status !== 0) {
      console.error("generate-audio-epub.ts failed:");
      console.error("STDOUT:", result.stdout);
      console.error("STDERR:", result.stderr);
    }
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
    expect(opf).toContain('<meta property="media:duration">PT4.772S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-0">PT3.064S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-1">PT1.708S</meta>');

    const originalAudio0 = readFileSync(join(fixtureDir, "audio/0.mp3"));
    const epubAudio0 = await zip.file("OEBPS/audio/0.mp3")!.async("nodebuffer");
    expect(epubAudio0.length).toBeGreaterThan(originalAudio0.length);

    const smil0 = await zip.file("OEBPS/smil/page-0.smil")!.async("string");
    expect(smil0).toContain('clipEnd="3064ms"');

    const smil1 = await zip.file("OEBPS/smil/page-1.smil")!.async("string");
    expect(smil1).toContain('src="../audio/1.mp3"');
    expect(smil1).toContain('src="../page-1.xhtml#p1-s');
    expect(smil1).toContain('clipEnd="1708ms"');

    const xhtml1 = await zip.file("OEBPS/page-1.xhtml")!.async("string");
    expect(xhtml1).toContain('id="p1-s1"');
  }, 30000);
});
