/**
 * 把已有静态绘本 output/<topic>/ + audio/ 子目录重打包成 EPUB3 Media Overlays。
 *
 * 用法：
 *   bun run .codex/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
 *     --topic-dir output/<topic> \
 *     --title "<书名>" \
 *     --author "<作者>" \
 *     --lang zh \
 *     --voice zh-CN-XiaoyiNeural \
 *     [--output <epub 路径>]   # 默认 <topic-dir>/<title>-audio.epub
 *
 * 前提：<topic-dir>/audio/ 下已有 0.mp3 ~ N.mp3 + 同名 .json（由 text-to-speech 产出）
 */
import { parseArgs } from "util";
import { resolve, join, basename } from "path";
import { readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import JSZip from "jszip";
import { spawnSync } from "child_process";
import { buildPageXhtml } from "./lib/xhtml-builder";
import { buildSmil } from "./lib/smil-builder";
import { buildOpf, type PageMeta } from "./lib/opf-builder";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "topic-dir": { type: "string" },
    title: { type: "string" },
    author: { type: "string", default: "AI Picture Book Creator" },
    lang: { type: "string", default: "zh" },
    voice: { type: "string", default: "zh-CN-XiaoyiNeural" },
    output: { type: "string" },
    width: { type: "string", default: "2048" },
    height: { type: "string", default: "2048" },
  },
});

if (!values["topic-dir"] || !values.title) {
  console.error(
    "Usage: --topic-dir <dir> --title <title> [--author <author>] [--lang <lang>] [--voice <voice>] [--output <path>]"
  );
  process.exit(1);
}

const topicDir = resolve(values["topic-dir"]);
const audioDir = join(topicDir, "audio");
const outputPath =
  values.output ?? join(topicDir, `${values.title}-audio.epub`);
const vpW = parseInt(values.width!, 10);
const vpH = parseInt(values.height!, 10);

// 1. 收集所有页面 png
const files = await readdir(topicDir);
const pngFiles = files
  .filter((f) => /^\d+\.png$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

if (pngFiles.length === 0) {
  console.error(`未在 ${topicDir} 找到编号 png 文件`);
  process.exit(1);
}

const pageNums = pngFiles.map((f) => parseInt(f, 10));

// 2. 对每页加载 audio 与 timestamps（缺失则该页无音频）
interface PageData {
  pageNum: number;
  imageFile: string;       // 如 "1.png"
  audioBuf: Buffer | null;
  durationMs: number;      // 0 表示无音频
  sentences: Array<{ text: string; start_ms: number; end_ms: number }>;
}

const pageDataList: PageData[] = [];
for (const pageNum of pageNums) {
  const imgFile = `${pageNum}.png`;
  const mp3Path = join(audioDir, `${pageNum}.mp3`);
  const jsonPath = join(audioDir, `${pageNum}.json`);

  let audioBuf: Buffer | null = null;
  let durationMs = 0;
  let sentences: PageData["sentences"] = [];

  if (existsSync(mp3Path) && existsSync(jsonPath)) {
    audioBuf = await readFile(mp3Path);
    const json = JSON.parse(await readFile(jsonPath, "utf-8"));
    durationMs = json.duration_ms ?? 0;
    sentences = json.sentences ?? [];
    if (json.timestamps_adjusted) {
      console.warn(`页 ${pageNum}: 时间戳已按比例重整（原始边界与 mp3 时长偏差 > 10%）`);
    }
  } else {
    console.warn(`页 ${pageNum}: 缺少 mp3 或 json，跳过音频，仅作为静态页`);
  }

  pageDataList.push({
    pageNum,
    imageFile: imgFile,
    audioBuf,
    durationMs,
    sentences,
  });
}

// 3. 构建 EPUB zip
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

// 4. 加资源
for (const pd of pageDataList) {
  const imgData = await readFile(join(topicDir, pd.imageFile));
  zip.file(`OEBPS/images/${pd.imageFile}`, imgData);

  if (pd.audioBuf) {
    zip.file(`OEBPS/audio/${pd.pageNum}.mp3`, pd.audioBuf);
    const smil = buildSmil({
      pageNum: pd.pageNum,
      sentences: pd.sentences,
    });
    zip.file(`OEBPS/smil/page-${pd.pageNum}.smil`, smil);
  }

  const xhtml = buildPageXhtml({
    pageNum: pd.pageNum,
    imageFile: pd.imageFile,
    sentences: pd.sentences.map((s) => s.text),
    viewportWidth: vpW,
    viewportHeight: vpH,
  });
  zip.file(`OEBPS/page-${pd.pageNum}.xhtml`, xhtml);
}

// 5. 生成 content.opf
const bookId = `urn:uuid:${crypto.randomUUID()}`;
const modifiedISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const opfPages: PageMeta[] = pageDataList.map((pd) => ({
  pageNum: pd.pageNum,
  durationMs: pd.durationMs,
}));

const opf = buildOpf({
  bookId,
  title: values.title!,
  author: values.author!,
  lang: values.lang!,
  voice: values.voice!,
  modifiedISO,
  pages: opfPages,
});
zip.file("OEBPS/content.opf", opf);

// 6. 生成 nav.xhtml
const navItems = pageDataList
  .map(
    (pd) =>
      `      <li><a href="page-${pd.pageNum}.xhtml">${
        pd.pageNum === 0 ? "封面" : `第 ${pd.pageNum} 页`
      }</a></li>`
  )
  .join("\n");

zip.file(
  "OEBPS/nav.xhtml",
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`
);

// 7. 写出 EPUB
const buffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
await writeFile(outputPath, buffer);

const totalDurMs = pageDataList.reduce((acc, pd) => acc + pd.durationMs, 0);
console.log(`Audio EPUB generated: ${outputPath}`);
console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
console.log(`Pages: ${pageDataList.length} (含封面)`);
console.log(`Total audio duration: ${(totalDurMs / 1000).toFixed(1)}s`);

// 8. 可选 epubcheck
const lookupCommand = process.platform === "win32" ? "where" : "which";
const epubcheck = spawnSync(lookupCommand, ["epubcheck"], { encoding: "utf-8" });
if (epubcheck.status === 0) {
  console.log("\n=== epubcheck ===");
  const result = spawnSync("epubcheck", [outputPath], { stdio: "inherit" });
  if (result.status !== 0) {
    console.warn("epubcheck 报告问题，请检查上方输出");
  }
} else {
  console.log("\n未检测到 epubcheck，跳过结构校验。");
  console.log("建议安装 epubcheck 并确保它在 PATH 中。");
}
