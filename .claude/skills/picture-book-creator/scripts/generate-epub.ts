/**
 * 将绘本图片目录转换为 Fixed-Layout EPUB 电子书
 * 支持两种模式:
 *   1) 单册:  --input <dir> --title <title>
 *   2) 合订:  --omnibus --series-root <dir> --volumes "id1,id2,..." --title <title>
 */

import { parseArgs } from "util";
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { resolve, join } from "path";
import JSZip from "jszip";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    // shared
    title: { type: "string" },
    author: { type: "string", default: "AI Picture Book Creator" },
    lang: { type: "string", default: "zh" },
    output: { type: "string" },
    width: { type: "string", default: "2048" },
    height: { type: "string", default: "2048" },
    // single-volume
    input: { type: "string" },
    // omnibus
    omnibus: { type: "boolean", default: false },
    "series-root": { type: "string" },
    volumes: { type: "string" },
  },
});

const vpW = parseInt(values.width!);
const vpH = parseInt(values.height!);

if (!values.title) {
  console.error("--title is required");
  process.exit(1);
}

if (values.omnibus) {
  if (!values["series-root"] || !values.volumes) {
    console.error("Omnibus mode requires --series-root and --volumes");
    process.exit(1);
  }
  const seriesRoot = resolve(values["series-root"]!);
  const volumeIds = values.volumes!.split(",").map((s) => s.trim()).filter(Boolean);
  const out = values.output ?? join(seriesRoot, "omnibus", `${values.title}.epub`);
  await buildOmnibusEpub({
    seriesRoot, volumeIds, title: values.title!, author: values.author!,
    lang: values.lang!, output: out, vpW, vpH,
  });
} else {
  if (!values.input) {
    console.error("Single-volume mode requires --input");
    process.exit(1);
  }
  const inputDir = resolve(values.input!);
  const out = values.output ?? join(inputDir, `${values.title}.epub`);
  await buildSingleVolumeEpub({
    inputDir, title: values.title!, author: values.author!,
    lang: values.lang!, output: out, vpW, vpH,
  });
}

// ---------------- shared helpers ----------------

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function readPageTexts(scriptPath: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const content = await readFile(scriptPath, "utf-8");
    const re = /## 第 (\d+) 页[\s\S]*?\*\*text\*\*[：:]\s*(.+)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      map.set(parseInt(m[1]!), m[2]!.trim());
    }
  } catch {
    // missing script.md is OK
  }
  return map;
}

