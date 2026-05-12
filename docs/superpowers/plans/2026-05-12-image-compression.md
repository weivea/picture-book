# Image-Generation 高保真 PNG 压缩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `image-generation` skill 把 Azure 返回的 ~2MB PNG 在落盘前经过 `pngquant + oxipng` 二级压缩，单图目标 400-700KB；压缩失败时静默回退到原图（exit 0），调用方接口完全不变。

**Architecture:** 在 `generate-image.ts` 第 6 步（解码并落盘）之前抽出新文件 `compress-png.ts`，导出一个纯函数 `compressPngInPlace(rawBuffer, outputPath)`。`generate-image.ts` 调用它替代 `writeFile(outputPath, buffer)`。两个 npm 包 `pngquant-bin` / `oxipng-bin` 通过默认导出提供二进制路径，用 `node:child_process.execFile` 调用，30s 超时。

**Tech Stack:** Bun + TypeScript（已有），`pngquant-bin@^9.0.0` / `oxipng-bin`（新增），`bun:test`（已有，参考 `audio-picture-book-creator` 测试模式）。

**Spec：** `docs/superpowers/specs/2026-05-12-image-compression-design.md`

---

## 文件结构总览

### 新增文件

```
.claude/skills/image-generation/
├── scripts/
│   ├── compress-png.ts                       # 新增。纯函数 compressPngInPlace
│   └── test/
│       └── compress-png.test.ts              # 新增。单元 + fallback + skip
└── tests/
    └── fixtures/
        └── sample.png                        # 新增。真实 1024×1024 ~1.7MB PNG
```

### 修改文件

```
package.json                                  # 加 dependencies: pngquant-bin, oxipng-bin
.claude/skills/image-generation/
├── SKILL.md                                  # 文档：压缩说明 + SKIP env + WARN 行
└── scripts/generate-image.ts                 # 第 6 步改为调用 compress-png + 调整 OK 行格式
```

### 文件职责

| 文件 | 职责 | 不负责 |
|---|---|---|
| `compress-png.ts` | 把一个 PNG buffer 经 pngquant + oxipng 写到目标路径，返回 { mode, finalBytes, origBytes }；处理临时文件、子进程超时、所有 fallback 决策 | 不读 stdin、不调 `parseArgs`、不 `process.exit` |
| `generate-image.ts` | API 调用、参数解析、stdout 成功行、退出码；**只是 import compress-png 并调用一次** | 不直接 spawn pngquant/oxipng |
| `compress-png.test.ts` | 用真实 PNG fixture 验证 compressed / skipped / fallback 三种 mode | 不调 Azure API |

---

## Task 1: 引入两个 npm 二进制依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装两个包**

```bash
cd /Users/jianliwei/personal-repos/picture-book
bun add pngquant-bin@^9.0.0 oxipng-bin
```

Expected: `bun.lock` 更新，`node_modules/pngquant-bin` 和 `node_modules/oxipng-bin` 出现，各自带一个 `vendor/` 子目录里的预编译二进制。

- [ ] **Step 2: 验证两个二进制能跑**

```bash
node -e 'import("pngquant-bin").then(m => console.log(m.default))' \
  | xargs -I {} {} --version
node -e 'import("oxipng-bin").then(m => console.log(m.default))' \
  | xargs -I {} {} --version
```

Expected: 分别打印形如 `2.x.x` 和 `9.x.x` 的版本号。如果报 "Permission denied" 或 "command not found"，说明该平台没有预编译二进制，本任务在该平台失败 —— 在 commit message 中记录并停止。

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lock
git commit -m "deps(image-generation): add pngquant-bin and oxipng-bin for PNG compression"
```

---

## Task 2: 准备测试 fixture

**Files:**
- Create: `.claude/skills/image-generation/tests/fixtures/sample.png`

- [ ] **Step 1: 创建 fixture 目录并复制一张真实 PNG**

```bash
mkdir -p /Users/jianliwei/personal-repos/picture-book/.claude/skills/image-generation/tests/fixtures
cp /Users/jianliwei/personal-repos/picture-book/output/zhouwu-yuehao/0.png \
   /Users/jianliwei/personal-repos/picture-book/.claude/skills/image-generation/tests/fixtures/sample.png
