import { describe, expect, test } from "bun:test";
import { buildOpf } from "../lib/opf-builder";

describe("buildOpf", () => {
  test("含 media-overlay 引用的 manifest", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-1",
      title: "测试绘本",
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [
        { pageNum: 0, durationMs: 2000 },
        { pageNum: 1, durationMs: 4820 },
        { pageNum: 2, durationMs: 3500 },
      ],
    });

    expect(opf).toContain("<dc:title>测试绘本</dc:title>");
    expect(opf).toContain("<dc:creator>AI</dc:creator>");
    expect(opf).toContain("<dc:language>zh</dc:language>");
    expect(opf).toContain('<meta property="media:duration">PT10.320S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-0">PT2.000S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-1">PT4.820S</meta>');
    expect(opf).toContain('<meta property="media:active-class">-epub-media-overlay-active</meta>');
    expect(opf).toContain('<meta property="media:narrator">zh-CN-XiaoyiNeural</meta>');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');

    // 封面
    expect(opf).toContain('href="images/0.png"');
    expect(opf).toContain('properties="cover-image"');

    // 每页 page xhtml + media-overlay
    expect(opf).toContain('id="page-1" href="page-1.xhtml" media-type="application/xhtml+xml" media-overlay="smil-1"');
    expect(opf).toContain('id="audio-1" href="audio/1.mp3" media-type="audio/mpeg"');
    expect(opf).toContain('id="smil-1" href="smil/page-1.smil" media-type="application/smil+xml"');
    expect(opf).toContain('id="img-1" href="images/1.png" media-type="image/png"');

    // spine 含每页
    expect(opf).toContain('<itemref idref="cover"/>');
    expect(opf).toContain('<itemref idref="page-1"/>');
    expect(opf).toContain('<itemref idref="page-2"/>');

    // nav
    expect(opf).toContain('properties="nav"');
  });

  test("page 0 text 为空时仍出现在 manifest 但无 media-overlay", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-2",
      title: "无封面音频",
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [
        { pageNum: 0, durationMs: 0 },  // 0 表示无音频
        { pageNum: 1, durationMs: 3000 },
      ],
    });

    expect(opf).toContain('id="cover" href="page-0.xhtml" media-type="application/xhtml+xml"');
    expect(opf).not.toContain('id="cover" href="page-0.xhtml" media-type="application/xhtml+xml" media-overlay');
    expect(opf).toContain('media-overlay="smil-1"');
  });

  test("XML 特殊字符被转义", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-3",
      title: '<script>"邪恶"&',
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [{ pageNum: 0, durationMs: 1000 }],
    });
    expect(opf).toContain("&lt;script&gt;&quot;邪恶&quot;&amp;");
  });
});
