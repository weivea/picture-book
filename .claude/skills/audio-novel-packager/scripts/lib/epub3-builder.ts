// .claude/skills/audio-novel-packager/scripts/lib/epub3-builder.ts

import JSZip from "jszip";
import type { Sentence } from "./chapter-splitter";

export interface SceneRender {
  sentences: Sentence[];
  illustration: { src: string; alt: string } | null;
}

export interface ChapterRenderInput {
  chapterIndex: number;
  title: string;
  scenes: SceneRender[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderChapterXhtml(input: ChapterRenderInput): string {
  const chId = pad2(input.chapterIndex);
  const blocks: string[] = [];
  let globalIdx = 0;
  for (const scene of input.scenes) {
    if (scene.illustration) {
      blocks.push(
        `<figure><img src="${escapeXml(scene.illustration.src)}" alt="${escapeXml(scene.illustration.alt)}"/></figure>`,
      );
    }
    const paragraphs: string[] = [];
    for (const s of scene.sentences) {
      paragraphs.push(
        `<span id="s_${chId}_${pad3(globalIdx)}">${escapeXml(s.text)}</span>`,
      );
      globalIdx++;
    }
    if (paragraphs.length) blocks.push(`<p>${paragraphs.join("")}</p>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(input.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/novel.css"/>
</head>
<body>
  <h1>${escapeXml(input.title)}</h1>
  ${blocks.join("\n  ")}
</body>
</html>`;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  mediaOverlay?: string;
  properties?: string;
}

export interface PackEpubInput {
  basename: string;
  manifest: ManifestItem[];
  spine: string[]; // idref order
  extraFiles: Array<{ path: string; data: string | Buffer }>; // 例如 chapters/*.xhtml, *.smil, audio/*
  opfXml?: string;
  navXhtml?: string;
}

function stubOpf(input: PackEpubInput): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${input.basename}</dc:identifier>
    <dc:title>${escapeXml(input.basename)}</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    ${input.manifest
      .map(
        (m) =>
          `<item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${
            m.mediaOverlay ? ` media-overlay="${m.mediaOverlay}"` : ""
          }${m.properties ? ` properties="${m.properties}"` : ""}/>`,
      )
      .join("\n    ")}
  </manifest>
  <spine>
    ${input.spine.map((id) => `<itemref idref="${id}"/>`).join("\n    ")}
  </spine>
</package>`;
}

export async function packEpub(input: PackEpubInput): Promise<Buffer> {
  const z = new JSZip();

  // 1. mimetype 必须第一个 entry，store（不压缩）
  z.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. container.xml
  z.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3. content.opf（如果调用方没传则给一个 stub，集成时由 opf-builder 填）
  z.file("OEBPS/content.opf", input.opfXml ?? stubOpf(input));

  // 4. nav.xhtml（如果有）
  if (input.navXhtml) z.file("OEBPS/nav.xhtml", input.navXhtml);

  // 5. extra files
  for (const f of input.extraFiles) {
    z.file(`OEBPS/${f.path}`, f.data);
  }

  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
