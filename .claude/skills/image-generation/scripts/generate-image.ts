/**
 * 调用 Azure gpt-image-2 部署生成单张 PNG。
 *
 * 由 image-generation skill 包装；picture-book-creator 在阶段 6 逐页 fork
 * subagent 调用本脚本，每次只生成 1 张图。并发与重试由调用方负责。
 *
 * 用法：
 *   # 方式 1：项目根目录放置 .env，写入 AZURE_API_KEY=...（推荐）
 *   # 方式 2：在当前 shell 显式 export AZURE_API_KEY=...
 *   bun run .claude/skills/image-generation/scripts/generate-image.ts \
 *     --output output/<topic>/0.png \
 *     [--prompt "<text>" | (从 stdin 读取)] \
 *     [--ratio 1:1] \
 *     [--size 1024x1024 | 4K | HD | SD] \
 *     [--quality low | medium | high]
 *
 * 环境变量：
 *   AZURE_API_KEY        必需。从当前 shell env 或向上递归查找的 .env 中加载。
 *   AZURE_IMAGE_ENDPOINT 可选，覆盖默认 endpoint。同样支持 .env。
 *
 * 退出码：
 *   0  生成成功，写入 --output 指定路径
 *   1  参数错误 / 缺少 AZURE_API_KEY / API 调用失败 / 文件写入失败
 */

import { parseArgs } from "util";
import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve, join } from "path";
import { compressPngInPlace, type CompressResult } from "./compress-png";

const DEFAULT_ENDPOINT =
  "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01";

/**
 * 从 cwd 向上递归查找 `.env`，找到第一个就解析进 process.env。
 * 已存在的环境变量不覆盖（显式 export 的优先级高于 .env）。
 * 仅支持最常见格式：`KEY=value`、`#` 注释、两侧引号。
 * 不支持：多行值、变量插值、转义符。需要这些功能时改用 dotenv。
 */
async function loadDotEnvUpwards(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      const text = await readFile(candidate, "utf-8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // 到达文件系统根
    dir = parent;
  }
}

await loadDotEnvUpwards(process.cwd());

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string" },
    prompt: { type: "string" },
    ratio: { type: "string" },
    size: { type: "string" },
    quality: { type: "string", default: "high" },
  },
  strict: true,
});

function die(msg: string, code = 1): never {
  console.error(`[generate-image] ${msg}`);
  process.exit(code);
}

// --- 1. 校验环境 ---
const apiKey = process.env.AZURE_API_KEY;
if (!apiKey) {
  die(
    "AZURE_API_KEY 未设置。请在项目根目录的 `.env` 中填入 AZURE_API_KEY=<your-key>，" +
      "或在当前 shell 执行 `export AZURE_API_KEY=\"<your-key>\"` 后再调用。"
  );
}
const endpoint = process.env.AZURE_IMAGE_ENDPOINT ?? DEFAULT_ENDPOINT;
if (endpoint.includes("<your-resource-name>")) {
  die(
    "AZURE_IMAGE_ENDPOINT 未设置（DEFAULT_ENDPOINT 仅是占位符）。请在项目根目录的 `.env` 中填入" +
      " AZURE_IMAGE_ENDPOINT=https://<你的资源名>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01"
  );
}

// --- 2. 校验参数 ---
if (!values.output) {
  die("缺少必填参数 --output <png 路径>");
}

if (values.ratio && values.ratio !== "1:1") {
  die(
    `当前只支持 --ratio 1:1（收到 "${values.ratio}"）。如需其他比例请扩展脚本。`
  );
}

// MVP：所有 size 统一映射为 1024x1024
const requestedSize = values.size?.trim();
const apiSize = "1024x1024";
if (
  requestedSize &&
  requestedSize !== "1024x1024" &&
  requestedSize.toLowerCase() !== "sd"
) {
  console.error(
    `[generate-image] 注意：--size "${requestedSize}" 暂未实现，将以 1024x1024 生成。`
  );
}

const allowedQuality = new Set(["low", "medium", "high"]);
if (!allowedQuality.has(values.quality!)) {
  die(`--quality 必须是 low / medium / high，收到 "${values.quality}"`);
}

// --- 3. 取 prompt（参数优先，否则 stdin）---
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const prompt = (values.prompt ?? (await readStdin())).trim();
if (!prompt) {
  die("Prompt 为空。请用 --prompt 传入或通过 stdin 喂入文本。");
}

// --- 4. 准备输出目录 ---
const outputPath = resolve(values.output!);
await mkdir(dirname(outputPath), { recursive: true });

// --- 5. 调 API ---
const body = {
  prompt,
  size: apiSize,
  quality: values.quality,
  output_format: "png",
  n: 1,
};

let res: Response;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
} catch (err) {
  die(`网络错误：${(err as Error).message}`);
}

if (!res.ok) {
  const text = await res.text().catch(() => "<no body>");
  die(`API 返回 ${res.status} ${res.statusText}\n${text}`);
}

let json: { data?: Array<{ b64_json?: string }> };
try {
  json = (await res.json()) as typeof json;
} catch (err) {
  die(`API 响应不是合法 JSON：${(err as Error).message}`);
}

const b64 = json.data?.[0]?.b64_json;
if (!b64) {
  die(
    `API 响应缺少 data[0].b64_json 字段，原始响应：${JSON.stringify(json).slice(0, 500)}`
  );
}

// --- 6. 解码并压缩落盘 ---
const buffer = Buffer.from(b64, "base64");
let result: CompressResult;
try {
  result = await compressPngInPlace(buffer, outputPath);
} catch (err) {
  die(`写入文件失败 (${outputPath})：${(err as Error).message}`);
}

if (result.mode === "fallback") {
  console.error(
    `[generate-image] WARN: 压缩失败 (${result.fallbackReason ?? "unknown"})，已落盘原始 PNG`,
  );
}

const finalKB = (result.finalBytes / 1024).toFixed(1);
const origKB = (result.origBytes / 1024).toFixed(1);
const ratioPct = Math.round((result.finalBytes / result.origBytes) * 100);

let suffix: string;
if (result.mode === "compressed") {
  suffix = `compressed from ${origKB} KB / ${ratioPct}%`;
} else if (result.mode === "skipped") {
  suffix = `uncompressed, SKIP_PNG_COMPRESS=1`;
} else {
  suffix = `uncompressed`;
}

console.log(
  `OK ${outputPath} (${finalKB} KB, ${apiSize}, quality=${values.quality}, ${suffix})`,
);