```

Expected: 文件存在，约 1.7MB。

- [ ] **Step 2: 验证它确实是 1024×1024 PNG**

```bash
file /Users/jianliwei/personal-repos/picture-book/.claude/skills/image-generation/tests/fixtures/sample.png
```

Expected: 输出包含 `PNG image data, 1024 x 1024`。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/image-generation/tests/fixtures/sample.png
git commit -m "test(image-generation): add 1024² PNG fixture for compression tests"
```

---

## Task 3: 写 happy-path 测试（先红）

**Files:**
- Create: `.claude/skills/image-generation/scripts/test/compress-png.test.ts`

- [ ] **Step 1: 写测试文件骨架 + happy path 一个用例**

```ts
// .claude/skills/image-generation/scripts/test/compress-png.test.ts
import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { readFile, mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { compressPngInPlace } from "../compress-png";

const FIXTURE = new URL(
  "../../tests/fixtures/sample.png",
  import.meta.url,
).pathname;

let tmp: string;
let raw: Buffer;

beforeAll(async () => {
  raw = await readFile(FIXTURE);
});

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function freshTmp(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "compress-png-"));
  return tmp;
}

describe("compressPngInPlace - happy path", () => {
  test("把 ~1.7MB PNG 压缩到原始 50% 以下且仍是 PNG", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");

    const result = await compressPngInPlace(raw, out);

    expect(result.mode).toBe("compressed");
    expect(result.origBytes).toBe(raw.length);
    expect(result.finalBytes).toBeLessThan(raw.length * 0.5);

    const written = await readFile(out);
    // PNG magic number
    expect(written.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR width/height (bytes 16..23, big-endian uint32)
    expect(written.readUInt32BE(16)).toBe(1024);
    expect(written.readUInt32BE(20)).toBe(1024);

    const s = await stat(out);
    expect(s.size).toBe(result.finalBytes);
  });
});
```

- [ ] **Step 2: 运行测试，确认它因为 compress-png 不存在而失败**

```bash
bun test .claude/skills/image-generation/scripts/test/compress-png.test.ts
```

Expected: FAIL，错误信息形如 `Cannot find module '../compress-png'`。

---

## Task 4: 实现 compress-png 让 happy-path 通过

**Files:**
- Create: `.claude/skills/image-generation/scripts/compress-png.ts`

- [ ] **Step 1: 写最小可工作的 compress-png.ts**

