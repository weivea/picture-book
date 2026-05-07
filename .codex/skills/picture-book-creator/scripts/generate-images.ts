/**
 * 批量生成绘本页面 PNG。
 *
 * 读取 prompts 目录中的 0.txt ~ N.txt，每个文件调用 image-generation 脚本生成同编号 PNG。
 * 用于 Codex Desktop App 的并发生图调度。
 *
 * 用法：
 *   bun run images -- --prompts output/<topic>/prompts --output output/<topic> --concurrency 4
 */

import { parseArgs } from "util";
import { readdir, readFile, stat } from "fs/promises";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

type Task = {
  page: number;
  promptPath: string;
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
    prompts: { type: "string" },
    output: { type: "string" },
    concurrency: { type: "string", default: "4" },
    quality: { type: "string", default: "high" },
    "min-kb": { type: "string", default: "100" },
  },
  strict: true,
});

function die(message: string): never {
  console.error(`[generate-images] ${message}`);
  process.exit(1);
}

if (!values.prompts) die("缺少必填参数 --prompts <prompt 目录>");
if (!values.output) die("缺少必填参数 --output <图片输出目录>");

const concurrency = Number.parseInt(values.concurrency!, 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  die(`--concurrency 必须是 1-8 的整数，收到 "${values.concurrency}"`);
}

const minKb = Number.parseInt(values["min-kb"]!, 10);
if (!Number.isInteger(minKb) || minKb < 1) {
  die(`--min-kb 必须是正整数，收到 "${values["min-kb"]}"`);
}

const promptsDir = resolve(values.prompts);
const outputDir = resolve(values.output);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const imageScript = resolve(
  scriptDir,
  "..",
  "..",
  "image-generation",
  "scripts",
  "generate-image.ts"
);

const promptFiles = (await readdir(promptsDir))
  .filter((file) => /^\d+\.txt$/.test(file))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

if (promptFiles.length === 0) {
  die(`没有在 ${promptsDir} 找到 0.txt ~ N.txt 格式的 prompt 文件`);
}

const tasks: Task[] = promptFiles.map((file) => {
  const page = Number.parseInt(file, 10);
  return {
    page,
    promptPath: join(promptsDir, file),
    outputPath: join(outputDir, `${page}.png`),
  };
});

async function runOne(task: Task): Promise<Result> {
  const prompt = (await readFile(task.promptPath, "utf-8")).trim();
  if (!prompt) {
    return {
      task,
      ok: false,
      stdout: "",
      stderr: "Prompt 为空",
      code: 1,
    };
  }

  const child = spawn(
    "bun",
    [
      "run",
      imageScript,
      "--output",
      task.outputPath,
      "--ratio",
      "1:1",
      "--quality",
      values.quality!,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    }
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

  child.stdin.end(prompt);

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

  const fileStat = await stat(task.outputPath).catch(() => null);
  const sizeKb = fileStat ? fileStat.size / 1024 : 0;
  if (sizeKb < minKb) {
    return {
      task,
      ok: false,
      stdout,
      stderr: `${stderr}\n输出文件小于 ${minKb} KB：${sizeKb.toFixed(1)} KB`.trim(),
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
    console.log(`[generate-images] page ${task.page}: start`);
    const result = await runOne(task);
    results.push(result);
    if (result.ok) {
      console.log(
        `[generate-images] page ${task.page}: ok (${result.sizeKb!.toFixed(1)} KB)`
      );
    } else {
      console.error(`[generate-images] page ${task.page}: failed`);
      if (result.stderr.trim()) console.error(result.stderr.trim());
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
);

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(
    `[generate-images] ${failed.length}/${tasks.length} pages failed: ` +
      failed.map((result) => result.task.page).join(", ")
  );
  process.exit(1);
}

console.log(`[generate-images] all ${tasks.length} pages generated in ${outputDir}`);
