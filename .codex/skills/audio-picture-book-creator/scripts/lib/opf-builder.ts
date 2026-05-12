import { msToISO8601 } from "./duration";

export interface PageMeta {
  pageNum: number;
  durationMs: number;       // 0 表示该页无音频（封面 text 为空）
}

export interface BuildOpfInput {
  bookId: string;
  title: string;
  author: string;
  lang: string;
  voice: string;
  modifiedISO: string;
  pages: PageMeta[];        // 必须按 pageNum 升序，page 0 为封面
}

/**
 * 生成 EPUB3 content.opf。
 * 约定：page 0 是封面，其他页是正文。
 * 路径全部相对 OEBPS/ 根。
 */
export function buildOpf(input: BuildOpfInput): string {
  const { bookId, title, author, lang, voice, modifiedISO, pages } = input;

  const totalDurationMs = pages.reduce((acc, p) => acc + p.durationMs, 0);

  // metadata: media:duration refines per smil
  const durationRefines = pages
    .filter((p) => p.durationMs > 0)
    .map(
      (p) =>
        `    <meta property="media:duration" refines="#smil-${p.pageNum}">${msToISO8601(
          p.durationMs
        )}</meta>`
    )
    .join("\n");

  // manifest items
  const manifestItems: string[] = [];

  for (const p of pages) {
    const isCover = p.pageNum === 0;
    const xhtmlId = isCover ? "cover" : `page-${p.pageNum}`;
    const xhtmlHref = `page-${p.pageNum}.xhtml`;
    const overlayAttr =
      p.durationMs > 0 ? ` media-overlay="smil-${p.pageNum}"` : "";

    manifestItems.push(
      `    <item id="${xhtmlId}" href="${xhtmlHref}" media-type="application/xhtml+xml"${overlayAttr}/>`
    );

    // image
    const imgProp = isCover ? ` properties="cover-image"` : "";
    manifestItems.push(
      `    <item id="img-${p.pageNum}" href="images/${p.pageNum}.png" media-type="image/png"${imgProp}/>`
    );

    // audio + smil（仅当有音频）
    if (p.durationMs > 0) {
      manifestItems.push(
        `    <item id="audio-${p.pageNum}" href="audio/${p.pageNum}.mp3" media-type="audio/mpeg"/>`
      );
      manifestItems.push(
        `    <item id="smil-${p.pageNum}" href="smil/page-${p.pageNum}.smil" media-type="application/smil+xml"/>`
      );
    }
  }

  manifestItems.push(
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
  );

  // spine
  const spineItems = pages
    .map((p) => {
      const idref = p.pageNum === 0 ? "cover" : `page-${p.pageNum}`;
      return `    <itemref idref="${idref}"/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(lang)}</dc:language>
    <dc:date>${modifiedISO}</dc:date>
    <meta property="dcterms:modified">${modifiedISO}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="media:duration">${msToISO8601(totalDurationMs)}</meta>
${durationRefines}
    <meta property="media:active-class">-epub-media-overlay-active</meta>
    <meta property="media:narrator">${escapeXml(voice)}</meta>
    <meta name="cover" content="img-0"/>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