```ts
// .claude/skills/image-generation/scripts/compress-png.ts
/**
 * 把一段 PNG buffer 经 pngquant + oxipng 二级压缩后写到 outputPath。
 *
 * - 任一环节失败 → fallback：把原始 buffer 写到 outputPath，返回 mode=fallback。
 * - 环境变量 SKIP_PNG_COMPRESS=1 → 直接写原图，返回 mode=skipped。
 * - 子进程超时上限 30s。
 *
 * 调用方（generate-image.ts）只关心：函数总会让 outputPath 上有一个能用的 PNG。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rename, unlink, stat } from "fs/promises";
import { dirname, basename, join } from "path";

import pngquantPath from "pngquant-bin";
import oxipngPath from "oxipng-bin";

const execFileP = promisify(execFile);

const TIMEOUT_MS = 30_000;
const PNGQUANT_SKIP_IF_LARGER_EXIT = 98;

export type CompressMode = "compressed" | "fallback" | "skipped";

export interface CompressResult {
  mode: CompressMode;
  finalBytes: number;
  origBytes: number;
  fallbackReason?: string;
}

export async function compressPngInPlace(
  rawBuffer: Buffer,
  outputPath: string,
): Promise<CompressResult> {
  const origBytes = rawBuffer.length;

  if (process.env.SKIP_PNG_COMPRESS === "1") {
    await writeFile(outputPath, rawBuffer);
    return { mode: "skipped", finalBytes: origBytes, origBytes };
  }

  const dir = dirname(outputPath);
  const base = basename(outputPath);
  const rawTmp = join(dir, `${base}.raw.png`);
  const qTmp = join(dir, `${base}.q.png`);

  // 写 raw 到磁盘（pngquant 需要文件输入）
  await writeFile(rawTmp, rawBuffer);

  try {
    // ---- pngquant ----
    let pngquantOk = true;
    try {
      await execFileP(
        pngquantPath as unknown as string,
        [
          rawTmp,
          "--quality=80-95",
          "--speed=1",
          "--strip",
          "--skip-if-larger",
          "--output",
          qTmp,
          "--force",
        ],
        { timeout: TIMEOUT_MS },
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException & { code?: number | string })
        .code;
      if (code === PNGQUANT_SKIP_IF_LARGER_EXIT) {
        // pngquant 觉得量化反而变大，把 raw 当作 oxipng 的输入。
        await rename(rawTmp, qTmp);
      } else {
        pngquantOk = false;
        await fallback(
          rawBuffer,
          outputPath,
          rawTmp,
          qTmp,
          `pngquant failed: ${formatErr(err)}`,
        );
        return {
          mode: "fallback",
          origBytes,
          finalBytes: origBytes,
          fallbackReason: `pngquant failed: ${formatErr(err)}`,
        };
      }
    }

    if (pngquantOk) {
      // ---- oxipng ----
      try {
        await execFileP(
          oxipngPath as unknown as string,
          [
            "-o",
            "4",
            "--strip",
            "safe",
            "--quiet",
            qTmp,
            "--out",
            outputPath,
            "--force",
          ],
          { timeout: TIMEOUT_MS },
        );
      } catch (err) {
        await fallback(
          rawBuffer,
          outputPath,
          rawTmp,
          qTmp,
          `oxipng failed: ${formatErr(err)}`,
        );
        return {
          mode: "fallback",
          origBytes,
          finalBytes: origBytes,
          fallbackReason: `oxipng failed: ${formatErr(err)}`,
        };
      }
    }

    // 清理临时文件
    await Promise.all([
      unlink(rawTmp).catch(() => {}),
      unlink(qTmp).catch(() => {}),
    ]);

    const finalStat = await stat(outputPath);
    return {
      mode: "compressed",
      origBytes,
      finalBytes: finalStat.size,
    };
  } catch (err) {
    await fallback(
      rawBuffer,
      outputPath,
      rawTmp,
      qTmp,
      `unexpected: ${formatErr(err)}`,
    );
    return {
      mode: "fallback",
      origBytes,
      finalBytes: origBytes,
      fallbackReason: `unexpected: ${formatErr(err)}`,
    };
  }
}

async function fallback(
  rawBuffer: Buffer,
  outputPath: string,
  rawTmp: string,
  qTmp: string,
  reason: string,
): Promise<void> {
  // 落盘原图，覆盖任何已存在的 outputPath（可能 oxipng 写到一半失败）
  await writeFile(outputPath, rawBuffer);
  await Promise.all([
    unlink(rawTmp).catch(() => {}),
    unlink(qTmp).catch(() => {}),
  ]);
  // reason 通过返回值传给上层；这里不直接 stderr，让 generate-image 统一打 WARN
  void reason;
}

function formatErr(err: unknown): string {
  if (!err) return "unknown";
  if (err instanceof Error) return err.message.split("\n")[0];
  return String(err);
}
```

- [ ] **Step 2: 跑测试，确认 happy path 通过**

```bash
bun test .claude/skills/image-generation/scripts/test/compress-png.test.ts
```

Expected: PASS（1 passed）。压缩耗时 1-3 秒。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/image-generation/scripts/compress-png.ts \
        .claude/skills/image-generation/scripts/test/compress-png.test.ts
