/**
 * 调用 Azure gpt-image-2 部署生成单张 PNG。
 *
 * 由 image-generation skill 包装；picture-book-creator 在阶段 6 逐页 fork
 * subagent 调用本脚本，每次只生成 1 张图。脚本本身通过 lib/concurrency-gate
 * 强制全局最多 2 个实例同时调 Azure API（IMAGE_GEN_MAX_CONCURRENCY 可调）；
 * 重试由调用方负责。
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
import { mkdir, readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { basename, dirname, resolve, join } from "path";
import { compressPngInPlace, type CompressResult } from "./compress-png";
import { acquireSlot, sleep } from "./lib/concurrency-gate";
import { detectRefMime, MAX_REF_BYTES } from "./lib/ref-image";
import { readInputFidelity } from "./lib/input-fidelity";

const DEFAULT_ENDPOINT =
  "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2025-04-01-preview";

// 退避重试参数（仅对 429/5xx 生效）
const MAX_RETRIES = 3;
const FALLBACK_BACKOFF_MS = [30_000, 60_000, 120_000];
const MAX_PROMPT_LEN = 4000;

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
    ref: { type: "string", multiple: true },
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

const refPaths: string[] = (values.ref ?? []).map((p) => resolve(p));
for (const p of refPaths) {
  if (!existsSync(p)) {
    die(`--ref 文件不存在：${p}`);
  }
}
const MAX_REFS = 6;
if (refPaths.length > MAX_REFS) {
  die(
    `--ref 当前最多支持 ${MAX_REFS} 张参考图（收到 ${refPaths.length} 张）`,
  );
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
if (prompt.length > MAX_PROMPT_LEN) {
  die(
    `Prompt 长度 ${prompt.length} 超过 ${MAX_PROMPT_LEN} 字符上限。请精简后再调用。`,
  );
}

// --- 4. 准备输出目录 ---
const outputPath = resolve(values.output!);
await mkdir(dirname(outputPath), { recursive: true });

// --- 5a. 解析 Retry-After 头（秒数或 HTTP-date）。失败 → null ---
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  // 整数秒
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null;
  }
  // HTTP-date
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const delta = ts - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

// --- 5b. 带退避重试的 fetch 包装。429/5xx → 退避后重试，最多 MAX_RETRIES 次 ---
async function fetchWithRetry(
  callOnce: () => Promise<Response>,
  label: string,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await callOnce();
    } catch (err) {
      // 网络错误：也按 5xx 退避一次（DNS 抖动 / 连接 reset 常见）
      if (attempt >= MAX_RETRIES) die(`网络错误：${(err as Error).message}`);
      const wait = FALLBACK_BACKOFF_MS[attempt] ?? FALLBACK_BACKOFF_MS.at(-1)!;
      console.error(
        `[generate-image] ${label} 网络错误（attempt ${attempt + 1}/${MAX_RETRIES + 1}），${Math.round(wait / 1000)}s 后重试：${(err as Error).message}`,
      );
      await sleep(wait);
      continue;
    }

    if (res.ok) return res;

    // 非 ok：判断是否可重试
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= MAX_RETRIES) {
      return res; // 交给 parseImageResponse 走 die
    }
    const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
    const wait = retryAfterMs ?? (FALLBACK_BACKOFF_MS[attempt] ?? FALLBACK_BACKOFF_MS.at(-1)!);
    console.error(
      `[generate-image] ${label} API 返回 ${res.status}（attempt ${attempt + 1}/${MAX_RETRIES + 1}），${Math.round(wait / 1000)}s 后重试`,
    );
    // 必须读掉 body，否则 keep-alive 连接卡住
    await res.text().catch(() => "");
    lastRes = res;
    await sleep(wait);
  }
  // 理论不可达：循环要么 return res，要么 die
  return lastRes!;
}

// --- 5c. 解析图像 API 响应（generate / edits 共用） ---
async function parseImageResponse(res: Response): Promise<Buffer> {
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    let hint = "";
    if (
      res.status >= 400 &&
      res.status < 500 &&
      text.includes("input_fidelity")
    ) {
      hint =
        "\n[generate-image] HINT: 当前部署可能不识别 input_fidelity。" +
        "在 .env 设置 IMAGE_GEN_INPUT_FIDELITY=off 重试。";
    }
    die(`API 返回 ${res.status} ${res.statusText}\n${text}${hint}`);
  }
  let json: { data?: Array<{ b64_json?: string }> };
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    die(`API 响应不是合法 JSON：${(err as Error).message}`);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    die(`API 响应缺少 data[0].b64_json：${JSON.stringify(json).slice(0, 500)}`);
  }
  return Buffer.from(b64, "base64");
}

// --- 5d. /generations 端点（无参考图） ---
async function callGenerateApi(): Promise<Buffer> {
  const body = {
    prompt,
    size: apiSize,
    quality: values.quality,
    output_format: "png",
    n: 1,
  };
  const res = await fetchWithRetry(
    () =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }),
    "generations",
  );
  return parseImageResponse(res);
}

// --- 5e. /edits 端点（有参考图） ---
function deriveEditsEndpoint(): string {
  const explicit = process.env.AZURE_IMAGE_EDITS_ENDPOINT;
  if (explicit) return explicit;
  if (endpoint.includes("/images/generations")) {
    return endpoint.replace("/images/generations", "/images/edits");
  }
  die(
    "无法推导 /edits 端点。请在 .env 中显式设置 AZURE_IMAGE_EDITS_ENDPOINT=" +
      "https://<你的资源名>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2024-02-01"
  );
}

async function callEditsApi(refPaths: string[]): Promise<Buffer> {
  const editsEndpoint = deriveEditsEndpoint();

  // input_fidelity：env 控制；非法值在此处 throw → die。
  // 先于 ref 读取做校验，避免读完几十 MB 才因为 env 配错而失败。
  let fidelity: ReturnType<typeof readInputFidelity>;
  try {
    fidelity = readInputFidelity();
  } catch (err) {
    die((err as Error).message);
  }

  // 预读 + 校验所有 ref（先全部读完再发送，便于在网络前 fail-fast）。
  const MAX_REF_MB = (MAX_REF_BYTES / (1024 * 1024)).toFixed(0);
  const refs: { name: string; buf: Buffer; mime: "image/png" | "image/jpeg" }[] = [];
  for (const p of refPaths) {
    const st = await stat(p);
    if (st.size > MAX_REF_BYTES) {
      die(
        `--ref ${p} 大小 ${(st.size / (1024 * 1024)).toFixed(1)} MB 超过 ${MAX_REF_MB} MB 单文件上限`,
      );
    }
    const buf = await readFile(p);
    const mime = detectRefMime(buf);
    if (!mime) {
      die(`--ref ${p} 不是合法 PNG/JPG（magic 字节失败）`);
    }
    refs.push({ name: basename(p) || "ref.png", buf, mime });
  }

  const res = await fetchWithRetry(
    () => {
      // form 必须每次重建，因为部分 server 会消费 stream
      const form = new FormData();
      for (const r of refs) {
        form.append("image", new Blob([r.buf], { type: r.mime }), r.name);
      }
      form.append("prompt", prompt);
      form.append("size", apiSize);
      form.append("quality", values.quality!);
      form.append("output_format", "png");
      form.append("n", "1");
      if (fidelity !== "off") {
        form.append("input_fidelity", fidelity);
      }
      return fetch(editsEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` }, // 不要设 Content-Type，让 fetch 自动加 boundary
        body: form,
      });
    },
    "edits",
  );
  return parseImageResponse(res);
}

// --- 5. 调 API（按是否有参考图路由）---
// 速率门 + 并发上限由 concurrency-gate 强制（默认 1 并发 + 35s 间隔，对应 Azure 2 RPM）。
// 等待时不会失败。429/5xx 在 fetchWithRetry 内部退避重试，期间持有 slot。
// release 必须在 finally 里执行。
const release = await acquireSlot();
let buffer: Buffer;
try {
  if (refPaths.length === 0) {
    buffer = await callGenerateApi();
  } else {
    buffer = await callEditsApi(refPaths);
  }
} finally {
  await release();
}

// --- 6. 解码并压缩落盘 ---
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