async function listPngFiles(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  return all.filter((f) => /^\d+\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
}

function pageXhtmlImg(imgHref: string, pageNum: number, text: string | undefined, vpW: number, vpH: number): string {
  const textHtml = text
    ? `\n  <p style="position:absolute;bottom:2%;left:5%;right:5%;text-align:center;font-size:2.5em;color:#333;font-family:serif;line-height:1.6;margin:0;">${escapeXml(text)}</p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${vpW}, height=${vpH}"/>
  <title>第 ${pageNum} 页</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <img src="${imgHref}" alt="第${pageNum}页"/>${textHtml}
</body>
</html>`;
}

function dividerXhtml(label: string, vpW: number, vpH: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${vpW}, height=${vpH}"/>
  <title>${escapeXml(label)}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #faf6ef; font-family: serif; }
    h1 { font-size: 4em; color: #444; text-align: center; }
  </style>
</head>
<body><h1>${escapeXml(label)}</h1></body>
</html>`;
}

function baseOpfMeta(bookId: string, title: string, author: string, lang: string, now: string): string {
  return `    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:orientation">auto</meta>`;
}

function makeBaseZip(): JSZip {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  return zip;
}

// ---------------- single-volume builder ----------------

interface SingleArgs {
  inputDir: string; title: string; author: string; lang: string;
  output: string; vpW: number; vpH: number;
}

async function buildSingleVolumeEpub(a: SingleArgs): Promise<void> {
  const pngFiles = await listPngFiles(a.inputDir);
  if (pngFiles.length === 0) {
    console.error(`No numbered PNG files found in ${a.inputDir}`);
    process.exit(1);
  }
  const pageTexts = await readPageTexts(join(a.inputDir, "script.md"));
  if (pageTexts.size > 0) console.log(`Extracted text for ${pageTexts.size} pages from script.md`);

  const coverFile = pngFiles.find((f) => parseInt(f) === 0) ?? pngFiles[0]!;
  const contentPages = pngFiles.filter((f) => f !== coverFile);

  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const zip = makeBaseZip();
  for (const f of pngFiles) zip.file(`OEBPS/images/${f}`, await readFile(join(a.inputDir, f)));
  zip.file("OEBPS/cover.xhtml", pageXhtmlImg(`images/${coverFile}`, 0, pageTexts.get(0), a.vpW, a.vpH));
  for (const f of contentPages) {
    const n = parseInt(f);
    zip.file(`OEBPS/page-${n}.xhtml`, pageXhtmlImg(`images/${f}`, n, pageTexts.get(n), a.vpW, a.vpH));
  }
  const manifest = [
    `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `    <item id="cover-image" href="images/${coverFile}" media-type="image/png" properties="cover-image"/>`,
    ...contentPages.map((f) => `    <item id="page-${parseInt(f)}" href="page-${parseInt(f)}.xhtml" media-type="application/xhtml+xml"/>`),
    ...contentPages.map((f) => `    <item id="img-${parseInt(f)}" href="images/${f}" media-type="image/png"/>`),
  ];
  const spine = [
    `    <itemref idref="cover"/>`,
    ...contentPages.map((f) => `    <itemref idref="page-${parseInt(f)}"/>`),
  ];
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${baseOpfMeta(bookId, a.title, a.author, a.lang, now)}
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifest.join("\n")}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spine.join("\n")}
  </spine>
</package>`);

  const navItems = [
    `      <li><a href="cover.xhtml">封面</a></li>`,
    ...contentPages.map((f) => `      <li><a href="page-${parseInt(f)}.xhtml">第 ${parseInt(f)} 页</a></li>`),
  ];
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${navItems.join("\n")}
    </ol>
  </nav>
</body>
</html>`);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(a.output, buffer);
  console.log(`EPUB generated: ${a.output}`);
  console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Pages: ${contentPages.length} (+ cover)`);
}

// ---------------- omnibus builder ----------------

interface OmnibusArgs {
  seriesRoot: string; volumeIds: string[]; title: string; author: string; lang: string;
  output: string; vpW: number; vpH: number;
}

async function buildOmnibusEpub(a: OmnibusArgs): Promise<void> {
  // Validate every volume directory exists and collect its pages.
  const perVolume: { id: string; dir: string; files: string[]; texts: Map<number, string> }[] = [];
  for (const id of a.volumeIds) {
    const dir = join(a.seriesRoot, "volumes", id);
    try {
      await stat(dir);
    } catch {
      console.error(`Volume directory missing: ${dir}`);
      process.exit(1);
    }
    const files = await listPngFiles(dir);
    if (files.length === 0) {
      console.error(`Volume ${id} has no numbered PNGs in ${dir}`);
      process.exit(1);
    }
    const texts = await readPageTexts(join(dir, "script.md"));
    perVolume.push({ id, dir, files, texts });
  }

  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const zip = makeBaseZip();

  // Add all images namespaced by volume.
  for (const v of perVolume) {
    for (const f of v.files) {
      zip.file(`OEBPS/images/${v.id}/${f}`, await readFile(join(v.dir, f)));
    }
  }

  // Cover = first volume's page 0 (or its first page if no 0).
  const firstVol = perVolume[0]!;
  const coverFile = firstVol.files.find((f) => parseInt(f) === 0) ?? firstVol.files[0]!;
  const coverHref = `images/${firstVol.id}/${coverFile}`;
  zip.file("OEBPS/cover.xhtml", pageXhtmlImg(coverHref, 0, firstVol.texts.get(0), a.vpW, a.vpH));

  // Per-volume divider + content pages.
  const manifestItems: string[] = [
    `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `    <item id="cover-image" href="${coverHref}" media-type="image/png" properties="cover-image"/>`,
  ];
  const spineItems: string[] = [`    <itemref idref="cover"/>`];
  const navGroups: string[] = [];

  for (const v of perVolume) {
    // Divider.
    zip.file(`OEBPS/divider-${v.id}.xhtml`, dividerXhtml(v.id, a.vpW, a.vpH));
    manifestItems.push(`    <item id="divider-${v.id}" href="divider-${v.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="divider-${v.id}"/>`);

    const navInner: string[] = [`        <li><a href="divider-${v.id}.xhtml">${escapeXml(v.id)}</a></li>`];

    // Content pages: skip the cover image of the FIRST volume only (already used as omnibus cover);
    // for all other volumes, include their page 0 as a normal interior page.
    const pagesToEmit = v === firstVol
      ? v.files.filter((f) => f !== coverFile)
      : v.files;

    for (const f of pagesToEmit) {
      const n = parseInt(f);
      const xhtmlName = `page-${v.id}-${n}.xhtml`;
      zip.file(`OEBPS/${xhtmlName}`, pageXhtmlImg(`images/${v.id}/${f}`, n, v.texts.get(n), a.vpW, a.vpH));
      manifestItems.push(`    <item id="page-${v.id}-${n}" href="${xhtmlName}" media-type="application/xhtml+xml"/>`);
      manifestItems.push(`    <item id="img-${v.id}-${n}" href="images/${v.id}/${f}" media-type="image/png"/>`);
      spineItems.push(`    <itemref idref="page-${v.id}-${n}"/>`);
      navInner.push(`        <li><a href="${xhtmlName}">第 ${n} 页</a></li>`);
    }

    // Also register the cover image of the first volume (used by cover.xhtml) — but as cover-image, not duplicated as img.
    navGroups.push(`      <li>${escapeXml(v.id)}\n        <ol>\n${navInner.join("\n")}\n        </ol>\n      </li>`);
  }

  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${baseOpfMeta(bookId, a.title, a.author, a.lang, now)}
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`);

  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="cover.xhtml">封面</a></li>
${navGroups.join("\n")}
    </ol>
  </nav>
</body>
</html>`);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(a.output, buffer);
  console.log(`Omnibus EPUB generated: ${a.output}`);
  console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Volumes: ${perVolume.length}, total pages: ${perVolume.reduce((s, v) => s + v.files.length, 0)}`);
}
