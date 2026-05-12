/**
 * Generate per-page narration audio for a picture-book output directory.
 *
 * Usage:
 *   bun run audio-pages -- --topic-dir output/<topic> --concurrency 2
 */

import { parseArgs } from "util";
import { spawn } from "child_process";
import { mkdir, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parseScript, type PageText } from "./lib/parse-script";

type Task = PageText & {
  outputPath: string;
};

type Result = {
  task: Task;
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  sizeKb?: number;
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "topic-dir": { type: "string" },
    script: { type: "string" },
    concurrency: { type: "string", default: "2" },
    voice: { type: "string", default: "zh-CN-XiaoyiNeural" },
    rate: { type: "string", default: "-10%" },
    volume: { type: "string", default: "+0%" },
    pitch: { type: "string", default: "+0Hz" },
    "min-kb": { type: "string", default: "5" },
  },
  strict: true,
});

function die(message: string): never {
  console.error(`[generate-audio-pages] ${message}`);
  process.exit(1);
}

if (!values["topic-dir"]) die("缺少必填参数 --topic-dir <output 目录>");

const concurrency = Number.parseInt(values.concurrency!, 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
  die(`--concurrency 必须是 1-2 的整数，收到 "${values.concurrency}"`);
}

const minKb = Number.parseInt(values["min-kb"]!, 10);
if (!Number.isInteger(minKb) || minKb < 1) {
  die(`--min-kb 必须是正整数，收到 "${values["min-kb"]}"`);
}

const topicDir = resolve(values["topic-dir"]);
const scriptPath = resolve(values.script ?? join(topicDir, "script.md"));
const audioDir = join(topicDir, "audio");
await mkdir(audioDir, { recursive: true });

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ttsScript = resolve(
  scriptDir,
  "..",
  "..",
  "text-to-speech",
  "scripts",
  "generate-audio.ts",
);

const pages = (await parseScript(scriptPath)).filter((page) => page.text.trim() !== "");
if (pages.length === 0) {
  die(`没有在 ${scriptPath} 中找到可朗读的 text 字段`);
}

const tasks: Task[] = pages.map((page) => ({
  ...page,
  outputPath: join(audioDir, `${page.pageNum}.mp3`),
}));

async function runOne(task: Task): Promise<Result> {
  const child = spawn(
    "bun",
    [
      "run",
      ttsScript,
      "--output",
      task.outputPath,
      "--voice",
      values.voice!,
      "--rate",
      values.rate!,
      "--volume",
      values.volume!,
      "--pitch",
      values.pitch!,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.end(task.text);

  const code = await new Promise<number | null>((resolveCode) => {
    child.on("error", (err) => {
      stderr += err.message;
      resolveCode(1);
    });
    child.on("close", resolveCode);
  });

  if (code !== 0) {
    return { task, ok: false, stdout, stderr, code };
  }

  const mp3Stat = await stat(task.outputPath).catch(() => null);
  const jsonStat = await stat(task.outputPath.replace(/\.mp3$/i, ".json")).catch(
    () => null,
  );
  const sizeKb = mp3Stat ? mp3Stat.size / 1024 : 0;
  if (!mp3Stat || !jsonStat || sizeKb < minKb) {
    return {
      task,
      ok: false,
      stdout,
      stderr: `${stderr}\n输出音频或时间戳校验失败：${sizeKb.toFixed(1)} KB`.trim(),
      code,
      sizeKb,
    };
  }

  return { task, ok: true, stdout, stderr, code, sizeKb };
}

const results: Result[] = [];
let cursor = 0;

async function worker() {
  while (cursor < tasks.length) {
    const task = tasks[cursor++]!;
    console.log(`[generate-audio-pages] page ${task.pageNum}: start`);
    const result = await runOne(task);
    results.push(result);
    if (result.ok) {
      console.log(
        `[generate-audio-pages] page ${task.pageNum}: ok (${result.sizeKb!.toFixed(1)} KB)`,
      );
    } else {
      console.error(`[generate-audio-pages] page ${task.pageNum}: failed`);
      if (result.stderr.trim()) console.error(result.stderr.trim());
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
);

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(
    `[generate-audio-pages] ${failed.length}/${tasks.length} pages failed: ` +
      failed.map((result) => result.task.pageNum).join(", "),
  );
  process.exit(1);
}

console.log(`[generate-audio-pages] all ${tasks.length} pages generated in ${audioDir}`);
