/**
 * text-to-speech skill 主入口（与 image-generation 的 generate-image.ts 镜像对称）。
 *
 * 用法：
 *   bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
 *     --output <mp3 路径> \
 *     [--text "<text>"]   # 不传则从 stdin
 *     [--voice zh-CN-XiaoyiNeural] [--rate -10%] [--volume +0%] [--pitch +0Hz]
 *
 * 行为：
 *   - 启动 <repo>/.venv/bin/python azure_tts_helper.py 子进程
 *   - 文本经 stdin 喂入 helper
 *   - helper stdout (mp3 二进制) → 写到 <output>
 *   - helper stderr (NDJSON WordBoundary 事件) → 收集后转换为 words[]
 *   - 调用 splitSentences + aggregateToSentences + sanityCheck
 *   - 写 <output>.json（同名不同扩展名）
 *   - 任何步骤失败：stderr 单行错误 + exit 1
 */
import { parseArgs } from "util";
import { spawn } from "child_process";
import { writeFile } from "fs/promises";
import { resolve, dirname, join } from "path";
import { existsSync } from "fs";
import { findVenvPython } from "./lib/env";
import { splitSentences } from "./lib/sentence-split";
import {
  aggregateToSentences,
  sanityCheck,
  type Word,
} from "./lib/timestamp-aggregator";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: { type: "string" },
    text: { type: "string" },
    voice: { type: "string", default: "zh-CN-XiaoyiNeural" },
    rate: { type: "string", default: "-10%" },
    volume: { type: "string", default: "+0%" },
    pitch: { type: "string", default: "+0Hz" },
  },
});

if (!values.output) {
  console.error("缺少 --output 参数");
  process.exit(1);
}

const outputPath = resolve(values.output);

// 1. 探测 venv
const python = findVenvPython();
if (!python) {
  console.error(
    "azure-cognitiveservices-speech 未安装。请在项目根运行：\n" +
      "  python3 -m venv .venv\n" +
      "  .venv/bin/pip install -r requirements.txt"
  );
  process.exit(1);
}

// 2. 读 text（参数 or stdin）
let text: string;
if (values.text != null) {
  text = values.text;
} else {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  text = Buffer.concat(chunks).toString("utf-8");
}
if (text.trim() === "") {
  console.error("text 为空");
  process.exit(1);
}

// 3. 启动 Python 子进程
const helperPath = join(
  dirname(new URL(import.meta.url).pathname),
  "azure_tts_helper.py"
);
if (!existsSync(helperPath)) {
  console.error(`azure_tts_helper.py 缺失: ${helperPath}`);
  process.exit(1);
}

// 注意：值以 `-` 开头（如 `-10%`）时 argparse 会误判为 flag，因此统一用 `--key=value` 形式
const proc = spawn(
  python,
  [
    helperPath,
    `--voice=${values.voice!}`,
    `--rate=${values.rate!}`,
    `--volume=${values.volume!}`,
    `--pitch=${values.pitch!}`,
  ],
  { stdio: ["pipe", "pipe", "pipe"] }
);

// 4. 喂入 stdin
proc.stdin.write(text);
proc.stdin.end();

// 5. 收集 stdout (mp3) + stderr (events)
const audioChunks: Buffer[] = [];
proc.stdout.on("data", (c: Buffer) => audioChunks.push(c));

let stderrBuf = "";
proc.stderr.on("data", (c: Buffer) => {
  stderrBuf += c.toString("utf-8");
});

// 6. 等待退出
const exitCode: number = await new Promise((res) => proc.on("close", res));

// 7. 解析 events
const events: Array<Record<string, unknown>> = [];
for (const line of stderrBuf.split("\n")) {
  const t = line.trim();
  if (t === "") continue;
  try {
    events.push(JSON.parse(t));
  } catch {
    // 非 JSON 行忽略
  }
}

const errEvent = events.find((e) => e.type === "error");
if (errEvent) {
  console.error(errEvent.message);
  process.exit(1);
}

if (exitCode !== 0) {
  console.error(`helper 退出码非零: ${exitCode}`);
  process.exit(1);
}

const audioBuf = Buffer.concat(audioChunks);
if (audioBuf.length === 0) {
  console.error("合成失败：未收到音频");
  process.exit(1);
}

// 8. 写 mp3
try {
  await writeFile(outputPath, audioBuf);
} catch (e) {
  console.error(`写盘失败: ${(e as Error).message}`);
  process.exit(1);
}

// 9. 转换 events → words
const words: Word[] = events
  .filter((e) => typeof e.offset_us === "number")
  .map((e) => ({
    text: e.text as string,
    start_ms: Math.round((e.offset_us as number) / 1000),
    end_ms: Math.round(
      ((e.offset_us as number) + (e.duration_us as number)) / 1000
    ),
  }));

// 10. 估算 mp3 实际 duration（用 last word 的 end_ms 作为近似；准确值可后续用 ffprobe）
// NOTE: 因为 durationMs 与 words[last].end_ms 同源，sanityCheck 当前不会触发裁剪
// （ratio 恒为 1.0）。等接入 ffprobe 拿到真实 mp3 duration 后才有意义。
const lastWordEnd = words.length > 0 ? words[words.length - 1]!.end_ms : 0;
const durationMs = lastWordEnd > 0 ? lastWordEnd : 0;

// 11. 拆句 + 聚合 + 健全性
const sentences = splitSentences(text);
const aggregated = aggregateToSentences(text, sentences, words);
const checked = sanityCheck(aggregated, durationMs);

// 12. 写 json
const jsonPath = outputPath.replace(/\.mp3$/i, "") + ".json";
const json = {
  voice: values.voice,
  rate: values.rate,
  volume: values.volume,
  pitch: values.pitch,
  duration_ms: durationMs,
  text,
  sentences: checked.sentences,
  words,
  timestamps_adjusted: checked.adjusted,
};
try {
  await writeFile(jsonPath, JSON.stringify(json, null, 2), "utf-8");
} catch (e) {
  console.error(`写盘失败: ${(e as Error).message}`);
  process.exit(1);
}

console.log(`mp3: ${outputPath} (${audioBuf.length} bytes)`);
console.log(`json: ${jsonPath} (${sentences.length} sentences, ${words.length} words)`);
