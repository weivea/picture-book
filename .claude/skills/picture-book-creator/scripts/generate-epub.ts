/**
 * 将绘本图片目录转换为 Fixed-Layout EPUB 电子书
 * 每张图片占满一整页，适合 Apple Books 等阅读器
 *
 * 用法：
 *   bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts \
 *     --input output/<topic> \
 *     --title "绘本标题" \
 *     --author "作者名" \
 *     --lang zh
 */

import { parseArgs } from "util";
import { readdir, readFile, writeFile } from "fs/promises";
import { resolve, join } from "path";
import JSZip from "jszip";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: "string" },
    title: { type: "string" },
    author: { type: "string", default: "AI Picture Book Creator" },
    lang: { type: "string", default: "zh" },
    output: { type: "string" },
    width: { type: "string", default: "2048" },
    height: { type: "string", default: "2048" },
  },
});

if (!values.input || !values.title) {
  console.error("Usage: --input <dir> --title <title> [--author <author>] [--lang <lang>] [--output <path>]");
  process.exit(1);
}

const inputDir = resolve(values.input);
const outputPath = values.output ?? join(inputDir, `${values.title}.epub`);
const vpW = parseInt(values.width!);
const vpH = parseInt(values.height!);

// 收集所有 PNG 文件并按编号排序
const files = await readdir(inputDir);
const pngFiles = files
  .filter((f) => /^\d+\.png$/.test(f))
  .sort((a, b) => parseInt(a) - parseInt(b));

if (pngFiles.length === 0) {
  console.error(`No numbered PNG files found in ${inputDir}`);
  process.exit(1);
}

// 解析 script.md 提取每页文字
const pageTexts = new Map<number, string>();
const scriptPath = join(inputDir, "script.md");
try {
  const scriptContent = await readFile(scriptPath, "utf-8");
  const pagePattern = /## 第 (\d+) 页[\s\S]*?\*\*text\*\*[：:]\s*(.+)/g;
  let match;
  while ((match = pagePattern.exec(scriptContent)) !== null) {
    pageTexts.set(parseInt(match[1]!), match[2]!.trim());
  }
  if (pageTexts.size > 0) {
    console.log(`Extracted text for ${pageTexts.size} pages from script.md`);
  }
} catch {
  // script.md 不存在则跳过，EPUB 仅含图片
}

// 封面图片（第 0 页，或没有 0 页时用第 1 页）
const coverFile = pngFiles.find((f) => parseInt(f) === 0) ?? pngFiles[0]!;
const contentPages = pngFiles.filter((f) => f !== coverFile);

const bookId = `urn:uuid:${crypto.randomUUID()}`;
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// --- 构建 EPUB (手工 fixed-layout) ---
const zip = new JSZip();

// mimetype（必须无压缩、第一个文件）
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

// META-INF/container.xml
zip.file(
  "META-INF/container.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
);

// 添加所有图片
for (const f of pngFiles) {
  const imgData = await readFile(join(inputDir, f));
  zip.file(`OEBPS/images/${f}`, imgData);
}

// 每页的 XHTML
function pageXhtml(imgFile: string, pageNum: number, text?: string): string {
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
  <img src="images/${imgFile}" alt="第${pageNum}页"/>${textHtml}
</body>
</html>`;
}

// 封面页
zip.file("OEBPS/cover.xhtml", pageXhtml(coverFile, 0, pageTexts.get(0)));

// 正文页
for (const f of contentPages) {
  const pageNum = parseInt(f);
  zip.file(`OEBPS/page-${pageNum}.xhtml`, pageXhtml(f, pageNum, pageTexts.get(pageNum)));
}

// content.opf
const manifestItems = [
  `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
  `    <item id="cover-image" href="images/${coverFile}" media-type="image/png" properties="cover-image"/>`,
  ...contentPages.map(
    (f) => `    <item id="page-${parseInt(f)}" href="page-${parseInt(f)}.xhtml" media-type="application/xhtml+xml"/>`
  ),
  ...contentPages.map(
    (f) => `    <item id="img-${parseInt(f)}" href="images/${f}" media-type="image/png"/>`
  ),
];

const spineItems = [
  `    <itemref idref="cover"/>`,
  ...contentPages.map((f) => `    <itemref idref="page-${parseInt(f)}"/>`),
];

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(values.title)}</dc:title>
    <dc:creator>${escapeXml(values.author ?? "AI Picture Book Creator")}</dc:creator>
    <dc:language>${values.lang ?? "zh"}</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`;

zip.file("OEBPS/content.opf", opf);

// nav.xhtml (EPUB3 必需)
const navItems = [
  `      <li><a href="cover.xhtml">封面</a></li>`,
  ...contentPages.map(
    (f) => `      <li><a href="page-${parseInt(f)}.xhtml">第 ${parseInt(f)} 页</a></li>`
  ),
];

zip.file(
  "OEBPS/nav.xhtml",
  `<?xml version="1.0" encoding="UTF-8"?>
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
</html>`
);

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 生成 EPUB
try {
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(outputPath, buffer);
  console.log(`EPUB generated: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Pages: ${contentPages.length} (+ cover)`);
} catch (err) {
  console.error("Failed to generate EPUB:", err);
  process.exit(1);
}