git commit -m "feat(image-generation): add compress-png helper (pngquant + oxipng)"
```

---

## Task 5: 加 SKIP_PNG_COMPRESS 测试用例

**Files:**
- Modify: `.claude/skills/image-generation/scripts/test/compress-png.test.ts`

- [ ] **Step 1: 在 happy-path describe 之后追加 skipped describe**

把这段加到测试文件末尾：

```ts
describe("compressPngInPlace - SKIP_PNG_COMPRESS", () => {
  test("env=1 时直接落盘原图，mode=skipped", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const prev = process.env.SKIP_PNG_COMPRESS;
    process.env.SKIP_PNG_COMPRESS = "1";
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("skipped");
      expect(result.finalBytes).toBe(raw.length);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SKIP_PNG_COMPRESS;
      else process.env.SKIP_PNG_COMPRESS = prev;
    }
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
bun test .claude/skills/image-generation/scripts/test/compress-png.test.ts
```

Expected: PASS（2 passed）。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/image-generation/scripts/test/compress-png.test.ts
git commit -m "test(image-generation): cover SKIP_PNG_COMPRESS bypass"
```

---

## Task 6: 加 fallback 测试（pngquant 二进制不存在）

**Files:**
- Modify: `.claude/skills/image-generation/scripts/compress-png.ts`
- Modify: `.claude/skills/image-generation/scripts/test/compress-png.test.ts`

为了让测试能"假装二进制不存在"，需要先把两个二进制路径从 `import` 提升为可在测试中替换的全局变量。

- [ ] **Step 1: 在 compress-png.ts 顶部加一个测试 hook**

把文件顶部的 import 段下面加：

```ts
// 测试 hook：允许测试覆盖 pngquant / oxipng 二进制路径。生产代码无人调用。
let pngquantBin: string = pngquantPath as unknown as string;
let oxipngBin: string = oxipngPath as unknown as string;

export function __setBinariesForTest(opts: {
  pngquant?: string;
  oxipng?: string;
}): () => void {
  const prevP = pngquantBin;
  const prevO = oxipngBin;
  if (opts.pngquant !== undefined) pngquantBin = opts.pngquant;
  if (opts.oxipng !== undefined) oxipngBin = opts.oxipng;
  return () => {
    pngquantBin = prevP;
    oxipngBin = prevO;
  };
}
```

并把函数体内的 `pngquantPath as unknown as string` 改为 `pngquantBin`，把 `oxipngPath as unknown as string` 改为 `oxipngBin`。

- [ ] **Step 2: 加 fallback 测试用例**

把这段加到测试文件末尾：

```ts
import { __setBinariesForTest } from "../compress-png";

describe("compressPngInPlace - fallback", () => {
  test("pngquant 二进制不存在 → mode=fallback, 文件等于原图", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const restore = __setBinariesForTest({
      pngquant: "/nonexistent/pngquant-please-fail",
    });
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("fallback");
      expect(result.finalBytes).toBe(raw.length);
      expect(result.fallbackReason).toMatch(/pngquant failed/);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      restore();
    }
  });

  test("oxipng 二进制不存在 → mode=fallback, 文件等于原图", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const restore = __setBinariesForTest({
      oxipng: "/nonexistent/oxipng-please-fail",
    });
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("fallback");
      expect(result.finalBytes).toBe(raw.length);
      expect(result.fallbackReason).toMatch(/oxipng failed/);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      restore();
    }
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
bun test .claude/skills/image-generation/scripts/test/compress-png.test.ts
```

Expected: PASS（4 passed）。第二个 fallback 测试耗时 1-3 秒（pngquant 跑成功了，oxipng 才失败）。

- [ ] **Step 4: 提交**

```bash
git add .claude/skills/image-generation/scripts/compress-png.ts \
        .claude/skills/image-generation/scripts/test/compress-png.test.ts
git commit -m "test(image-generation): cover fallback when pngquant/oxipng binaries missing"
```

---

## Task 7: 接入 generate-image.ts

**Files:**
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts`

- [ ] **Step 1: 顶部加 import**

在现有 import 段（第 26-29 行附近，`import { dirname, resolve, join } from "path";` 下面）追加：

```ts
import { compressPngInPlace } from "./compress-png";
```

- [ ] **Step 2: 替换第 6 步「解码并落盘」**

找到现有代码（约第 196-206 行）：

```ts
// --- 6. 解码并落盘 ---
const buffer = Buffer.from(b64, "base64");
try {
  await writeFile(outputPath, buffer);
} catch (err) {
  die(`写入文件失败 (${outputPath})：${(err as Error).message}`);
}

console.log(
  `OK ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB, ${apiSize}, quality=${values.quality})`
);
```

整段替换为：

```ts
// --- 6. 解码并压缩落盘 ---
const buffer = Buffer.from(b64, "base64");
let result;
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
```

- [ ] **Step 3: 移除现在没用的 import**

`writeFile` 不再被 generate-image.ts 直接使用（已封进 compress-png）。检查文件顶部 `import { writeFile, mkdir, readFile } from "fs/promises";` —— `mkdir` 和 `readFile` 还在用（mkdir 在第 152 行，readFile 在 dotenv 解析里），所以只去掉 `writeFile`：

```ts
import { mkdir, readFile } from "fs/promises";
```

- [ ] **Step 4: 跑一次集成（不调 API，用 SKIP 跳过压缩，确认 generate-image.ts 至少能 import）**

```bash
bun build .claude/skills/image-generation/scripts/generate-image.ts \
  --target=bun --outfile /tmp/generate-image-check.js
```

Expected: 编译成功，无 TypeScript 错误。如果报 "Cannot find name 'writeFile'" 或类似错误，说明还有别的地方在用，回去加回 import。

- [ ] **Step 5: 提交**

```bash
git add .claude/skills/image-generation/scripts/generate-image.ts
git commit -m "feat(image-generation): pipe API output through compress-png (PNG → PNG)"
```

---

## Task 8: 端到端冒烟（人工，需要 AZURE_API_KEY）

**Files:** none

如果 `AZURE_API_KEY` 不可用，**跳过本任务**（在 commit message 或 PR 描述中说明），直接进入 Task 9。

- [ ] **Step 1: 默认压缩跑一张图**

```bash
cd /Users/jianliwei/personal-repos/picture-book
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "A photograph of a red fox in an autumn forest" \
  --output /tmp/smoke-compressed.png
```

Expected stdout 末行包含 `compressed from <X> KB / <ratio>%`，文件 `/tmp/smoke-compressed.png` 存在且 < 800KB；`file /tmp/smoke-compressed.png` 显示 `PNG image data, 1024 x 1024`。

- [ ] **Step 2: 用 SKIP 跑一张做对照**

```bash
SKIP_PNG_COMPRESS=1 bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "A photograph of a red fox in an autumn forest" \
  --output /tmp/smoke-raw.png
```

Expected stdout 末行包含 `uncompressed, SKIP_PNG_COMPRESS=1`，文件 1.5-2.5 MB。

- [ ] **Step 3: 比较两张图的视觉质量**

```bash
ls -la /tmp/smoke-compressed.png /tmp/smoke-raw.png
open /tmp/smoke-compressed.png /tmp/smoke-raw.png   # macOS Preview 并排比较
```

Expected: 压缩版 << 原版，肉眼几乎看不出差别。如果有明显色带 / 噪点，记录在 PR 描述里，但不阻塞合并 —— 可后续调整 `--quality` 范围。

- [ ] **Step 4: 跑全套测试做最终回归**

```bash
bun test ./.claude/skills/
```

Expected: 全部 PASS（含本次新增的 4 个 + 原有所有测试）。

---

## Task 9: 文档更新

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md`

- [ ] **Step 1: 改顶部说明段（第 11-13 行）**

找到：

```markdown
# Image Generation

通过 Azure 部署的 `gpt-image-2` 模型，把一段 prompt 渲染成单张 1024×1024 PNG。
```

替换为：

```markdown
# Image Generation

通过 Azure 部署的 `gpt-image-2` 模型，把一段 prompt 渲染成单张 1024×1024 PNG，
落盘前会经过 `pngquant + oxipng` 高保真压缩，目标单图 ≤800 KB（典型 400-700 KB），
肉眼无差别。压缩失败时静默回退到原图（exit 0，stderr 一行 WARN）。
```

- [ ] **Step 2: 在 Prerequisites 段补一行**

在 Prerequisites 的"推荐做法"那段下面追加：

```markdown
> 此 skill 依赖两个 npm 包提供的预编译二进制（`pngquant-bin`、`oxipng-bin`）。
> 首次使用前在仓库根目录执行 `bun install` 即可。
```

- [ ] **Step 3: 在 Quick Reference 表格下补环境变量说明**

找到 Quick Reference 段最后的代码块，下面追加一段：

```markdown
**环境变量（除 `AZURE_API_KEY` / `AZURE_IMAGE_ENDPOINT` 外）：**

| 变量 | 含义 |
|---|---|
| `SKIP_PNG_COMPRESS=1` | 跳过 pngquant + oxipng 压缩，直接落盘原图。调试 / 对照用。 |
```

- [ ] **Step 4: 在 Behavior on Error 表格里加一行 WARN**

找到 `## Behavior on Error` 下面的表格，**在表格末尾追加一行**：

```markdown
| `WARN: 压缩失败` | pngquant/oxipng 子进程失败或超时 | 不是错误，exit 0；该图未压缩但可用，可忽略 |
```

- [ ] **Step 5: 提交**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "docs(image-generation): document PNG compression and SKIP_PNG_COMPRESS"
```

---

## Self-Review

**1. Spec coverage** — 走一遍 spec 各节：

| Spec 节 | 实现位置 |
|---|---|
| Goals: 单图 → 400-700KB | Task 4 实现，Task 8.1 验证 |
| Goals: 不改公共契约 | Task 7 保留 `OK <path>` 前缀；Task 4 函数签名包住所有变化 |
| Goals: fallback | Task 4 + Task 6 测试 |
| Non-Goals: 不改下游 | 计划完全没碰 picture-book-creator / EPUB |
| Architecture: 两个文件改动 + 新建 compress-png.ts | Task 1 / 4 / 7 |
| Compression Pipeline: pngquant `--quality=80-95 --speed=1 --strip --skip-if-larger` | Task 4 Step 1 |
| Compression Pipeline: oxipng `-o 4 --strip safe --quiet` | Task 4 Step 1 |
| Compression Pipeline: pngquant exit 98 走 oxipng | Task 4 Step 1（PNGQUANT_SKIP_IF_LARGER_EXIT 分支） |
| Binary discovery: import 默认导出 | Task 4 Step 1 |
| Fallback Behavior: 5 种触发条件 | Task 4 Step 1 try/catch + 30s timeout |
| Bypass Switch: `SKIP_PNG_COMPRESS=1` | Task 4 Step 1（函数最前面），Task 5 测试 |
| stdout/stderr Contract: 三种成功格式 | Task 7 Step 2 |
| Testing Strategy: 4 个用例 | Task 3 / 5 / 6（共 4 个测试）|
| Documentation Updates | Task 9 |

全部覆盖。✓

**2. Placeholder scan** — 全文搜过，没有 TODO / TBD / "implement later" / "similar to Task N"。所有代码块都是完整可粘贴的。✓

**3. Type consistency** —
- `compressPngInPlace(rawBuffer: Buffer, outputPath: string): Promise<CompressResult>` 在 Task 3、4、5、6、7 中签名一致。
- `CompressResult.mode` 三个字面量值 `"compressed" | "fallback" | "skipped"` 在 Task 3、4、5、6、7 中拼写一致。
- `__setBinariesForTest({ pngquant?, oxipng? })` 在 Task 6 Step 1 定义，Task 6 Step 2 调用，匹配。
- `result.fallbackReason` 在 Task 4 返回值中存在，Task 6 测试中读取，Task 7 stderr 中读取，三处一致。

✓

---

## 执行顺序与依赖

```
Task 1 (deps) ──┐
                ├─→ Task 4 (impl) ─→ Task 5 ─→ Task 6 ─→ Task 7 ─→ Task 8 ─→ Task 9
Task 2 (fixture)─┤                                                          
Task 3 (test) ──┘
```

Task 1 / 2 / 3 可以并行；其余串行。

