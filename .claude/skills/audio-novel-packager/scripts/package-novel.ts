#!/usr/bin/env bun
// .claude/skills/audio-novel-packager/scripts/package-novel.ts

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { parseScenes } from "../../novel-chapter-workshop/scripts/lib/scene-marker-parser";
import { splitToSentences, type Sentence } from "./lib/chapter-splitter";
import { resolveVoice, type CharacterVoice } from "./lib/voice-resolver";
import {
  renderChapterXhtml,
  packEpub,
  type SceneRender,
  type ManifestItem,
} from "./lib/epub3-builder";
import { msToClipMs, msToISO8601 } from "../../audio-picture-book-creator/scripts/lib/duration";

const VALID_STAGES = ["tts", "epub", "archive", "all"] as const;
type Stage = (typeof VALID_STAGES)[number];

const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    stage: { type: "string" },
    basename: { type: "string" },
  },
  strict: true,
});
if (!values["output-dir"] || !values.stage) {
  console.error("用法: --output-dir <dir> --stage tts|epub|archive|all [--basename <name>]");
  process.exit(1);
}
const stage = values.stage as Stage;
if (!VALID_STAGES.includes(stage)) {
  console.error(`--stage 必须是 ${VALID_STAGES.join("|")}，收到 "${values.stage}"`);
  process.exit(1);
}

const outputDir = resolve(values["output-dir"] as string);
type State = { project?: string; phase?: string; [k: string]: unknown };
let state: State;
try {
  state = JSON.parse(await readFile(join(outputDir, "state.json"), "utf8"));
} catch {
  state = {};
}
const proj = (values.basename as string | undefined) ?? state.project ?? "novel";

