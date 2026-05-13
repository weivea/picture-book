// .claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts
import { describe, it, expect } from "bun:test";
import { renderChapterXhtml, packEpub } from "../lib/epub3-builder";
import JSZip from "jszip";

describe("renderChapterXhtml", () => {
  it("每句包 span，含 chapter+sentence id", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 1,
      title: "灰雪",
      scenes: [
        {
          sentences: [
            { idx: 0, text: "天黑了。", speaker: "narrator" },
            { idx: 1, text: "她抬起头。", speaker: "narrator" },
          ],
          illustration: null,
        },
      ],
    });
    expect(xhtml).toContain('<span id="s_01_000">天黑了。</span>');
    expect(xhtml).toContain('<span id="s_01_001">她抬起头。</span>');
    expect(xhtml).toContain("<title>灰雪</title>");
  });

  it("scene 之间插入 figure", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 2,
      title: "门后",
      scenes: [
        {
          sentences: [{ idx: 0, text: "雪。", speaker: "narrator" }],
          illustration: { src: "../illustrations/ch_02/scene_01.png", alt: "废墟" },
        },
      ],
    });
    expect(xhtml).toContain(
      '<figure><img src="../illustrations/ch_02/scene_01.png" alt="废墟"/></figure>',
    );
  });

  it("XML 特殊字符被转义（< & > 等）", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 1,
      title: "A & B",
      scenes: [
        {
          sentences: [
            { idx: 0, text: "她说<x>。", speaker: "narrator" },
          ],
          illustration: null,
        },
      ],
    });
    expect(xhtml).toContain("A &amp; B");
    expect(xhtml).toContain("她说&lt;x&gt;。");
  });

  it("跨 scene 全局编号连续递增", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 3,
      title: "x",
      scenes: [
        {
          sentences: [{ idx: 0, text: "一。", speaker: "narrator" }],
          illustration: null,
        },
        {
          sentences: [
            { idx: 0, text: "二。", speaker: "narrator" },
            { idx: 1, text: "三。", speaker: "narrator" },
          ],
          illustration: null,
        },
      ],
    });
    expect(xhtml).toContain('id="s_03_000">一。');
    expect(xhtml).toContain('id="s_03_001">二。');
    expect(xhtml).toContain('id="s_03_002">三。');
  });
});

describe("packEpub", () => {
  it("mimetype 是未压缩的 entry，内容是 application/epub+zip", async () => {
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [],
    });
    const z = await JSZip.loadAsync(buf);
    const mimetypeFile = z.file("mimetype");
    expect(mimetypeFile).not.toBeNull();
    const text = await mimetypeFile!.async("text");
    expect(text).toBe("application/epub+zip");
  });

  it("含 META-INF/container.xml 指向 OEBPS/content.opf", async () => {
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [],
    });
    const z = await JSZip.loadAsync(buf);
    const container = await z.file("META-INF/container.xml")!.async("text");
    expect(container).toContain('full-path="OEBPS/content.opf"');
  });

  it("extraFiles 被放到 OEBPS/ 下", async () => {
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [{ path: "chapters/ch_01.xhtml", data: "<html/>" }],
    });
    const z = await JSZip.loadAsync(buf);
    const f = z.file("OEBPS/chapters/ch_01.xhtml");
    expect(f).not.toBeNull();
    expect(await f!.async("text")).toBe("<html/>");
  });

  it("传入 opfXml 时使用调用方提供的版本", async () => {
    const opf = `<?xml version="1.0"?><package id="custom"/>`;
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [],
      opfXml: opf,
    });
    const z = await JSZip.loadAsync(buf);
    const text = await z.file("OEBPS/content.opf")!.async("text");
    expect(text).toBe(opf);
  });
});