// === 公共：读 characters + narrator voice ===
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const charBlocks = charactersMd.replace(/\r\n/g, "\n").split(/^## /m).slice(1);
const characters: CharacterVoice[] = charBlocks.map((b) => {
  const name = b.split("\n")[0].trim();
  const voice = b.match(/voice_profile:\s*([\w-]+)/)?.[1] ?? "zh-CN-YunyangNeural";
  return { name, voice };
});
const NARRATOR_VOICE =
  characters.find((c) => c.name === "旁白")?.voice ?? "zh-CN-YunyangNeural";

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

// === stage = tts ===
async function runTts(): Promise<void> {
  const chaptersDir = join(outputDir, "chapters");
  const audioDir = join(outputDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const files = (await readdir(chaptersDir))
    .filter((f) => /^ch_\d+\.md$/.test(f))
    .sort();
  const resolvedAll: Record<
    string,
    Array<{ idx: number; speaker: string; voice: string; text: string }>
  > = {};

  for (const file of files) {
    const chN = parseInt(file.match(/^ch_(\d+)\.md$/)![1], 10);
    const padded = pad2(chN);
    const md = await readFile(join(chaptersDir, file), "utf8");
    const scenes = parseScenes(md);
    const all: Sentence[] = [];
    for (const scene of scenes) {
      const sents = splitToSentences(scene.body, scene.participants);
      sents.forEach((s) => all.push({ ...s, idx: all.length }));
    }
    const resolved = all.map((s) => ({
      idx: s.idx,
      speaker: s.speaker,
      voice: resolveVoice(s.speaker, characters, NARRATOR_VOICE),
      text: s.text,
    }));
    resolvedAll[String(chN)] = resolved;

    // 逐句 TTS
    const fragmentsDir = join(audioDir, `_frag_ch_${padded}`);
    await mkdir(fragmentsDir, { recursive: true });
    const timing: Array<{
      idx: number;
      text: string;
      speaker: string;
      start_ms: number;
      dur_ms: number;
    }> = [];
    let cursorMs = 0;
    for (const s of resolved) {
      const out = join(fragmentsDir, `${pad4(s.idx)}.mp3`);
      await spawnP("bun", [
        "run",
        ".claude/skills/text-to-speech/scripts/generate-audio.ts",
        "--text",
        s.text,
        "--voice",
        s.voice,
        "--output",
        out,
      ]);
      const durMs = Math.round((await ffprobeDuration(out)) * 1000);
      timing.push({
        idx: s.idx,
        text: s.text,
        speaker: s.speaker,
        start_ms: cursorMs,
        dur_ms: durMs,
      });
      cursorMs += durMs;
    }

    // ffmpeg concat
    const listFile = join(fragmentsDir, "list.txt");
    await writeFile(
      listFile,
      timing.map((t) => `file '${join(fragmentsDir, pad4(t.idx) + ".mp3")}'`).join("\n"),
    );
    const finalMp3 = join(audioDir, `ch_${padded}.mp3`);
    await spawnP("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      finalMp3,
    ]);

    await writeFile(
      join(chaptersDir, `ch_${padded}.timing.json`),
      JSON.stringify(timing, null, 2),
    );
    await writeFile(
      join(chaptersDir, `ch_${padded}.split.json`),
      JSON.stringify(resolved, null, 2),
    );
    console.log(`✓ tts ch_${chN} (${timing.length} sentences, ${(cursorMs / 1000).toFixed(1)}s)`);
  }
  await writeFile(join(outputDir, "voice-resolved.json"), JSON.stringify(resolvedAll, null, 2));
}

// === stage = epub ===
function buildChapterSmil(
  chapterPadded: string,
  timing: Array<{ idx: number; start_ms: number; dur_ms: number }>,
): string {
  const pars = timing
    .map((t) => {
      const sid = `s_${chapterPadded}_${pad3(t.idx)}`;
      return `      <par id="par_${sid}">
        <text src="../chapters/ch_${chapterPadded}.xhtml#${sid}"/>
        <audio src="../audio/ch_${chapterPadded}.mp3" clipBegin="${msToClipMs(t.start_ms)}" clipEnd="${msToClipMs(t.start_ms + t.dur_ms)}"/>
      </par>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq_ch_${chapterPadded}" epub:textref="../chapters/ch_${chapterPadded}.xhtml" epub:type="bodymatter chapter">
${pars}
    </seq>
  </body>
</smil>`;
}

function buildNavXhtml(args: {
  title: string;
  language: string;
  chapters: Array<{ idPadded: string; title: string }>;
}): string {
  const lis = args.chapters
    .map(
      (c) =>
        `      <li><a href="chapters/ch_${c.idPadded}.xhtml">${c.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${args.language}" lang="${args.language}">
<head>
  <meta charset="utf-8"/>
  <title>${args.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${lis}
    </ol>
  </nav>
</body>
</html>`;
}

// 用 sha1(项目名) 派生稳定的 UUID v5-like 字符串（不依赖外部库）。
// dc:identifier 必须是合法 URN；之前用中文 "出租车一家自驾游" 会让阅读器降级。
function deriveStableUuid(seed: string): string {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function buildNovelOpf(args: {
  uid: string;
  title: string;
  language: string;
  manifest: ManifestItem[];
  spine: string[];
  durations: Array<{ smilId: string; durMs: number }>;
}): string {
  const durationRefines = args.durations
    .map((d) => `    <meta property="media:duration" refines="#${d.smilId}">${msToISO8601(d.durMs)}</meta>`)
    .join("\n");
  const totalMs = args.durations.reduce((a, d) => a + d.durMs, 0);
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" xml:lang="${args.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${args.uid}</dc:identifier>
    <dc:title>${args.title}</dc:title>
    <dc:language>${args.language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
${durationRefines}
    <meta property="media:duration">${msToISO8601(totalMs)}</meta>
    <meta property="media:active-class">-epub-media-overlay-active</meta>
  </metadata>
  <manifest>
    ${args.manifest
      .map(
        (m) =>
          `<item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${
            m.mediaOverlay ? ` media-overlay="${m.mediaOverlay}"` : ""
          }${m.properties ? ` properties="${m.properties}"` : ""}/>`,
      )
      .join("\n    ")}
  </manifest>
  <spine>
    ${args.spine.map((id) => `<itemref idref="${id}"/>`).join("\n    ")}
  </spine>
</package>`;
}

async function runEpub(): Promise<void> {
  const chaptersDir = join(outputDir, "chapters");
  const distDir = join(outputDir, "dist");
  await mkdir(distDir, { recursive: true });
  const files = (await readdir(chaptersDir))
    .filter((f) => /^ch_\d+\.md$/.test(f))
    .sort();

  const extra: Array<{ path: string; data: string | Buffer }> = [];
  const manifest: ManifestItem[] = [];
  const spine: string[] = [];
  const durations: Array<{ smilId: string; durMs: number }> = [];
  const chapterTitles: Array<{ idPadded: string; title: string }> = [];

  // CSS
  extra.push({
    path: "styles/novel.css",
    data: "body{font-family:serif;line-height:1.7;} figure{margin:1em 0;text-align:center;} img{max-width:100%;} .-epub-media-overlay-active{background:#ffe98a;}",
  });
  manifest.push({ id: "css", href: "styles/novel.css", mediaType: "text/css" });

  for (const file of files) {
    const chN = parseInt(file.match(/^ch_(\d+)\.md$/)![1], 10);
    const padded = pad2(chN);
    const md = await readFile(join(chaptersDir, file), "utf8");
    const title =
      md.match(/^title:\s*"?([^"\n]+)"?/m)?.[1] ?? `Chapter ${chN}`;
    chapterTitles.push({ idPadded: padded, title });
    const scenes = parseScenes(md);

    // 用统一规则切句（与 timing.json 保持同序），但 idx 重新全局连续编号。
    let g = 0;
    const renderScenes: SceneRender[] = scenes.map((sc, i) => {
      const sents = splitToSentences(sc.body, sc.participants).map((s) => ({
        ...s,
        idx: g++,
      }));
      return {
        sentences: sents,
        illustration: {
          src: `../illustrations/ch_${padded}/scene_${pad2(i + 1)}.png`,
          alt: sc.title,
        },
      };
    });
    const xhtml = renderChapterXhtml({ chapterIndex: chN, title, scenes: renderScenes });
    extra.push({ path: `chapters/ch_${padded}.xhtml`, data: xhtml });

    // SMIL
    const timing = JSON.parse(
      await readFile(join(chaptersDir, `ch_${padded}.timing.json`), "utf8"),
    ) as Array<{ idx: number; start_ms: number; dur_ms: number }>;
    extra.push({
      path: `audio/ch_${padded}.smil`,
      data: buildChapterSmil(padded, timing),
    });

    // audio file (relative copy)
    const mp3 = await readFile(join(outputDir, "audio", `ch_${padded}.mp3`));
    extra.push({ path: `audio/ch_${padded}.mp3`, data: mp3 });

    // illustrations: copy referenced
    for (let i = 0; i < scenes.length; i++) {
      const ip = `illustrations/ch_${padded}/scene_${pad2(i + 1)}.png`;
      try {
        const png = await readFile(join(outputDir, ip));
        extra.push({ path: ip, data: png });
        manifest.push({
          id: `img_ch${padded}_s${pad2(i + 1)}`,
          href: ip,
          mediaType: "image/png",
        });
      } catch {
        console.warn(`⚠ 缺图: ${ip}（继续，allowed debt）`);
      }
    }

    const smilId = `smil_ch${padded}`;
    manifest.push({
      id: `ch${padded}`,
      href: `chapters/ch_${padded}.xhtml`,
      mediaType: "application/xhtml+xml",
      mediaOverlay: smilId,
    });
    manifest.push({
      id: smilId,
      href: `audio/ch_${padded}.smil`,
      mediaType: "application/smil+xml",
    });
    manifest.push({
      id: `audio_ch${padded}`,
      href: `audio/ch_${padded}.mp3`,
      mediaType: "audio/mpeg",
    });
    spine.push(`ch${padded}`);

    const totalMs = timing.reduce((a, t) => a + t.dur_ms, 0);
    durations.push({ smilId, durMs: totalMs });
  }

  // nav.xhtml — EPUB3 必需。没有它，多数阅读器（含 Thorium / Apple Books）
  // 会把书当成 EPUB2-ish reflowable，不暴露 Media Overlay 的播放控件。
  const navXhtml = buildNavXhtml({
    title: proj,
    language: "zh-CN",
    chapters: chapterTitles,
  });
  extra.push({ path: "nav.xhtml", data: navXhtml });
  manifest.unshift({
    id: "nav",
    href: "nav.xhtml",
    mediaType: "application/xhtml+xml",
    properties: "nav",
  });

  const opfXml = buildNovelOpf({
    uid: deriveStableUuid(proj),
    title: proj,
    language: "zh-CN",
    manifest,
    spine,
    durations,
  });
  const epubBuf = await packEpub({
    basename: proj,
    manifest,
    spine,
    extraFiles: extra,
    opfXml,
  });
  await writeFile(join(distDir, `${proj}.epub`), epubBuf);
  console.log(`✓ epub: ${join(distDir, proj + ".epub")}`);
}

// === stage = archive ===
async function runArchive(): Promise<void> {
  const distDir = join(outputDir, "dist");
  await mkdir(distDir, { recursive: true });
  const chaptersDir = join(outputDir, "chapters");
  const files = (await readdir(chaptersDir))
    .filter((f) => /^ch_\d+\.md$/.test(f))
    .sort();
  const parts: string[] = [];
  for (const file of files) {
    parts.push(await readFile(join(chaptersDir, file), "utf8"));
  }
  await writeFile(join(distDir, `${proj}.md`), parts.join("\n\n---\n\n"));
  state.phase = "packaged";
  await writeFile(join(outputDir, "state.json"), JSON.stringify(state, null, 2));
  console.log(`✓ archive + state.phase=packaged`);
}

// === helpers ===
function spawnP(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const cp = spawn(cmd, args, { stdio: "inherit" });
    cp.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${cmd} exit ${c}`))));
  });
}
async function ffprobeDuration(path: string): Promise<number> {
  return new Promise((res, rej) => {
    const cp = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ]);
    let out = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.on("exit", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe exit ${c}`))));
  });
}

// === dispatch ===
if (stage === "tts" || stage === "all") await runTts();
if (stage === "epub" || stage === "all") await runEpub();
if (stage === "archive" || stage === "all") await runArchive();
