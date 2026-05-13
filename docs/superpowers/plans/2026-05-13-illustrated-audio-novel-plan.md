# Illustrated Audio Novel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一套"有声图文小说"生成系统，由 5 个新 skill + 2 个扩展构成，单一入口产出 Reflowable EPUB3（句级高亮）+ 多 voice 音频 + 网漫范式插图。

**Architecture:** 沿用现有 `.claude/skills/` 目录约定（每 skill = `SKILL.md` + `scripts/` + `references/` + `tests/`）。借鉴 NousResearch/autonovel 的 5 层共演化文档 + 双免疫系统 + Opus review 循环；角色一致性靠 image-to-image 立绘锚定（Tier 1+2）；音文同步复用 `audio-picture-book-creator` 已验证的 SMIL/OPF 构建器。

**Tech Stack:** Bun + TypeScript（脚本）、Python 3 + edge-tts（venv，已存在）、Azure gpt-image-2（已封装）、jszip（EPUB 打包，已用）、Bun test runner（测试）。

**Source spec:** `docs/superpowers/specs/2026-05-13-illustrated-audio-novel-design.md`

**Reference repo (read-only):** `reference/autonovel/`（已 .gitignore）

---

## Scope & Strategy

Spec 包含 5 个新 skill + 2 个扩展。它们之间有**单向依赖**：

```
Phase 0  image-generation 扩展 --ref（解锁 scene-illustrator）
Phase 1  共享 references 文档（anti-slop-zh / anti-patterns / craft-zh / edge-tts-voice-catalog / style-presets-novel）
Phase 2  novel-foundation-builder（独立）
Phase 3  novel-chapter-workshop（依赖 Phase 1 的 anti-slop-zh / anti-patterns）
Phase 4  scene-illustrator（依赖 Phase 0 的 --ref + Phase 1 的 style-presets-novel）
Phase 5  audio-novel-packager（依赖 Phase 1 的 edge-tts-voice-catalog；复用 audio-picture-book-creator/scripts/lib/）
Phase 6  illustrated-audio-novel-creator 主编排器（依赖前 5 个）
Phase 7  集成测试 + README + 验收
```

**实现策略**：每 Phase 自包含 + 独立可验证。单 Phase 内部走 TDD（写测试 → 失败 → 实现 → 通过 → commit）。Phase 0/1 必须最先做，否则后续 skill 没法跑。

**测试基础设施**：复用现有 `bun test ./.claude/skills/`（见 `package.json:14`）。测试文件按 `<skill>/scripts/test/*.test.ts` 或 `<skill>/tests/*.test.ts` 放置（两种 pattern 仓库都有，新 skill 统一用 `scripts/test/`）。

---

## File Structure

### 新增文件

```
.claude/skills/
├── illustrated-audio-novel-creator/        ← Phase 6（主编排器）
│   ├── SKILL.md
│   └── references/
│       ├── stage-flow.md                   ← 详细阶段流转说明书
│       └── tier-presets.md                 ← short/medium/long 参数表
├── novel-foundation-builder/               ← Phase 2
│   ├── SKILL.md
│   ├── references/
│   │   ├── anti-slop-zh.md                 ← Phase 1.1（共享）
│   │   ├── anti-patterns.md                ← Phase 1.2（共享）
│   │   ├── craft-zh.md                     ← Phase 1.3（共享）
│   │   ├── edge-tts-voice-catalog.md       ← Phase 1.4（共享）
│   │   ├── style-presets-novel.md          ← Phase 1.5（共享）
│   │   └── output-schema.md                ← 五层文档 / voices.json 字段定义
│   └── scripts/
│       ├── lib/
│       │   ├── voice-assigner.ts           ← 角色 → edge-tts voice 自动分配
│       │   └── schemas.ts                  ← 五层文档 + voices.json 的 TypeScript 类型
│       └── test/
│           └── voice-assigner.test.ts
├── novel-chapter-workshop/                 ← Phase 3
│   ├── SKILL.md
│   ├── references/
│   │   ├── draft-prompt-template.md        ← 上下文窗口拼装模板
│   │   ├── eval-rubric.md                  ← LLM 评委评分标准
│   │   └── scene-marker-spec.md            ← <!-- scene s01 start --> 格式约定
│   └── scripts/
│       ├── lib/
│       │   ├── slop-scanner.ts             ← 机械扫 anti-slop-zh 词表
│       │   ├── pattern-scanner.ts          ← 机械扫 anti-patterns
│       │   └── scene-marker-parser.ts      ← 解析章节里的 scene 标记
│       └── test/
│           ├── slop-scanner.test.ts
│           ├── pattern-scanner.test.ts
│           ├── scene-marker-parser.test.ts
│           └── fixtures/
│               ├── slop-positive.md
│               ├── slop-negative.md
│               └── chapter-with-scenes.md
├── scene-illustrator/                      ← Phase 4
│   ├── SKILL.md
│   ├── references/
│   │   ├── trigger-points.md               ← 6 类插图触发点清单
│   │   └── prompt-structure.md             ← 风格 prefix + 锚定短语 + 场景 + 负面 拼装
│   └── scripts/
│       ├── lib/
│       │   ├── trigger-scanner.ts          ← 按 ~1000 字 + 触发点选插图位置
│       │   └── consistency-recheck.ts      ← LLM 比对同角色多张 scene 图
│       └── test/
│           ├── trigger-scanner.test.ts
│           └── fixtures/
│               └── chapter-fixture.md
└── audio-novel-packager/                   ← Phase 5
    ├── SKILL.md
    ├── references/
    │   └── reflowable-epub3-spec.md        ← Reflowable EPUB3 + Media Overlays + 内嵌图片 CSS
    └── scripts/
        ├── generate-novel-epub.ts          ← 主入口，类似 generate-audio-epub.ts
        ├── lib/
        │   ├── speaker-attribution.ts      ← 调 LLM 解析对话 → [{speaker,text}] JSON 格式契约
        │   ├── chapter-xhtml-builder.ts    ← 与绘本不同：每章 1 XHTML，含场景图
        │   ├── chapter-smil-builder.ts     ← 复用 audio-picture-book-creator 句级 SMIL 思路，按章拼接
        │   ├── novel-opf-builder.ts        ← Reflowable EPUB3 OPF（区别于绘本的 Fixed-Layout）
        │   └── audio-concat.ts             ← 多段 mp3 + 时间戳偏移累加
        └── test/
            ├── speaker-attribution.test.ts
            ├── chapter-xhtml-builder.test.ts
            ├── chapter-smil-builder.test.ts
            ├── novel-opf-builder.test.ts
            ├── audio-concat.test.ts
            └── fixtures/
                └── mini-novel/             ← 1 章 + 2 场景图 + 短音频
```

### 修改文件

```
.claude/skills/image-generation/
├── SKILL.md                                ← Phase 0：新增 --ref 文档
└── scripts/
    ├── generate-image.ts                   ← Phase 0：新增 --ref 解析 + /edits 端点支持
    └── test/
        └── ref-mode.test.ts                ← Phase 0：新增（多用 stub fetch）

package.json                                ← Phase 7：新增 npm scripts: novel / novel-epub
.env.example                                ← Phase 7：补 AZURE_IMAGE_EDITS_ENDPOINT
README.md                                   ← Phase 7：新增"有声图文小说"章节
```

---

## Phase 0：扩展 `image-generation` 支持 `--ref`

**目标：** 让 `generate-image.ts` 支持 `--ref <path>`（可多次），底层走 Azure gpt-image-2 的 `/edits` multipart 端点而非 `/generations` JSON 端点。这是 scene-illustrator 角色一致性的硬依赖。

**前置阅读：**
- `azure-image-2-api.md`（项目根，见第 36-41 行的 `/edits` curl 示例）
- `.claude/skills/image-generation/scripts/generate-image.ts`（理解现有结构与 `.env` 加载逻辑）

**关键设计：**
- 不传 `--ref` → 走原 `/generations` 端点（向后兼容）
- 传至少 1 个 `--ref` → 走 `/edits` 端点，构造 multipart/form-data，把 png 文件作为 `image` 字段，prompt 作为 `prompt` 字段
- Azure 当前 `/edits` 文档示例只演示单图；本扩展先实现"主参考图（取第 1 张）+ prompt 描述配角"的回退行为，多 ref 暂存为后续优化项（spec § 5.1 说过这个降级）
- 端点读取顺序：`AZURE_IMAGE_EDITS_ENDPOINT` env > 自动从 `AZURE_IMAGE_ENDPOINT` 替换 `/generations` → `/edits`

### Task 0.1：新增 `--ref` 参数解析与基本校验

**Files:**
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts`（在 `parseArgs` 块新增 `ref` 选项 + 校验）

- [ ] **Step 1: 改 `parseArgs` 支持 `--ref` 多值**

修改 `.claude/skills/image-generation/scripts/generate-image.ts:74-84` 的 `parseArgs` 块为：

```typescript
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
```

- [ ] **Step 2: 在参数校验段（约 132 行后）补 `--ref` 文件存在校验**

在 `if (!allowedQuality.has(values.quality!)) { ... }` 之后，添加：

```typescript
const refPaths: string[] = (values.ref ?? []).map((p) => resolve(p));
for (const p of refPaths) {
  if (!existsSync(p)) {
    die(`--ref 文件不存在：${p}`);
  }
}
if (refPaths.length > 3) {
  die(`--ref 最多支持 3 张参考图（收到 ${refPaths.length} 张）。多余的图请合成一张拼图后再传。`);
}
```

- [ ] **Step 3: 跑现有测试，确保参数解析未破坏向后兼容**

Run: `bun test .claude/skills/image-generation/`
Expected: PASS（现有 compress-png.test.ts 不受影响）

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/image-generation/scripts/generate-image.ts
git commit -m "feat(image-generation): accept --ref <path> arg with existence + count validation"
```

### Task 0.2：抽取生成请求逻辑为可路由函数

**Files:**
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts`（把 fetch 块封装为 `callGenerateApi` / `callEditsApi` 两个分支）

- [ ] **Step 1: 在 `// --- 5. 调 API ---` 段之前定义两个 helper**

在第 154 行（`// --- 5. 调 API ---`）**之前**插入：

```typescript
// --- 5a. /generations 端点（无参考图） ---
async function callGenerateApi(): Promise<Buffer> {
  const body = {
    prompt,
    size: apiSize,
    quality: values.quality,
    output_format: "png",
    n: 1,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    die(`API 返回 ${res.status} ${res.statusText}\n${text}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    die(`API 响应缺少 data[0].b64_json：${JSON.stringify(json).slice(0, 500)}`);
  }
  return Buffer.from(b64, "base64");
}

// --- 5b. /edits 端点（有参考图） ---
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

async function callEditsApi(refPath: string): Promise<Buffer> {
  const editsEndpoint = deriveEditsEndpoint();
  const refBuf = await readFile(refPath);
  const refBlob = new Blob([refBuf], { type: "image/png" });
  const form = new FormData();
  form.append("image", refBlob, "ref.png");
  form.append("prompt", prompt);
  form.append("size", apiSize);
  form.append("quality", values.quality!);
  form.append("output_format", "png");
  form.append("n", "1");

  const res = await fetch(editsEndpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` }, // 注意：不要设 Content-Type，让 fetch 自动加 boundary
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    die(`API 返回 ${res.status} ${res.statusText}\n${text}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    die(`API 响应缺少 data[0].b64_json：${JSON.stringify(json).slice(0, 500)}`);
  }
  return Buffer.from(b64, "base64");
}
```

- [ ] **Step 2: 替换原 fetch 块为路由调用**

把 `.claude/skills/image-generation/scripts/generate-image.ts` 第 155-198 行（从 `// --- 5. 调 API ---` 到 `const buffer = Buffer.from(b64, "base64");`）整段替换为：

```typescript
// --- 5. 调 API（按是否有参考图路由）---
let buffer: Buffer;
if (refPaths.length === 0) {
  buffer = await callGenerateApi();
} else {
  if (refPaths.length > 1) {
    console.error(
      `[generate-image] WARN: 收到 ${refPaths.length} 张 --ref，本版本只用第 1 张（${refPaths[0]}）走 /edits 端点；` +
        `其他参考角色请在 prompt 文本中描述。`
    );
  }
  buffer = await callEditsApi(refPaths[0]!);
}
```

- [ ] **Step 3: 跑测试，确保现有功能不破**

Run: `bun test .claude/skills/image-generation/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/image-generation/scripts/generate-image.ts
git commit -m "refactor(image-generation): split /generations and /edits into routed helpers"
```

### Task 0.3：新增 `--ref` 路径的 stub 测试

**Files:**
- Create: `.claude/skills/image-generation/scripts/test/ref-mode.test.ts`

**测试策略：** 不打真 API。用 `mock` 替换全局 `fetch`，验证 multipart body 包含 `image` 与 `prompt` 字段、URL 命中 `/edits`。

- [ ] **Step 1: 写 fixture**

Create `.claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png`（1×1 透明 PNG，base64 解码）：

```bash
mkdir -p .claude/skills/image-generation/scripts/test/fixtures
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' \
  | base64 -d > .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png
```

- [ ] **Step 2: 写测试**

Create `.claude/skills/image-generation/scripts/test/ref-mode.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { spawnSync } from "child_process";
import { resolve } from "path";

const SCRIPT = resolve(
  ".claude/skills/image-generation/scripts/generate-image.ts"
);
const REF = resolve(
  ".claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png"
);

describe("--ref routing", () => {
  it("rejects --ref pointing to non-existent file", () => {
    const out = "/tmp/test-out-noref.png";
    const res = spawnSync(
      "bun",
      ["run", SCRIPT, "--prompt", "x", "--output", out, "--ref", "/no/such/file.png"],
      { encoding: "utf-8", env: { ...process.env, AZURE_API_KEY: "fake" } }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--ref 文件不存在");
  });

  it("rejects more than 3 --ref values", () => {
    const out = "/tmp/test-out-3ref.png";
    const res = spawnSync(
      "bun",
      [
        "run", SCRIPT,
        "--prompt", "x",
        "--output", out,
        "--ref", REF, "--ref", REF, "--ref", REF, "--ref", REF,
      ],
      { encoding: "utf-8", env: { ...process.env, AZURE_API_KEY: "fake" } }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("最多支持 3 张参考图");
  });
});
```

- [ ] **Step 3: 跑新测试确认失败为正确原因**

Run: `bun test .claude/skills/image-generation/scripts/test/ref-mode.test.ts`
Expected: 两个测试都 PASS（它们测的是参数校验路径，不打 API）

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/image-generation/scripts/test/ref-mode.test.ts \
        .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png
git commit -m "test(image-generation): cover --ref arg validation"
```

### Task 0.4：更新 `image-generation` SKILL.md 文档

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md`

- [ ] **Step 1: 在 `## Quick Reference` 块的参数表底部追加 `--ref`**

把 `.claude/skills/image-generation/SKILL.md:51-58` 替换为：

```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --output <png 路径> \
  [--prompt "<text>"]   # 不传则从 stdin 读取
  [--ratio 1:1]         # 仅支持 1:1，传其他值会 exit 1
  [--size 1024x1024]    # MVP 内部固定 1024x1024，传其他值会 stderr 警告但继续
  [--quality high]      # low | medium | high，默认 high
  [--ref <path>]        # 可重复（最多 3 张）。传入则走 /edits 端点做 image-to-image；本版本只生效第 1 张
```

- [ ] **Step 2: 在 `## Prerequisites` 后新增"参考图模式"小节**

在 `.claude/skills/image-generation/SKILL.md` 的 `## Prerequisites` 块结束后（第 48 行附近）插入：

```markdown
## Reference-image Mode（image-to-image）

传入 `--ref <path>` 时切到 Azure gpt-image-2 的 `/edits` 端点，把参考图作为 multipart body 的 `image` 字段。
用于"角色立绘 + prompt 描述场景"实现跨场景视觉一致性（scene-illustrator 调用范式）。

| 变量 | 必需 | 说明 |
|---|---|---|
| `AZURE_IMAGE_EDITS_ENDPOINT` | ✗ | 完整 `/edits` 端点 URL；不设则从 `AZURE_IMAGE_ENDPOINT` 自动替换 `/generations` → `/edits` |

**当前限制：**
- 多 ref 只生效第 1 张（其他角色请在 prompt 文本中描述）
- 不支持 `--mask`（区域编辑场景目前不需要）
```

- [ ] **Step 3: 在 `## When NOT to Use` 块更新"图像编辑"那一行**

把 `.claude/skills/image-generation/SKILL.md:23-26` 中的：

```
- **图像编辑 / inpainting**：`/openai/.../images/edits` 接口本 skill 未实现
```

改为：

```
- **掩码 inpainting**：本 skill `/edits` 端点支持参考图（`--ref`），但不支持 `--mask` 区域编辑
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "docs(image-generation): document --ref reference-image mode"
```

### Task 0.5：手动 PoC 验证（可选，但强推荐）

**目的：** 在没有真 Azure key 的 CI 环境之外，开发者本地用真实 key 跑一次 PoC，验证 `/edits` 端点能返回有效图。

- [ ] **Step 1: 准备一张已有 PNG 当 ref**

Run: `cp output/zhouwu-yuehao/0.png /tmp/ref.png`（如果项目已有绘本输出；没有则手动准备）

- [ ] **Step 2: 跑真实调用**

Run:
```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "Same character standing in front of a snowy mountain at dusk, cinematic lighting" \
  --ref /tmp/ref.png \
  --output /tmp/poc-out.png
```
Expected: exit 0，`/tmp/poc-out.png` 大小 100KB+，肉眼比对与 ref 同一角色

- [ ] **Step 3: 不通过则在 SKILL.md 与 spec § 5.1 风险章节补 fallback 说明**

如果 `/edits` 端点报错（如 unsupported content type 或 model 不支持 edits），在 `.claude/skills/image-generation/SKILL.md` 的 `Reference-image Mode` 章节顶部加一个 `> ⚠️ 已知 Azure gpt-image-2 在某些区域不支持 /edits，需切换到 dall-e-3 部署或保留 prompt-only 模式`。

无需 commit（PoC 不入版本库）。

---

## Phase 1：共享 references 文档（5 份）

**目标：** 这 5 份文档是后续所有 skill 的"权威源"，必须先就位。它们物理上放在 `novel-foundation-builder/references/` 下，其他 skill 通过相对路径只读访问（spec § 4.2 共享访问规则）。

**约定：** 这 5 份文档**不写代码**，所以不走 TDD。每份文档单独一个 task，独立 commit，便于后续单点维护。

### Task 1.1：`anti-slop-zh.md`（中文 AI 套话词表）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/anti-slop-zh.md`

- [ ] **Step 1: 创建目录与文件**

Run: `mkdir -p .claude/skills/novel-foundation-builder/references`

- [ ] **Step 2: 写入完整词表**

Create `.claude/skills/novel-foundation-builder/references/anti-slop-zh.md`:

```markdown
# Anti-Slop 词表（中文）

> 本文件由 `novel-foundation-builder`（写入 voice.md 时引用）与 `novel-chapter-workshop/scripts/lib/slop-scanner.ts`（机械扫描）共同消费。
> 改动后两边都自动生效。

## Tier 1：见即删除（高 AI 概率短语）

每出现一次扣 1 分，drafting 阶段必须改写。

```
诸如
综上所述
不难看出
值得注意的是
让我们
在某种意义上
不容小觑
深入探讨
究其本质
归根结底
某种程度上
不可否认
显而易见
毋庸置疑
与此同时
然而值得一提的是
说到这里
这就是为什么
正所谓
有那么一瞬间
不知为何
莫名其妙地
```

## Tier 2：聚集警告（同段 ≥3 次触发重写）

单独使用没问题，但同段聚集即"AI 抒情套路"。

```
宛如
仿佛
似乎
彷彿
淡淡的
缓缓地
轻轻地
深深地
悄悄地
静静地
莫名
隐约
不自觉
不由得
忍不住
若有所思
意味深长
心中一动
心头一紧
心如刀绞
```

## Tier 3：结构性 AI 套路

在 LLM 评委 prompt 里作为 checklist；机械扫描可识别但难精确。

- "不是 X，而是 Y" 句式：每章 ≤ 1 次
- "X，是 Y，更是 Z" 三段递进式：禁用
- 段段三段式（主题句 → 举例 → 收束）：检测段首词与段长方差
- 对偶排比成癖：连续 3 段对仗即重写
- 破折号过度：每页 ≤ 2 次
- 场景结尾必"小哲理"（autonovel ANTI-PATTERN #11）：禁用
- 每章必"望天/望窗外/望远方"收尾：禁用
- 心理描写过度（"他想……他又想……他终于想明白……"）：用动作或对白替代

## 使用示例

```typescript
import { scanSlop } from "../../novel-chapter-workshop/scripts/lib/slop-scanner";
const report = scanSlop(chapterText);
// report = { tier1: [{phrase, count, lineNum}], tier2Clusters: [{paragraph, hits}], score: 8.3 }
```
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/anti-slop-zh.md
git commit -m "docs(novel): add anti-slop-zh reference (Tier 1/2/3 vocabulary)"
```

### Task 1.2：`anti-patterns.md`（结构性 AI 模式）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/anti-patterns.md`

- [ ] **Step 1: 写入文档**

Create `.claude/skills/novel-foundation-builder/references/anti-patterns.md`:

```markdown
# Anti-Patterns（结构性 AI 失败模式）

> 中文化自 `reference/autonovel/ANTI-PATTERNS.md` 12 条。drafter 写章节时遵守，evaluator 据此扣分。

## #1 OVER-EXPLAIN（最高优先级）

旁白把场景已经展示的内容再解释一遍。
**侦测：** 情绪 beat 后的下一段如果在"解释这个情绪"，整段删除。
**例子：**
> 她转身离开，没有再看他一眼。**(her departure was final)** 她不会再回来了。**他知道这一刻他失去了她。**
后两句必删。

## #2 三元列举成癖

AI 默认列三个：三个形容词、三个动作、三个意象。
**约束：** 每章最多 2 次"三元"；其他场合改成两元或四元。

## #3 否定式重复

"他没有回头。""他没有想过她。""他没有再说什么。"
**约束：** 每章 ≤ 1 次否定式陈述。

## #4 思考式罗列

"他想到 X。他想到 Y。他想到 Z。"
**改写：** 用动作或残句替代（"X 在脑中闪过。"）

## #5 比喻拐杖

"宛如……""像是……"每章出现 4-8 次。
**约束：** 每章 ≤ 2 次"宛如/像是"句式，且必须用具体感官（不是"宛如时间停止"这种空洞比喻）。

## #6 场景分隔符当节奏拐杖

用 `---` 分隔逃避场景过渡。
**约束：** 每章 ≤ 2 次场景分隔符，仅用于真正的时空跳跃。

## #7 段落长度均匀

AI 段落集中在 4-6 句。
**约束：** 每章必须包含至少 1 个 1-2 句的短段 + 1 个 6 句以上的长段。

## #8 情绪弧线可预测

beat 按时间表到达。
**约束：** 每章必须有 1 个出乎意料的瞬间（提前到达 / 推迟到达 / 完全反向）。

## #9 章节结尾雷同

每章用同一种结尾手法（独白 / 凝视远方 / 一句哲理）。
**约束：** 任意两章不得用同一结尾结构。

## #10 对仗式对白

"我不是说 X，我是说 Y。" → 让所有角色听起来一样。
**约束：** 每章 ≤ 1 次该句式，且只能用于刻意展现该角色"喜欢辩证"的性格。

## #11 对白像书面语

完整的句子、没有口吃、没有打断。
**约束：** 每章至少 3 处对白包含：未说完的话、被打断、用错词、口语助词（"啊""嘛""那个"）。

## #12 场景—概述失衡

AI 默认概述（"接下来的几天，他们……"）。
**约束：** 每章 ≥ 70% 篇幅在场景中（具体动作 + 对白 + 感官细节）。
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/anti-patterns.md
git commit -m "docs(novel): add anti-patterns reference (12 structural failure modes)"
```

### Task 1.3：`craft-zh.md`（写作 craft 精简版）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/craft-zh.md`

- [ ] **Step 1: 写入文档**

Create `.claude/skills/novel-foundation-builder/references/craft-zh.md`:

```markdown
# Craft（写作框架精简中文版）

> 精简自 `reference/autonovel/CRAFT.md`。foundation-builder 在生成 voice.md / outline.md 时引用，drafter 在写章节时遵守。

## 1. 情节结构（三选一作为本书骨架）

### A. Save the Cat（电影编剧标准 15 节拍）

按字数百分比埋点，适合中长篇：
- 0%  开场镜头
- 1%  主题陈述（被反派或副线人物以反话说出）
- 5-10%  日常生活（呈现主角的"错误"世界观）
- 12%  催化事件（打破日常）
- 25%  跨入第二幕（主角主动选择）
- 50%  中点（虚假胜利或虚假失败 + 引入更高赌注）
- 75%  全失（最低点）
- 80%  灵魂的暗夜（独处反思）
- 85%  跨入第三幕（带着新认知行动）
- 100% 最终镜头（与开场镜头形成对照）

### B. Dan Harmon Story Circle（8 步圆环，适合短中篇）

You → Need → Go → Search → Find → Take → Return → Change

### C. Sanderson 的"承诺/进展/兑现"（适合系列小说一册）

每条情节线必须：开篇承诺 → 中段持续进展 → 结尾兑现承诺。

## 2. 角色框架

### 三滑块（必填）

每个 named character 至少 2 项高位，或 1 项高位 + 明显成长弧：
- 主动性（proactive）：自己推动剧情 vs 被剧情推动
- 讨喜度（likable）：读者愿意花时间陪伴
- 能力（competent）：在自己的领域是否有真本事

### 创伤—欲望—需要—谎言（Wound / Want / Need / Lie）

- 创伤：过去发生的、塑造了 Lie 的事件
- 谎言：因创伤而抱持的错误信念（如"我不配被爱"）
- 欲望：源于 Lie 的表面追求（如"占有最多财富"）
- 需要：真正能治愈 Lie 的东西（通常与欲望冲突）

主角弧 = 在 Want 与 Need 之间挣扎，最后选择 Need（正向弧）或拒绝 Need（堕落弧）。

### 对白辨识度 8 维

每个 named character 在 voice.md 必须填齐：
1. 词汇偏好（书面 / 口语 / 行话 / 古风）
2. 句长（短促 / 绵长 / 混合）
3. 缩略与口头禅
4. 标志性口头禅（≤ 3 个）
5. 提问 / 陈述比
6. 打断他人的频率
7. 比喻取材域（农业 / 战争 / 商业 / 情感 / 自然）
8. 直接 / 含蓄

## 3. 世界观

### Sanderson 三定律

1. 魔法系统的"理解度"决定主角能否用它解决冲突（理解越深，越能解；纯神秘魔法只适合制造问题，不适合解决问题）
2. 限制比能力更有趣（写魔法不能做什么，比写它能做什么更出戏）
3. 在加入新元素前，把现有元素扩展到极致

### 三支柱

物理（地理 / 气候 / 生态）+ 文化（宗教 / 阶级 / 习俗）+ 魔法（如果有）。

### 冰山原则

作者必须知道的细节是呈现给读者的 10 倍。

## 4. 伏笔（foreshadowing）

- 规则 1：每个被显著介绍的元素都必须有用途
- 规则 2：每个高潮元素都必须被预先埋设
- 类型：直接、象征、对白、动作、命名

伏笔账本（foreshadowing ledger）：在 outline.md 末尾建表，列每个伏笔的"埋设章 → 兑现章 → 类型 → 状态"。

## 5. Show, Don't Tell（操作化定义）

**Telling**：用抽象标签（felt scared, was angry）。
**Showing**：用动作 / 感官 / 对白 / 具体细节。

可机械检测的 telling 模式：
- 直接情绪宣告："X 感到 / X 觉得 / X 是……（情绪词）"
- 情绪副词："悲伤地""愤怒地""紧张地"修饰动词
- 性格标签："他是个善良的人"
- 关系宣告："他们是最好的朋友"

## 6. Stability Trap（autonovel 强调的核心警告）

LLM 默认追求"稳定"——所有冲突都在章末被解决，所有角色都回到平衡。
对抗策略：
- 角色必须真正改变（不能"看似改变其实没变"）
- 允许不可逆的损失（死亡、断绝、永远的误解）
- 保留信息（神秘要保到很晚才揭示）
- 创造道德灰色地带
- 节奏起伏要大（章与章之间情绪强度要变化）
- 选择必须有代价
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/craft-zh.md
git commit -m "docs(novel): add craft-zh reference (Save the Cat / Wound-Want-Need-Lie / Sanderson)"
```

### Task 1.4：`edge-tts-voice-catalog.md`（中文 voice 清单）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/edge-tts-voice-catalog.md`

- [ ] **Step 1: 写入文档**

Create `.claude/skills/novel-foundation-builder/references/edge-tts-voice-catalog.md`:

```markdown
# Edge-TTS 中文 Voice 目录（用于多角色配音映射）

> 由 `novel-foundation-builder/scripts/lib/voice-assigner.ts` 在生成 `voices.json` 时消费。
> `audio-novel-packager/scripts/lib/speaker-attribution.ts` 在解析对话后查表。

## Schema

每条记录必须可被 `voice-assigner.ts` 直接 import：

```typescript
export interface VoiceProfile {
  id: string;           // edge-tts voice id（zh-CN-... Neural）
  gender: "male" | "female";
  ageBand: "child" | "young" | "adult" | "elder";
  timbre: string;       // 中文一句话定位
  bestFor: string[];    // 适配角色类型
  rate?: string;        // 推荐语速覆写（默认 +0%）
  notes?: string;
}
```

## 旁白 NARRATOR（默认）

| id | 定位 |
|---|---|
| `zh-CN-YunyangNeural` | 男声沉稳，适合第三人称限定 POV 旁白；可读性强、停顿自然 |

备选：`zh-CN-YunjianNeural`（更厚重，适合史诗 / 严肃题材）。

## 男声

| id | gender | age | timbre | bestFor |
|---|---|---|---|---|
| `zh-CN-YunyangNeural` | male | adult | 沉稳新闻播报 | 旁白 / 中年男性 |
| `zh-CN-YunjianNeural` | male | adult | 厚重磁性 | 父亲 / 军人 / 反派 |
| `zh-CN-YunxiNeural` | male | young | 清亮温和 | 男主角 / 学生 / 温柔型 |
| `zh-CN-YunxiaNeural` | male | child | 童声活泼 | 小男孩 |
| `zh-CN-YunfengNeural` | male | adult | 文艺低沉 | 学者 / 文人 / 内省型 |
| `zh-CN-YunhaoNeural` | male | adult | 解说风格 | 配角 / 副 NARRATOR |

## 女声

| id | gender | age | timbre | bestFor |
|---|---|---|---|---|
| `zh-CN-XiaoxiaoNeural` | female | adult | 标准甜美 | 女主角 / 都市女性 |
| `zh-CN-XiaoyiNeural` | female | child | 童声 | 小女孩 / 儿童（picture-book 默认） |
| `zh-CN-XiaohanNeural` | female | adult | 温润成熟 | 母亲 / 师姐 / 知识女性 |
| `zh-CN-XiaomoNeural` | female | adult | 清冷理性 | 女反派 / 冷淡型 / 高知 |
| `zh-CN-XiaoxuanNeural` | female | adult | 古风 | 古装 / 仙侠女主 |
| `zh-CN-XiaoruiNeural` | female | elder | 老年女性 | 奶奶 / 长辈 |
| `zh-CN-XiaoshuangNeural` | female | child | 萌系童声 | 小女孩备选 |
| `zh-CN-XiaoqiuNeural` | female | elder | 沉稳长辈 | 母亲 / 教师 |

## 自动分配策略（voice-assigner.ts）

1. NARRATOR 永远 = `zh-CN-YunyangNeural`（除非 user 在 voice.md 显式覆盖）
2. 主角先匹配 gender + ageBand → 同档随机选 1 个，记入 voices.json
3. 配角与主角同 gender + ageBand 时，从剩余池里挑（避免重复 voice）
4. 全角色超过 8 个时：长尾配角共用一个"群众 voice"（NARRATOR 备选 `zh-CN-YunhaoNeural`）
5. 性别 / 年龄段不明 → 由 LLM 在生成 characters.md 时填补，再分配

## 限制

- edge-tts 不支持音色克隆。需要复刻特定演员声线 → 切到 CosyVoice 2 / GPT-SoVITS（v2 候选）
- audio_tag（如 `[whisper]`）目前在 edge-tts 上效果有限，主要靠 rate / pitch 微调（保留接口，渲染时自适配）
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/edge-tts-voice-catalog.md
git commit -m "docs(novel): add edge-tts voice catalog with auto-assignment policy"
```

### Task 1.5：`style-presets-novel.md`（网漫小说风格预设）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/style-presets-novel.md`

- [ ] **Step 1: 写入文档**

Create `.claude/skills/novel-foundation-builder/references/style-presets-novel.md`:

```markdown
# 网漫小说风格预设

> 类比 `picture-book-creator/references/style-presets.md`，但面向**网漫范式**：偏向二次元、动漫、写实场景，不走"幼儿绘本"路线。
> 由 `novel-foundation-builder` 在阶段 1 写 `style.md` 时引用，由 `scene-illustrator` 在生成 prompt 时拼接。

## Schema

每个 preset 包含：
- `name`：中文名
- `bestFor`：适配题材
- `promptPrefix`：英文 prompt 前缀（拼到每张图最前）
- `negative`：负面提示词

## Preset 1：清新水彩（默认）

- **bestFor**：青春、校园、治愈、轻奇幻
- **promptPrefix**：
  ```
  Soft watercolor illustration, gentle pastel palette, clean linework with watercolor wash background,
  cinematic but warm composition, anime-influenced character design, slight bloom highlights,
  paper texture barely visible, 2D, clean, expressive faces
  ```
- **negative**：
  ```
  no photorealism, no 3D render, no harsh shadows, no oil painting texture, no manga screentones,
  no watermark, no signature, no text overlay
  ```

## Preset 2：厚涂二次元

- **bestFor**：战斗、奇幻冒险、热血番风格
- **promptPrefix**：
  ```
  Detailed anime illustration with thick painterly brushwork, dynamic composition, dramatic lighting,
  rich color palette with strong contrast, expressive cinematic poses, semi-realistic anatomy,
  detailed background, key visual quality
  ```
- **negative**：
  ```
  no flat color fill, no chibi proportions, no photorealism, no 3D, no watermark, no text overlay
  ```

## Preset 3：写实素描

- **bestFor**：悬疑、推理、年代、严肃题材
- **promptPrefix**：
  ```
  High-detail pencil sketch with selective ink wash, monochrome with single accent color,
  realistic anatomy and clothing, atmospheric perspective, film noir lighting, hatching shading,
  graphic novel quality
  ```
- **negative**：
  ```
  no full color, no anime style, no cartoonish exaggeration, no 3D, no watermark
  ```

## Preset 4：国风工笔

- **bestFor**：仙侠、古言、东方奇幻
- **promptPrefix**：
  ```
  Chinese gongbi-style illustration, fine ink linework, traditional silk-painting palette
  (jade green, vermilion, indigo, gold), graceful flowing fabrics, intricate hair ornaments,
  cloud and ink-wash background, painted on rice paper aesthetic, semi-realistic anime hybrid
  ```
- **negative**：
  ```
  no western fantasy elements, no plate armor, no sci-fi, no photorealism, no 3D, no watermark
  ```

## Preset 5：赛博朋克

- **bestFor**：科幻、近未来、反乌托邦
- **promptPrefix**：
  ```
  Cyberpunk anime illustration, neon-lit night cityscape, holographic UI elements, rain-slick streets,
  high-saturation magenta and cyan accents, hard-edged character design with cyberware details,
  cinematic wide-angle composition, blade-runner influence
  ```
- **negative**：
  ```
  no medieval fantasy, no pastoral, no daylight scene unless specified, no watermark
  ```

## 自由组合规则

- `style.md` 默认引用 1 个 preset 作为基线
- 用户可在 voice.md 之外覆写 `promptPrefix` / `negative`，但不要删除 preset 的"质量约束"部分（"no watermark"等）
- scene-illustrator 拼 prompt 顺序：`promptPrefix` → 角色锚定短语 → 场景描述 → `negative`
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/style-presets-novel.md
git commit -m "docs(novel): add style-presets-novel (5 presets for web-comic-novel illustrations)"
```

---

## Phase 2 — novel-foundation-builder（共演化文档生成）

**目标**：从 seed 一次性产出 `world.md` / `characters.md` / `outline.md` / `voice.md` / `style.md` 5 个相互一致的 layer 文档，并初始化 `state.json`。

**Files (Phase 2 全景)**：
- Create: `.claude/skills/novel-foundation-builder/SKILL.md`
- Create: `.claude/skills/novel-foundation-builder/references/output-schema.md`
- Create: `.claude/skills/novel-foundation-builder/scripts/lib/voice-assigner.ts`
- Create: `.claude/skills/novel-foundation-builder/scripts/lib/schemas.ts`
- Create: `.claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts`
- Create: `.claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts`

> 本 skill 的"主流程"由 LLM 直接读 `SKILL.md` 走 prompt 完成（产出 5 个 .md）；脚本只承担：(a) 解析/校验产出 (b) 给角色自动配 voice。这与 `picture-book-creator` 的"SKILL.md 即 prompt 入口、scripts 只做工具"的现有惯例一致。

---

### Task 2.1：写 SKILL.md（主入口 prompt）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/SKILL.md`

- [ ] **Step 1：写 SKILL.md**

```markdown
---
name: novel-foundation-builder
description: Use when the user wants to build the foundation layers (world / characters / outline / voice / style) of an illustrated audio novel from a seed concept. Produces 5 co-evolving Markdown files plus initial state.json. Always invoked by `illustrated-audio-novel-creator` (Stage 1), but may also be used standalone.
---

# Novel Foundation Builder

## When to invoke

- 用户给出 **seed 概念**（一段 50–500 字的故事点子）+ tier（short / medium / long）
- 需要生成"可被 chapter-workshop 直接使用的"5 层基础文档
- 不要在已有 foundation 的项目上重复跑（会覆盖）；若需要修订请直接编辑文件

## Inputs (从主编排器传入)

| 字段 | 来源 | 示例 |
|---|---|---|
| `seed` | 用户原始想法 | "一个失明少女在末世废土学会感知灵气" |
| `tier` | short / medium / long | `medium` |
| `target_words` | tier 衍生 | 30000 |
| `chapter_count` | tier 衍生 | 12 |
| `language` | 默认 zh | `zh` |
| `output_dir` | 项目根 | `novel-output/2026-05-13-blind-girl/` |

## Outputs

固定写入 `<output_dir>/`：

```
world.md          # 设定（地理 / 历史 / 体系 / 规则）
characters.md     # 4–8 个角色，每个含：core / wound / want / need / lie / voice_profile
outline.md        # chapter_count 章节，每章含：beat / POV / scene_count_hint
voice.md          # 叙述视角 / 时态 / 句感 / 禁用词
style.md          # 引用 1 个 style preset + 角色锚定短语规范
state.json        # 初始化（见 schemas.ts）
```

## Process（由 LLM 走完）

### Step 1：扩写 seed → 故事核

读取 `references/output-schema.md` 学会 schema，然后基于 seed 写一段 200–400 字的"故事核"放在草稿里（不写文件），明确：
- 主人公的 wound / want / need / lie（四要素，见 `craft-zh.md`）
- 中央冲突 + 主题
- tier 对应的"故事规模"提示

### Step 2：生成 world.md

参考 `craft-zh.md` 的"Sanderson 三定律"与"稳定陷阱"，覆盖：
- 地理 / 历史脉络（不超过 4 段）
- 体系（如有魔法/科技）：能做什么、限制是什么、代价是什么
- 已知的"恒定真相"列表（事实表，便于跨章节查证）

### Step 3：生成 characters.md

4–8 个角色，每个固定 schema（见 `output-schema.md`）：
- `name` / `role`（主角/对手/导师/盟友/...）
- `core`（一句话）
- `wound` / `want` / `need` / `lie`（来自 craft-zh.md）
- `appearance`（外貌锚定短语，将被 scene-illustrator 直接复用）
- `voice_profile`：仅占位 `auto`，后续由 voice-assigner 填充

### Step 4：生成 outline.md

按 `chapter_count` 划分。如果 tier=long，必须套用 Save the Cat 15-beat 结构（见 craft-zh.md）；medium 用 9-beat 简化版；short 用三幕 5-beat。每章固定字段：
- `chapter_n` / `title` / `beat`（对应结构节拍）/ `pov` / `summary`（80–120 字）/ `scene_count_hint`

### Step 5：生成 voice.md + style.md

- `voice.md`：叙述人称、时态、句长偏好、句感（"克制"/"华丽"/"口语化"）、禁用词清单（参照 anti-slop-zh.md）
- `style.md`：选 1 个 style preset（见 style-presets-novel.md），写下 `promptPrefix` / `negative` / `palette`

### Step 6：调用脚本生成 state.json + 分配 voice

```bash
bun run .claude/skills/novel-foundation-builder/scripts/init-foundation.ts \
  --output-dir <output_dir> \
  --seed "<seed>" \
  --tier <tier>
```

脚本会：
1. 校验 5 个 .md 是否符合 schema（schemas.ts）
2. 读取 characters.md，为每个角色调用 voice-assigner 自动分配 edge-tts voice
3. 写回 characters.md（填充 voice_profile）
4. 写 state.json（含 phase=foundation_done、debt 列表为空）

## Quality bar（自检）

完成后逐项确认：
- [ ] 主人公的 wound 与 outline 的"低谷章节"是否呼应？
- [ ] world.md 体系的"代价"是否在 outline 至少一章被触发？
- [ ] characters.md 每个角色 appearance 字段都包含"可视化锚定短语"（颜色/服饰/特征三选二）？
- [ ] voice.md 禁用词清单与 anti-slop-zh.md 对齐？

不满足任一项 → 当场修订，不要交给下游。

## References

- `references/output-schema.md`（5 个文件的 frontmatter / 字段约束）
- `../novel-chapter-workshop/references/craft-zh.md`（Save the Cat / Wound-Want-Need-Lie / Sanderson 三定律）
- `../novel-chapter-workshop/references/anti-slop-zh.md`（禁用词清单）
- `references/style-presets-novel.md`（5 套插画风格）
- `references/edge-tts-voice-catalog.md`（voice-assigner 用的目录）
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-foundation-builder/SKILL.md
git commit -m "feat(novel): add novel-foundation-builder SKILL.md"
```

---

### Task 2.2：写 output-schema.md

**Files:**
- Create: `.claude/skills/novel-foundation-builder/references/output-schema.md`

- [ ] **Step 1：写 output-schema.md**

```markdown
# Foundation Output Schema

5 个 .md 文件的字段契约。脚本会按本文档校验；不符则报错回写。

## world.md

```yaml
---
title: <string>            # 世界名
genre: <string>            # 玄幻 / 科幻 / 都市 / ...
era: <string>              # 时代
---

# 地理
<≤4 段>

# 历史
<≤4 段>

# 体系
- 能做什么：...
- 限制：...
- 代价：...

# 恒定真相（事实表）
- <fact 1>
- <fact 2>
- ...
```

## characters.md

```yaml
---
count: <int 4..8>
---

## <name>
- role: 主角 | 对手 | 导师 | 盟友 | 反派 | 配角
- core: <one sentence>
- wound: <past trauma>
- want: <surface goal>
- need: <deeper truth>
- lie: <self-deception>
- appearance: <颜色/服饰/特征三选二，英文短语优先以便插图直接复用>
  例: "long silver hair tied with a red ribbon, dark green robe, blind milky eyes"
- voice_profile: auto    # 由 voice-assigner 填充
```

每个角色 6 个字段都必填（appearance 不可空）。

## outline.md

```yaml
---
tier: short | medium | long
chapter_count: <int>
target_words_total: <int>
beat_structure: 5-act | 9-beat | save-the-cat-15
---

## Chapter 1: <title>
- beat: <对应节拍名，如 "Opening Image">
- pov: <name>
- summary: <80–120 字>
- scene_count_hint: <int>   # 用于估算插图数量

...

## Chapter N: <title>
...
```

## voice.md

```yaml
---
person: 第一人称 | 第三人称限知 | 第三人称全知
tense: 过去时 | 现在时
language: zh
---

# 句感
<2–3 句话描述>

# 句长偏好
- 平均：<int> 字
- 节奏：短句为主 | 长短交错 | 长句铺陈

# 禁用词清单
- <word 1>
- <word 2>
...
```

## style.md

```yaml
---
preset: <preset 名，必须存在于 style-presets-novel.md>
---

# promptPrefix
<英文，复用 preset 的同时可追加专属修饰>

# negative
<英文逗号分隔>

# palette
- <color 1>
- <color 2>
...

# 角色锚定短语索引
| name | anchor (English) |
|---|---|
| <name> | <copied from characters.md appearance> |
```

## state.json

由脚本生成，schema 见 `scripts/lib/schemas.ts`。
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-foundation-builder/references/output-schema.md
git commit -m "docs(novel): add foundation output-schema reference"
```

---

### Task 2.3：schemas.ts —— 类型定义 + Zod 校验器（TDD）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/scripts/lib/schemas.ts`
- Create: `.claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts`

**说明**：项目已用 Bun + TypeScript，但没有 Zod。我们不引入新依赖，**自己写最小 schema 校验器**（纯 TS，无运行时依赖）。函数签名贴近 Zod 直觉但只支持本项目所需。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts
import { describe, it, expect } from "bun:test";
import {
  parseCharactersMd,
  parseOutlineMd,
  validateState,
  type FoundationState,
} from "../lib/schemas";

describe("parseCharactersMd", () => {
  it("解析合规的 characters.md", () => {
    const md = `---\ncount: 2\n---\n\n## 林晚\n- role: 主角\n- core: 失明少女靠灵气感知世界\n- wound: 12岁失明\n- want: 复明\n- need: 接受新感官\n- lie: 我必须看见才有价值\n- appearance: long silver hair, dark green robe, milky eyes\n- voice_profile: auto\n\n## 沈渊\n- role: 导师\n- core: 隐居灵气医师\n- wound: 失去爱徒\n- want: 不再收徒\n- need: 重新信任\n- lie: 教导即背叛\n- appearance: tall man with grey beard, faded blue robe\n- voice_profile: auto\n`;
    const result = parseCharactersMd(md);
    expect(result.count).toBe(2);
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0].name).toBe("林晚");
    expect(result.characters[0].appearance).toContain("silver hair");
    expect(result.characters[1].voice_profile).toBe("auto");
  });

  it("缺少 appearance 字段时报错", () => {
    const md = `---\ncount: 1\n---\n\n## 林晚\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- voice_profile: auto\n`;
    expect(() => parseCharactersMd(md)).toThrow(/appearance/);
  });

  it("count 与实际角色数不匹配时报错", () => {
    const md = `---\ncount: 3\n---\n\n## A\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: x\n- voice_profile: auto\n`;
    expect(() => parseCharactersMd(md)).toThrow(/count/);
  });
});

describe("parseOutlineMd", () => {
  it("解析合规的 outline.md", () => {
    const md = `---\ntier: short\nchapter_count: 2\ntarget_words_total: 10000\nbeat_structure: 5-act\n---\n\n## Chapter 1: 觉醒\n- beat: Opening Image\n- pov: 林晚\n- summary: 林晚在废墟苏醒，第一次感知到灵气流动。她意识到失去视觉之后，世界以另一种方式回到她身边。这一章建立基调。\n- scene_count_hint: 3\n\n## Chapter 2: 相遇\n- beat: Catalyst\n- pov: 林晚\n- summary: 林晚遇到沈渊，被告知她的感知能力极为罕见。她拒绝相信，但被一场袭击逼迫接受现实。\n- scene_count_hint: 4\n`;
    const result = parseOutlineMd(md);
    expect(result.tier).toBe("short");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe("觉醒");
    expect(result.chapters[0].sceneCountHint).toBe(3);
  });

  it("chapter_count 与实际章节数不匹配时报错", () => {
    const md = `---\ntier: short\nchapter_count: 5\ntarget_words_total: 10000\nbeat_structure: 5-act\n---\n\n## Chapter 1: x\n- beat: x\n- pov: x\n- summary: ${"x".repeat(80)}\n- scene_count_hint: 1\n`;
    expect(() => parseOutlineMd(md)).toThrow(/chapter_count/);
  });
});

describe("validateState", () => {
  it("接受合规 state", () => {
    const state: FoundationState = {
      version: 1,
      project: "test-novel",
      tier: "short",
      phase: "foundation_done",
      seed: "x",
      target_words: 10000,
      chapter_count: 5,
      created_at: "2026-05-13T00:00:00Z",
      debts: [],
      chapters: {},
    };
    expect(() => validateState(state)).not.toThrow();
  });

  it("拒绝未知 phase", () => {
    expect(() =>
      validateState({ phase: "unknown" } as unknown as FoundationState),
    ).toThrow(/phase/);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts
```
Expected: FAIL — `Cannot find module '../lib/schemas'`

- [ ] **Step 3：实现 schemas.ts（最小可过）**

```typescript
// .claude/skills/novel-foundation-builder/scripts/lib/schemas.ts

export type Tier = "short" | "medium" | "long";
export type Phase =
  | "foundation_done"
  | "drafting"
  | "drafted"
  | "revising"
  | "revised"
  | "illustrated"
  | "audio_done"
  | "packaged";

export interface Character {
  name: string;
  role: string;
  core: string;
  wound: string;
  want: string;
  need: string;
  lie: string;
  appearance: string;
  voice_profile: string; // "auto" 或具体 voice id
}

export interface Chapter {
  n: number;
  title: string;
  beat: string;
  pov: string;
  summary: string;
  sceneCountHint: number;
}

export interface FoundationState {
  version: 1;
  project: string;
  tier: Tier;
  phase: Phase;
  seed: string;
  target_words: number;
  chapter_count: number;
  created_at: string; // ISO8601
  debts: Array<{ kind: string; ref: string; note: string }>;
  chapters: Record<
    string,
    {
      drafted?: boolean;
      revised?: boolean;
      score?: number;
      illustrations?: number;
      audio?: boolean;
    }
  >;
}

const REQUIRED_CHARACTER_FIELDS = [
  "role",
  "core",
  "wound",
  "want",
  "need",
  "lie",
  "appearance",
  "voice_profile",
] as const;

function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("frontmatter not found");
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

export function parseCharactersMd(md: string): {
  count: number;
  characters: Character[];
} {
  const { data, body } = parseFrontmatter(md);
  const expectedCount = parseInt(data.count, 10);
  if (!Number.isFinite(expectedCount)) throw new Error("frontmatter.count missing");

  const blocks = body.split(/^## /m).slice(1);
  const characters: Character[] = blocks.map((block) => {
    const [nameLine, ...rest] = block.split("\n");
    const fields: Record<string, string> = {};
    for (const line of rest) {
      const kv = line.match(/^- ([a-z_]+):\s*(.+)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    for (const f of REQUIRED_CHARACTER_FIELDS) {
      if (!fields[f]) throw new Error(`character "${nameLine.trim()}" missing field: ${f}`);
    }
    return {
      name: nameLine.trim(),
      role: fields.role,
      core: fields.core,
      wound: fields.wound,
      want: fields.want,
      need: fields.need,
      lie: fields.lie,
      appearance: fields.appearance,
      voice_profile: fields.voice_profile,
    };
  });

  if (characters.length !== expectedCount)
    throw new Error(
      `frontmatter.count=${expectedCount} 与实际角色数 ${characters.length} 不匹配`,
    );
  if (characters.length < 4 || characters.length > 8)
    throw new Error(`角色数必须在 4–8 之间（当前 ${characters.length}）`);

  return { count: expectedCount, characters };
}

export function parseOutlineMd(md: string): {
  tier: Tier;
  chapterCount: number;
  targetWordsTotal: number;
  beatStructure: string;
  chapters: Chapter[];
} {
  const { data, body } = parseFrontmatter(md);
  const tier = data.tier as Tier;
  if (!["short", "medium", "long"].includes(tier)) throw new Error("tier 非法");
  const chapterCount = parseInt(data.chapter_count, 10);

  const blocks = body.split(/^## Chapter /m).slice(1);
  const chapters: Chapter[] = blocks.map((block) => {
    const headMatch = block.match(/^(\d+):\s*(.+)/);
    if (!headMatch) throw new Error("章节标题格式错误，需为 '## Chapter N: 标题'");
    const n = parseInt(headMatch[1], 10);
    const title = headMatch[2].trim();
    const fields: Record<string, string> = {};
    for (const line of block.split("\n").slice(1)) {
      const kv = line.match(/^- ([a-z_]+):\s*(.+)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    for (const f of ["beat", "pov", "summary", "scene_count_hint"]) {
      if (!fields[f]) throw new Error(`Chapter ${n} 缺字段: ${f}`);
    }
    return {
      n,
      title,
      beat: fields.beat,
      pov: fields.pov,
      summary: fields.summary,
      sceneCountHint: parseInt(fields.scene_count_hint, 10),
    };
  });

  if (chapters.length !== chapterCount)
    throw new Error(
      `frontmatter.chapter_count=${chapterCount} 与实际章节数 ${chapters.length} 不匹配`,
    );

  return {
    tier,
    chapterCount,
    targetWordsTotal: parseInt(data.target_words_total, 10),
    beatStructure: data.beat_structure,
    chapters,
  };
}

const VALID_PHASES: Phase[] = [
  "foundation_done",
  "drafting",
  "drafted",
  "revising",
  "revised",
  "illustrated",
  "audio_done",
  "packaged",
];

export function validateState(s: FoundationState): void {
  if (!VALID_PHASES.includes(s.phase as Phase))
    throw new Error(`非法 phase: ${s.phase}`);
  if (!["short", "medium", "long"].includes(s.tier as string))
    throw new Error(`非法 tier: ${s.tier}`);
  if (typeof s.chapter_count !== "number" || s.chapter_count < 1)
    throw new Error(`非法 chapter_count: ${s.chapter_count}`);
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts
```
Expected: PASS（6 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/novel-foundation-builder/scripts/lib/schemas.ts \
        .claude/skills/novel-foundation-builder/scripts/test/schemas.test.ts
git commit -m "feat(novel): foundation schemas.ts (parsers + validators) with tests"
```

---

### Task 2.4：voice-assigner.ts —— 角色自动配 voice（TDD）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/scripts/lib/voice-assigner.ts`
- Create: `.claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts`

**职责**：读 `references/edge-tts-voice-catalog.md`，根据每个角色的 role + 名字（隐含性别）启发式选 voice。要求：
1. 同一性别多个角色不能都用同一 voice（除非 catalog 不够）
2. 主角必须用"主角推荐"voice 池
3. 输出确定性（相同输入 → 相同输出）以便测试

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts
import { describe, it, expect } from "bun:test";
import { assignVoices, type CharacterForVoice } from "../lib/voice-assigner";

const catalog = `# edge-tts voice catalog (zh-CN)

## 主角推荐
- zh-CN-XiaoxiaoNeural | female | warm, expressive
- zh-CN-YunyangNeural | male | calm, narrator-friendly

## 配角池
- zh-CN-YunjianNeural | male | rough
- zh-CN-XiaoyiNeural | female | youthful
- zh-CN-YunxiNeural | male | bright
- zh-CN-XiaomengNeural | female | sweet

## 旁白
- zh-CN-YunyangNeural | male | calm, narrator-friendly
`;

describe("assignVoices", () => {
  it("主角拿到主角池中的 voice", () => {
    const chars: CharacterForVoice[] = [
      { name: "林晚", role: "主角", gender_hint: "female" },
      { name: "沈渊", role: "导师", gender_hint: "male" },
      { name: "周泽", role: "盟友", gender_hint: "male" },
      { name: "苏雨", role: "对手", gender_hint: "female" },
    ];
    const result = assignVoices(chars, catalog);
    expect(result["林晚"]).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("同性别多个角色 voice 不重复（在池足够时）", () => {
    const chars: CharacterForVoice[] = [
      { name: "A", role: "主角", gender_hint: "female" },
      { name: "B", role: "配角", gender_hint: "female" },
      { name: "C", role: "配角", gender_hint: "female" },
    ];
    const result = assignVoices(chars, catalog);
    const voices = Object.values(result);
    expect(new Set(voices).size).toBe(voices.length);
  });

  it("结果确定性：同输入两次调用结果相同", () => {
    const chars: CharacterForVoice[] = [
      { name: "A", role: "主角", gender_hint: "female" },
      { name: "B", role: "对手", gender_hint: "male" },
    ];
    expect(assignVoices(chars, catalog)).toEqual(assignVoices(chars, catalog));
  });

  it("旁白固定为 catalog 中标注的 narrator voice", () => {
    const chars: CharacterForVoice[] = [
      { name: "旁白", role: "旁白", gender_hint: "male" },
    ];
    const result = assignVoices(chars, catalog);
    expect(result["旁白"]).toBe("zh-CN-YunyangNeural");
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts
```
Expected: FAIL — `Cannot find module '../lib/voice-assigner'`

- [ ] **Step 3：实现 voice-assigner.ts（最小可过）**

```typescript
// .claude/skills/novel-foundation-builder/scripts/lib/voice-assigner.ts

export interface CharacterForVoice {
  name: string;
  role: string; // 主角 / 对手 / 导师 / 配角 / 反派 / 盟友 / 旁白
  gender_hint: "male" | "female";
}

interface VoiceEntry {
  id: string;
  gender: "male" | "female";
  notes: string;
}

interface ParsedCatalog {
  protagonist: VoiceEntry[]; // 主角池
  supporting: VoiceEntry[]; // 配角池
  narrator: VoiceEntry | null;
}

function parseCatalog(catalog: string): ParsedCatalog {
  const sections: Record<string, VoiceEntry[]> = {};
  let current = "";
  for (const line of catalog.split("\n")) {
    const head = line.match(/^##\s+(.+)/);
    if (head) {
      current = head[1].trim();
      sections[current] = [];
      continue;
    }
    const item = line.match(/^-\s+([\w-]+)\s*\|\s*(male|female)\s*\|\s*(.+)$/);
    if (item && current) {
      sections[current].push({ id: item[1], gender: item[2] as "male" | "female", notes: item[3] });
    }
  }
  return {
    protagonist: sections["主角推荐"] ?? [],
    supporting: sections["配角池"] ?? [],
    narrator: sections["旁白"]?.[0] ?? null,
  };
}

export function assignVoices(
  chars: CharacterForVoice[],
  catalog: string,
): Record<string, string> {
  const parsed = parseCatalog(catalog);
  const result: Record<string, string> = {};
  const usedSupporting = new Set<string>();

  // 排序保证确定性：先主角，再按角色名字典序
  const sorted = [...chars].sort((a, b) => {
    const roleOrder = (r: string) =>
      r === "主角" ? 0 : r === "旁白" ? 1 : 2;
    const ra = roleOrder(a.role);
    const rb = roleOrder(b.role);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  for (const c of sorted) {
    if (c.role === "旁白") {
      if (!parsed.narrator) throw new Error("catalog 缺旁白池");
      result[c.name] = parsed.narrator.id;
      continue;
    }

    if (c.role === "主角") {
      const pick = parsed.protagonist.find((v) => v.gender === c.gender_hint);
      if (pick) {
        result[c.name] = pick.id;
        usedSupporting.add(pick.id);
        continue;
      }
    }

    // 配角：按 gender 取第一个未用的
    let pick = parsed.supporting.find(
      (v) => v.gender === c.gender_hint && !usedSupporting.has(v.id),
    );
    // 池耗尽兜底：允许跨性别，最后允许复用
    pick ??= parsed.supporting.find((v) => !usedSupporting.has(v.id));
    pick ??= parsed.supporting[0];
    if (!pick) throw new Error("catalog 配角池为空");
    result[c.name] = pick.id;
    usedSupporting.add(pick.id);
  }

  return result;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts
```
Expected: PASS（4 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/novel-foundation-builder/scripts/lib/voice-assigner.ts \
        .claude/skills/novel-foundation-builder/scripts/test/voice-assigner.test.ts
git commit -m "feat(novel): voice-assigner with deterministic role-based assignment"
```

---

### Task 2.5：init-foundation.ts —— 总入口脚本（薄壳）

**Files:**
- Create: `.claude/skills/novel-foundation-builder/scripts/init-foundation.ts`

**职责**：CLI 入口，串起：(1) 读 5 个 .md 校验 (2) 调 voice-assigner (3) 回写 characters.md (4) 写 state.json。

- [ ] **Step 1：写实现**

```typescript
#!/usr/bin/env bun
// .claude/skills/novel-foundation-builder/scripts/init-foundation.ts

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCharactersMd,
  parseOutlineMd,
  validateState,
  type FoundationState,
  type Tier,
} from "./lib/schemas";
import { assignVoices, type CharacterForVoice } from "./lib/voice-assigner";

const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    seed: { type: "string" },
    tier: { type: "string" },
    project: { type: "string" },
  },
  strict: true,
});

if (!values["output-dir"] || !values.seed || !values.tier) {
  console.error("用法: --output-dir <dir> --seed <text> --tier <short|medium|long>");
  process.exit(1);
}
const tier = values.tier as Tier;
const outputDir = resolve(values["output-dir"]!);

// 1. 读 + 校验
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const outlineMd = await readFile(join(outputDir, "outline.md"), "utf8");
const charactersParsed = parseCharactersMd(charactersMd);
const outlineParsed = parseOutlineMd(outlineMd);

if (outlineParsed.tier !== tier) {
  throw new Error(`outline.md tier (${outlineParsed.tier}) 与 --tier (${tier}) 不匹配`);
}

// 2. 读 voice catalog
const here = dirname(fileURLToPath(import.meta.url));
const catalog = await readFile(
  resolve(here, "../references/edge-tts-voice-catalog.md"),
  "utf8",
);

// 3. 估性别（极简启发式：role=旁白 优先；否则按名字常见字粗判，无法判定时默认 female）
function guessGender(c: { name: string; role: string }): "male" | "female" {
  const maleHints = ["渊", "泽", "峰", "磊", "刚", "强", "杰", "伟"];
  const femaleHints = ["晚", "雨", "月", "雪", "媛", "婷", "怡", "芳"];
  for (const ch of c.name) {
    if (maleHints.includes(ch)) return "male";
    if (femaleHints.includes(ch)) return "female";
  }
  return "female";
}

const charsForVoice: CharacterForVoice[] = charactersParsed.characters.map((c) => ({
  name: c.name,
  role: c.role,
  gender_hint: guessGender(c),
}));
const voiceMap = assignVoices(charsForVoice, catalog);

// 4. 回写 characters.md（替换 voice_profile: auto → 实际 id）
let updatedMd = charactersMd;
for (const c of charactersParsed.characters) {
  const voice = voiceMap[c.name];
  // 仅替换该角色块内首次出现的 "voice_profile: auto"
  const re = new RegExp(`(## ${c.name}[\\s\\S]*?voice_profile:\\s*)auto`);
  updatedMd = updatedMd.replace(re, `$1${voice}`);
}
await writeFile(join(outputDir, "characters.md"), updatedMd);

// 5. 写 state.json
const state: FoundationState = {
  version: 1,
  project: values.project ?? outputDir.split("/").pop() ?? "novel",
  tier,
  phase: "foundation_done",
  seed: values.seed!,
  target_words: outlineParsed.targetWordsTotal,
  chapter_count: outlineParsed.chapterCount,
  created_at: new Date().toISOString(),
  debts: [],
  chapters: Object.fromEntries(
    outlineParsed.chapters.map((ch) => [String(ch.n), {}]),
  ),
};
validateState(state);
await writeFile(join(outputDir, "state.json"), JSON.stringify(state, null, 2));

console.log(`✓ foundation initialized: ${outputDir}`);
console.log(`  - characters: ${charactersParsed.count} (voices assigned)`);
console.log(`  - chapters: ${outlineParsed.chapterCount}`);
console.log(`  - state.phase: foundation_done`);
```

- [ ] **Step 2：本地烟雾测试（可跳过，CI 不要求）**

准备 `tmp-foundation/{characters.md,outline.md}` 两个最小文件，跑：
```bash
bun run .claude/skills/novel-foundation-builder/scripts/init-foundation.ts \
  --output-dir tmp-foundation --seed "test" --tier short
```
Expected: 输出 `✓ foundation initialized`，`tmp-foundation/state.json` 存在且 phase=foundation_done。

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/novel-foundation-builder/scripts/init-foundation.ts
git commit -m "feat(novel): init-foundation.ts CLI entry"
```

---

## Phase 3 — novel-chapter-workshop（章节起草 + 评估 + 修订）

**目标**：单一 skill 闭环处理"一章"的全生命周期：draft → evaluate → revise → ready。  
按 autonovel 的方法论：双免疫系统（mechanical 正则 + LLM 判官）+ 行内场景标记（供 Phase 4 切图）。

**Files (Phase 3 全景)**：
- Create: `.claude/skills/novel-chapter-workshop/SKILL.md`
- Create: `.claude/skills/novel-chapter-workshop/references/draft-prompt-template.md`
- Create: `.claude/skills/novel-chapter-workshop/references/eval-rubric.md`
- Create: `.claude/skills/novel-chapter-workshop/references/scene-marker-spec.md`
- Create: `.claude/skills/novel-chapter-workshop/references/anti-slop-zh.md` *(已在 Phase 1 创建，本节仅引用)*
- Create: `.claude/skills/novel-chapter-workshop/references/anti-patterns.md` *(已在 Phase 1 创建)*
- Create: `.claude/skills/novel-chapter-workshop/references/craft-zh.md` *(已在 Phase 1 创建)*
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/slop-scanner.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/pattern-scanner.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/scene-marker-parser.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-sloppy.md`
- Create: `.claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts`

> Phase 1 已经把 anti-slop-zh.md / anti-patterns.md / craft-zh.md 作为"共享 references"写入 `novel-chapter-workshop/references/`。本 phase 只新增工作坊专属的 3 份文档 + 3 个 scanner + 1 个 CLI。

---

### Task 3.1：写 SKILL.md（章节工作坊主入口）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/SKILL.md`

- [ ] **Step 1：写 SKILL.md**

```markdown
---
name: novel-chapter-workshop
description: Use to draft, evaluate, and revise a single chapter of an illustrated audio novel. Reads world / characters / outline / voice / style produced by novel-foundation-builder. Output is a finalized chapter Markdown with embedded scene markers ready for scene-illustrator. Always invoked by `illustrated-audio-novel-creator` per chapter; can also be used standalone to retry one chapter.
---

# Novel Chapter Workshop

## When to invoke

- foundation 已就绪（`<output_dir>/state.json` 中 `phase` ≥ `foundation_done`）
- 需要写**一章**或修订**一章**
- 不要一次性传"写所有章节"——主编排器会按章循环调用

## Inputs

| 字段 | 来源 |
|---|---|
| `output_dir` | 项目目录 |
| `chapter_n` | 当前章节号（int） |
| `mode` | `draft` \| `revise` \| `evaluate-only` |
| `prev_chapter_path?` | 上一章路径（draft 时用于衔接） |

## Outputs

写入 `<output_dir>/chapters/ch_<NN>.md`：

```markdown
---
chapter: 5
title: "门后之物"
pov: 林晚
beat: Catalyst
word_count: 2840
score: 7.4
status: ready
---

<!-- SCENE: 林晚走进废墟 | location: 北郊废墟 | mood: tense | participants: 林晚 -->
正文…
<!-- /SCENE -->

<!-- SCENE: 沈渊出场 | location: 北郊废墟 | mood: ominous | participants: 林晚, 沈渊 -->
正文…
<!-- /SCENE -->
```

`<output_dir>/chapters/ch_<NN>.eval.json`：评估明细（slop hits / pattern hits / LLM judge 分数）

## Process

### Mode = draft

#### Step 1：读上下文

读取 `world.md` / `characters.md` / `outline.md` / `voice.md` / `style.md` / `state.json`。  
仅取 outline 中"当前章节 + 前后各 1 章"的 summary（防过载）。  
读取 `references/draft-prompt-template.md`、`references/anti-slop-zh.md`（禁用词清单）、`references/anti-patterns.md`（结构禁忌）、`references/scene-marker-spec.md`（行内标记格式）。

#### Step 2：写章节

按 draft-prompt-template.md 的"写作要求"产出正文，必须：
- 句感、人称、时态严格遵循 voice.md
- 对话必须使用角色名而非代词描述（便于 packager 切多 voice）
- **每个明显场景切换处插入 SCENE 标记**（见 scene-marker-spec.md），首章 ≥ 2 段，长章 ≥ 4 段
- 不得出现 anti-slop-zh.md Tier 1 词汇
- 不得违反 anti-patterns.md 的"段首十条"

#### Step 3：自评 + 入库

调用脚本：
```bash
bun run .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts \
  --chapter <output_dir>/chapters/ch_<NN>.md \
  --voice <output_dir>/voice.md
```
输出 `ch_<NN>.eval.json`。若 score < 6.0 → 触发 mode=revise；否则写 frontmatter `status: ready` 并更新 state.json。

### Mode = revise

#### Step 1：读 eval.json + 章节当前内容
列出失败项（slop hits / pattern hits / judge 反馈）。

#### Step 2：定向重写
对每个 hit 走 surgical edit（不重写全章），优先级：anti-pattern > slop > judge 建议。  
保留 SCENE 标记的位置与 id；只能修改标记内的正文。

#### Step 3：重新评估
跑 evaluate-chapter.ts 二次评估，分数 ≥ 6.0 即结束；否则继续，最多 3 轮。3 轮仍不达标 → 写 frontmatter `status: needs_human` 并写入 `state.debts`。

### Mode = evaluate-only

只跑 evaluate-chapter.ts；不修改正文。

## Quality bar

每章交付前必须满足：
- [ ] mechanical slop_score ≤ 5（见 eval-rubric.md 阈值表）
- [ ] anti-pattern hits = 0（结构性禁忌）
- [ ] LLM judge overall ≥ 6.0
- [ ] 至少 2 个合法 SCENE 标记
- [ ] word_count 在 outline 提示的 ±20% 区间

## References

- `references/draft-prompt-template.md`
- `references/eval-rubric.md`
- `references/scene-marker-spec.md`
- `references/anti-slop-zh.md`
- `references/anti-patterns.md`
- `references/craft-zh.md`
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/SKILL.md
git commit -m "feat(novel): novel-chapter-workshop SKILL.md (draft/revise/evaluate)"
```

---

### Task 3.2：写 draft-prompt-template.md

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/references/draft-prompt-template.md`

- [ ] **Step 1：写文档**

```markdown
# Draft Prompt Template

LLM 在 mode=draft 时**自我对照**的 prompt 模板。不要直接把本文复制给用户；它是给执行者读的"我应该怎么写一章"checklist。

## 输入信息（从主流程组装）

```
<world_excerpt>      # 截取与本章相关的 1–2 段 world.md
<characters_block>   # 仅本章 POV + 出场角色
<outline_block>      # 当前 + 前后 1 章 summary
<voice_full>         # voice.md 全文
<style_anchors>      # 当前出场角色的 appearance 锚定短语
<prev_chapter_tail>  # 上一章最后 200 字（衔接用，draft only）
```

## 写作要求（顺序即优先级）

1. **节拍**：本章必须落在 outline 指定的 beat 上（如 "Catalyst" / "Midpoint")。开篇 200 字必须出现"催化事件"或对其的张力。
2. **人称 / 时态 / 句感**：100% 跟随 voice.md。第一段就要"听起来对"。
3. **对话归属**：每段对话**必须**带说话人名字（"林晚说" / "沈渊低声"）。不要靠代词或描写代替。这是 audio packager 切声的硬约束。
4. **场景切换 → 加标记**：物理位置变化、时间跳跃、视角转移、关键情绪反转 → 都要切 SCENE 块。格式见 scene-marker-spec.md。
5. **show vs tell**：感情用动作/感觉显，不用形容词命名。"她生气了" → ✗；"她把杯子扣在桌上，瓷裂" → ✓。
6. **禁用词**：开始写之前先看 anti-slop-zh.md Tier 1 列表，写完后自查。
7. **结构禁忌**：开篇不能用 anti-patterns.md "段首十条"中任何一条。
8. **字数**：贴近 outline 的 scene_count_hint × 600（每场景约 600 字）。

## 推荐写作流程

1. 写一段"开场镜头"草稿（200 字），自问：是否落在 beat？是否合 voice？
2. 不合 → 重写第 1 段；合 → 继续。
3. 按场景切块写，每个 SCENE 写完检查"对话归属是否完整"。
4. 全章写完 → 自查禁用词 → 自查结构禁忌 → 调 evaluate-chapter.ts。
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/references/draft-prompt-template.md
git commit -m "docs(novel): draft prompt template for chapter workshop"
```

---

### Task 3.3：写 eval-rubric.md

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/references/eval-rubric.md`

- [ ] **Step 1：写文档**

```markdown
# Chapter Eval Rubric

evaluate-chapter.ts 的打分口径。LLM judge 严格按本表打分，不要自由发挥。

## 维度（每项 0–10，整数）

| 维度 | 评分要点 |
|---|---|
| voice_fit | 句感 / 人称 / 时态匹配 voice.md。一处明显违和 -1。 |
| character_distinct | 不同角色的对话/行动是否区分？同质 ≤4，鲜明 ≥7。 |
| beat_coverage | 是否覆盖 outline 指定 beat？缺失=0，浮于表面 ≤4，扎实落地 ≥7。 |
| prose_quality | 句子节奏、动词力度、show-don't-tell 比例。 |
| anti_pattern_residue | 即便正则没抓到，凭直觉还有多少"AI 味"。无 ≥8，明显 ≤3。 |
| scene_clarity | 场景切换是否清晰？SCENE 标记是否落在合理处？ |

`overall = round((voice_fit*1.5 + character_distinct + beat_coverage + prose_quality*1.5 + anti_pattern_residue + scene_clarity) / 7, 1)`

## Mechanical 阈值

| 检测器 | 阈值 | 含义 |
|---|---|---|
| slop_hits Tier 1 | ≤ 0 | Tier 1 是绝对禁用，命中即修 |
| slop_hits Tier 2 | ≤ 3 | 容忍少量惯用表达 |
| pattern_hits | = 0 | 结构禁忌不容忍 |
| dialog_attribution_missing | ≤ 1 | 多于 1 处会让 audio packager 出乱 |

## 通过线

- `mode=draft` 默认通过线：`overall ≥ 6.0` 且 mechanical 三项达标
- `mode=revise` 经 3 轮仍不达标 → 写入 `state.debts`，标记 `status: needs_human`
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/references/eval-rubric.md
git commit -m "docs(novel): chapter eval rubric (mechanical + LLM judge)"
```

---

### Task 3.4：写 scene-marker-spec.md

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/references/scene-marker-spec.md`

- [ ] **Step 1：写文档**

````markdown
# Scene Marker Spec

章节 Markdown 内嵌的"场景块"语法。供 scene-illustrator 直接切片生成插图。

## 格式

```markdown
<!-- SCENE: <一句中文场景标题> | location: <地点> | mood: <情绪标签> | participants: <角色名 1>, <角色名 2> -->
正文段落（一段或多段）...
<!-- /SCENE -->
```

## 字段

- `SCENE`（必填）：3–15 字中文标题，将作为插图 caption
- `location`（必填）：来自 world.md 的地名，或自洽的新地点
- `mood`（必填）：从这 12 选 1 — `calm` / `tense` / `ominous` / `melancholy` / `joyful` / `fearful` / `awe` / `defiant` / `tender` / `furious` / `lonely` / `mysterious`
- `participants`（必填）：当前镜头里**可见**的角色名（characters.md 中已定义），逗号分隔；无人时写 `none`

## 触发何时切 SCENE

按"网漫范式"约 800–1000 字 1 张图的密度，但**触发优先于密度**：

1. 物理地点变更
2. 时间显著跳跃（"三日后"、"次日清晨"）
3. POV 角色心理状态反转
4. 关键道具首次出现
5. 新角色登场（即便地点未变）

## 嵌套与重叠

- 不允许嵌套（`<!-- SCENE -->` 内不能再开 `<!-- SCENE -->`）
- 不允许重叠（必须先 `</SCENE -->` 才能开新的）

## 解析约束

- 标题 / location / mood / participants 之间用 ` | ` 分隔（空格 + 管道 + 空格）
- 不允许换行写 frontmatter
- 注释符号必须是 HTML 注释 `<!--` / `-->`，前后空格不省

## 示例（完整一章片段）

```markdown
## Chapter 5: 门后之物

<!-- SCENE: 林晚走入废墟 | location: 北郊废墟 | mood: tense | participants: 林晚 -->
她的手指掠过墙面，灰尘像旧雪一般落下。林晚听见自己的呼吸……
<!-- /SCENE -->

<!-- SCENE: 沈渊的低语 | location: 北郊废墟 | mood: ominous | participants: 林晚, 沈渊 -->
"你不该来这里。"沈渊的声音从黑暗里钻出来……
<!-- /SCENE -->
```
````

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/references/scene-marker-spec.md
git commit -m "docs(novel): scene marker spec for inline SCENE blocks"
```

---

### Task 3.5：测试 fixtures（章节样本）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-sloppy.md`

**说明**：fixtures 同时被 slop-scanner / pattern-scanner / scene-marker-parser 测试复用，集中放一处避免重复。

- [ ] **Step 1：写"好章节"fixture**

```markdown
<!-- file: .claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md -->
---
chapter: 1
title: "灰雪"
pov: 林晚
beat: Opening Image
---

<!-- SCENE: 苏醒 | location: 北郊废墟 | mood: melancholy | participants: 林晚 -->
林晚醒来时，手指先碰到冷。她伸手去摸床沿，触到的却是碎瓷。瓷片割开皮肤的瞬间，她才记起——床早就没了。
她坐起，把手搭在膝上，听。远处有水声，断续，像有人在用碗舀。
<!-- /SCENE -->

<!-- SCENE: 听见脚步 | location: 北郊废墟 | mood: tense | participants: 林晚, 沈渊 -->
脚步停在三步外。
"你能听见我？"沈渊问。
"能。"林晚说。她把指尖按在地上，灰尘里有震。"你穿的是麻鞋。"
沈渊没说话，蹲下来。林晚听见膝盖响。
<!-- /SCENE -->
```

- [ ] **Step 2：写"坏章节"fixture**

```markdown
<!-- file: .claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-sloppy.md -->
---
chapter: 1
title: "灰烬之中"
pov: 林晚
beat: Opening Image
---

在那个充满希望与绝望交织的清晨，林晚缓缓地睁开了她那双失去光明的眼睛。她不禁陷入了深深的沉思，回忆如潮水般涌来。她意识到自己必须坚强，必须勇敢地面对这一切。

"哦不，这怎么可能？"她低声说道，眼中闪烁着泪光。

突然，一个神秘的身影出现在她面前。"你好，年轻人。"那人说，"我是来帮助你的。"

林晚感到一阵前所未有的悸动，仿佛命运的齿轮开始缓缓转动。
```

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md \
        .claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-sloppy.md
git commit -m "test(novel): chapter fixtures (good + sloppy) for scanner tests"
```

---

### Task 3.6：slop-scanner.ts —— 中文禁用词扫描（TDD）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/slop-scanner.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts`

**职责**：读 `references/anti-slop-zh.md` 的 Tier 1/2/3 词表，对章节正文做精确字符串匹配（不跨段、不跨标点）。返回每个 hit 的 (tier, term, line, column) 列表。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanSlop, type SlopHit } from "../lib/slop-scanner";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

const tinyAntiSlop = `# anti-slop-zh

## Tier 1（绝对禁用）
- 缓缓地
- 不禁
- 仿佛命运的齿轮

## Tier 2（容忍少量）
- 充满希望
- 深深的沉思

## Tier 3（视语境）
- 突然
`;

describe("scanSlop", () => {
  it("命中 Tier 1 词，记录 tier+term", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    const tier1 = hits.filter((h) => h.tier === 1);
    expect(tier1.map((h) => h.term)).toContain("缓缓地");
    expect(tier1.map((h) => h.term)).toContain("不禁");
    expect(tier1.map((h) => h.term)).toContain("仿佛命运的齿轮");
  });

  it("Tier 2 计入但与 Tier 1 区分", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    expect(hits.some((h) => h.tier === 2 && h.term === "深深的沉思")).toBe(true);
  });

  it("好章节命中数为 0", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    expect(hits).toHaveLength(0);
  });

  it("hit 包含 1-based 行号与列号", () => {
    const md = `---\nfoo: bar\n---\n\n第一段，没问题。\n第二段，缓缓地走过来。\n`;
    const hits = scanSlop(md, tinyAntiSlop);
    expect(hits[0].line).toBe(6);
    expect(hits[0].column).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts
```
Expected: FAIL — `Cannot find module '../lib/slop-scanner'`

- [ ] **Step 3：实现 slop-scanner.ts**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/lib/slop-scanner.ts

export interface SlopHit {
  tier: 1 | 2 | 3;
  term: string;
  line: number; // 1-based
  column: number; // 1-based, char index
}

interface TieredVocab {
  1: string[];
  2: string[];
  3: string[];
}

export function parseAntiSlop(md: string): TieredVocab {
  const out: TieredVocab = { 1: [], 2: [], 3: [] };
  let current: 1 | 2 | 3 | null = null;
  for (const line of md.split("\n")) {
    const head = line.match(/^##\s+Tier\s+(\d)/);
    if (head) {
      const t = parseInt(head[1], 10);
      current = (t === 1 || t === 2 || t === 3 ? t : null) as 1 | 2 | 3 | null;
      continue;
    }
    if (!current) continue;
    const item = line.match(/^-\s+(.+)$/);
    if (item) out[current].push(item[1].trim());
  }
  return out;
}

function stripFrontmatterAndComments(md: string): string {
  // 去 frontmatter；保留行号 → 用换行替换
  let body = md.replace(/^---\n[\s\S]*?\n---\n/, (m) =>
    "\n".repeat(m.split("\n").length - 1),
  );
  // 去 SCENE 注释行（只去 <!-- ... --> 标签本身，正文保留）
  body = body.replace(/<!--[^]*?-->/g, (m) => " ".repeat(m.length));
  return body;
}

export function scanSlop(chapterMd: string, antiSlopMd: string): SlopHit[] {
  const vocab = parseAntiSlop(antiSlopMd);
  const body = stripFrontmatterAndComments(chapterMd);
  const lines = body.split("\n");
  const hits: SlopHit[] = [];

  const tiers: Array<1 | 2 | 3> = [1, 2, 3];
  for (const tier of tiers) {
    for (const term of vocab[tier]) {
      if (!term) continue;
      for (let i = 0; i < lines.length; i++) {
        let from = 0;
        while (true) {
          const idx = lines[i].indexOf(term, from);
          if (idx === -1) break;
          hits.push({ tier, term, line: i + 1, column: idx + 1 });
          from = idx + term.length;
        }
      }
    }
  }
  return hits;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts
```
Expected: PASS（4 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/scripts/lib/slop-scanner.ts \
        .claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts
git commit -m "feat(novel): slop-scanner with tiered Chinese vocab match"
```

---

### Task 3.7：pattern-scanner.ts —— 结构禁忌扫描（TDD）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/pattern-scanner.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts`

**职责**：检测 anti-patterns.md 中"段首十条"等**结构性 AI 痕迹**。这与 slop-scanner 的差异是：scanner 关心"特定位置的特定模式"（如开篇句、段首、对话归属），不只是词表。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanPatterns, type PatternHit } from "../lib/pattern-scanner";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

describe("scanPatterns", () => {
  it("捕获 sloppy fixture 的开篇套路", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanPatterns(ch);
    // 期望命中：开篇 "在那个X与Y交织的Z" 模式
    expect(hits.some((h) => h.code === "ARCHETYPE_OPENING_BIPOLAR")).toBe(true);
  });

  it("捕获缺对话归属", async () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: 林晚 -->\n"我来了。"\n"你早。"\n<!-- /SCENE -->\n`;
    const hits = scanPatterns(md);
    expect(hits.some((h) => h.code === "DIALOG_ATTRIB_MISSING")).toBe(true);
  });

  it("好章节命中为 0", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const hits = scanPatterns(ch);
    expect(hits).toHaveLength(0);
  });

  it("hit 含行号", () => {
    const md = `---\nx: y\n---\n\n在那个充满希望与绝望交织的清晨，林晚醒来。`;
    const hits = scanPatterns(md);
    expect(hits[0].line).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts
```
Expected: FAIL — `Cannot find module '../lib/pattern-scanner'`

- [ ] **Step 3：实现 pattern-scanner.ts**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/lib/pattern-scanner.ts

export interface PatternHit {
  code: string;
  message: string;
  line: number;
}

interface RuleCtx {
  raw: string;
  bodyLines: string[]; // 去 frontmatter 后的行
  fmOffset: number; // body 起始对应原文的行号偏移
}

type Rule = (ctx: RuleCtx) => PatternHit[];

const RULES: Rule[] = [
  // 1) 开篇双极对仗："在那个X与Y交织的Z"等
  (ctx) => {
    const firstNonEmpty = ctx.bodyLines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmpty < 0) return [];
    const line = ctx.bodyLines[firstNonEmpty];
    if (/^在那个.{0,15}[与和].{0,15}交织的/.test(line)) {
      return [
        {
          code: "ARCHETYPE_OPENING_BIPOLAR",
          message: '开篇套路："在那个X与Y交织的Z"',
          line: ctx.fmOffset + firstNonEmpty + 1,
        },
      ];
    }
    return [];
  },
  // 2) 对话连续两段无归属
  (ctx) => {
    const hits: PatternHit[] = [];
    let prevWasAttribFreeDialog = false;
    for (let i = 0; i < ctx.bodyLines.length; i++) {
      const line = ctx.bodyLines[i].trim();
      const isDialog = /^["“].*["”]\s*$/.test(line);
      if (isDialog) {
        if (prevWasAttribFreeDialog) {
          hits.push({
            code: "DIALOG_ATTRIB_MISSING",
            message: "连续对话缺归属（说话人）",
            line: ctx.fmOffset + i + 1,
          });
          prevWasAttribFreeDialog = false;
        } else {
          prevWasAttribFreeDialog = true;
        }
      } else if (line.length > 0) {
        prevWasAttribFreeDialog = false;
      }
    }
    return hits;
  },
  // 3) 形容词命名情绪："感到 + N + 的 + 情绪名"
  (ctx) => {
    const hits: PatternHit[] = [];
    for (let i = 0; i < ctx.bodyLines.length; i++) {
      if (
        /感到.{0,8}(悸动|温暖|寒意|绝望|希望|喜悦|愤怒|悲伤|恐惧)/.test(
          ctx.bodyLines[i],
        )
      ) {
        hits.push({
          code: "TELL_NOT_SHOW_EMOTION",
          message: '"感到X的Y"式情绪命名',
          line: ctx.fmOffset + i + 1,
        });
      }
    }
    return hits;
  },
];

export function scanPatterns(chapterMd: string): PatternHit[] {
  const fmMatch = chapterMd.match(/^---\n[\s\S]*?\n---\n/);
  const fmOffset = fmMatch ? fmMatch[0].split("\n").length - 1 : 0;
  const body = fmMatch ? chapterMd.slice(fmMatch[0].length) : chapterMd;
  const ctx: RuleCtx = { raw: chapterMd, bodyLines: body.split("\n"), fmOffset };
  return RULES.flatMap((r) => r(ctx));
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts
```
Expected: PASS（4 tests pass）

> 若 ch-good.md 因"低声"等触发任何 hit，调整 fixture 而非规则——目标是规则严，fixture 干净。

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/scripts/lib/pattern-scanner.ts \
        .claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts
git commit -m "feat(novel): pattern-scanner for structural AI tells"
```

---

### Task 3.8：scene-marker-parser.ts —— 解析 SCENE 块（TDD）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/scripts/lib/scene-marker-parser.ts`
- Create: `.claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts`

**职责**：把章节中所有 `<!-- SCENE ... -->...<!-- /SCENE -->` 块解析为结构化 scene 列表，供 scene-illustrator 消费。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseScenes, type Scene } from "../lib/scene-marker-parser";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

describe("parseScenes", () => {
  it("解析 ch-good.md 的两个 SCENE", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const scenes = parseScenes(ch);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].title).toBe("苏醒");
    expect(scenes[0].location).toBe("北郊废墟");
    expect(scenes[0].mood).toBe("melancholy");
    expect(scenes[0].participants).toEqual(["林晚"]);
    expect(scenes[1].participants).toEqual(["林晚", "沈渊"]);
  });

  it("捕获正文（去除 SCENE 标记自身）", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const scenes = parseScenes(ch);
    expect(scenes[0].body).toContain("林晚醒来时");
    expect(scenes[0].body).not.toContain("<!-- SCENE");
  });

  it("非法 mood 报错", () => {
    const md = `<!-- SCENE: x | location: y | mood: superhappy | participants: A -->\n.\n<!-- /SCENE -->\n`;
    expect(() => parseScenes(md)).toThrow(/mood/);
  });

  it("缺 closing tag 报错", () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: A -->\nbody`;
    expect(() => parseScenes(md)).toThrow(/closing/);
  });

  it("participants=none 解析为空数组", () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: none -->\nbody\n<!-- /SCENE -->\n`;
    const scenes = parseScenes(md);
    expect(scenes[0].participants).toEqual([]);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts
```
Expected: FAIL — `Cannot find module '../lib/scene-marker-parser'`

- [ ] **Step 3：实现 scene-marker-parser.ts**

```typescript
// .claude/skills/novel-chapter-workshop/scripts/lib/scene-marker-parser.ts

export type Mood =
  | "calm" | "tense" | "ominous" | "melancholy" | "joyful" | "fearful"
  | "awe" | "defiant" | "tender" | "furious" | "lonely" | "mysterious";

const VALID_MOODS = new Set<Mood>([
  "calm", "tense", "ominous", "melancholy", "joyful", "fearful",
  "awe", "defiant", "tender", "furious", "lonely", "mysterious",
]);

export interface Scene {
  index: number; // 0-based 出现顺序
  title: string;
  location: string;
  mood: Mood;
  participants: string[];
  body: string; // 不含 SCENE 标记自身
  startLine: number; // 1-based，open tag 所在行
}

const OPEN = /<!--\s*SCENE:\s*([^|]+)\|\s*location:\s*([^|]+)\|\s*mood:\s*([^|]+)\|\s*participants:\s*([^-]+?)\s*-->/;
const CLOSE = /<!--\s*\/SCENE\s*-->/;

export function parseScenes(chapterMd: string): Scene[] {
  const lines = chapterMd.split("\n");
  const scenes: Scene[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(OPEN);
    if (!open) {
      i++;
      continue;
    }
    const startLine = i + 1;
    const title = open[1].trim();
    const location = open[2].trim();
    const mood = open[3].trim() as Mood;
    if (!VALID_MOODS.has(mood)) {
      throw new Error(`scene-marker-parser: 非法 mood "${mood}" at line ${startLine}`);
    }
    const partsRaw = open[4].trim();
    const participants =
      partsRaw === "none"
        ? []
        : partsRaw.split(",").map((s) => s.trim()).filter(Boolean);

    // 找 closing
    let j = i + 1;
    while (j < lines.length && !CLOSE.test(lines[j])) j++;
    if (j >= lines.length) {
      throw new Error(
        `scene-marker-parser: missing closing </SCENE--> for scene "${title}" at line ${startLine}`,
      );
    }
    const body = lines.slice(i + 1, j).join("\n").trim();
    scenes.push({
      index: scenes.length,
      title,
      location,
      mood,
      participants,
      body,
      startLine,
    });
    i = j + 1;
  }
  return scenes;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts
```
Expected: PASS（5 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/scripts/lib/scene-marker-parser.ts \
        .claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts
git commit -m "feat(novel): scene-marker-parser for inline SCENE blocks"
```

---

### Task 3.9：evaluate-chapter.ts —— CLI 总评（薄壳）

**Files:**
- Create: `.claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts`

**职责**：CLI 入口，串起 slop-scanner / pattern-scanner / scene-marker-parser，输出 `<chapter>.eval.json`。LLM judge 评分本阶段不做（在 SKILL.md 流程里由调用方 LLM 直接读结果出分），脚本只做 mechanical 部分。

- [ ] **Step 1：写实现**

```typescript
#!/usr/bin/env bun
// .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSlop } from "./lib/slop-scanner";
import { scanPatterns } from "./lib/pattern-scanner";
import { parseScenes } from "./lib/scene-marker-parser";

const { values } = parseArgs({
  options: {
    chapter: { type: "string" },
  },
  strict: true,
});

if (!values.chapter) {
  console.error("用法: --chapter <path/to/ch_NN.md>");
  process.exit(1);
}

const chapterPath = resolve(values.chapter);
const ch = await readFile(chapterPath, "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const antiSlop = await readFile(resolve(here, "../references/anti-slop-zh.md"), "utf8");

const slopHits = scanSlop(ch, antiSlop);
const patternHits = scanPatterns(ch);
let scenes;
let sceneError: string | null = null;
try {
  scenes = parseScenes(ch);
} catch (e) {
  sceneError = (e as Error).message;
  scenes = [];
}

const slopByTier = {
  1: slopHits.filter((h) => h.tier === 1).length,
  2: slopHits.filter((h) => h.tier === 2).length,
  3: slopHits.filter((h) => h.tier === 3).length,
};

const wordCount = ch
  .replace(/^---\n[\s\S]*?\n---\n/, "")
  .replace(/<!--[^]*?-->/g, "")
  .replace(/\s/g, "").length;

const passes =
  slopByTier[1] === 0 &&
  slopByTier[2] <= 3 &&
  patternHits.length === 0 &&
  sceneError === null &&
  scenes.length >= 2;

const report = {
  chapter_path: chapterPath,
  word_count: wordCount,
  scene_count: scenes.length,
  scene_error: sceneError,
  slop_hits: slopByTier,
  slop_detail: slopHits,
  pattern_hits: patternHits,
  mechanical_pass: passes,
  judge_pending: true, // LLM judge 由调用方完成
};

const outPath = chapterPath.replace(/\.md$/, ".eval.json");
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`✓ wrote ${outPath}  mechanical_pass=${passes}`);
if (!passes) process.exitCode = 2;
```

- [ ] **Step 2：本地烟雾测试**

Run（用 sloppy fixture 模拟一章）：
```bash
cp .claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-sloppy.md /tmp/ch_99.md
bun run .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts --chapter /tmp/ch_99.md
cat /tmp/ch_99.eval.json
```
Expected: `mechanical_pass=false`，eval.json 含 slop_hits + pattern_hits 列表，退出码 2。

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts
git commit -m "feat(novel): evaluate-chapter CLI (mechanical only)"
```

---

## Phase 4 — scene-illustrator（场景插图 + 角色一致性）

**目标**：把已有的 SCENE 块批量转成插图，强约束角色视觉一致性。Tier 1（锚定短语）+ Tier 2（image-to-image 用立绘做参考），并在每个 scene 出图后做一次 LLM 一致性 recheck（Tier 1.5）。

**Files (Phase 4 全景)**：
- Create: `.claude/skills/scene-illustrator/SKILL.md`
- Create: `.claude/skills/scene-illustrator/references/character-anchor-spec.md`
- Create: `.claude/skills/scene-illustrator/references/recheck-prompt.md`
- Create: `.claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts`
- Create: `.claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts`
- Create: `.claude/skills/scene-illustrator/scripts/lib/portrait-manager.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts`
- Create: `.claude/skills/scene-illustrator/scripts/illustrate-chapter.ts`

> 复用 Phase 0 扩展过的 `image-generation` skill（`--ref` 参数）。本 skill 不直接调 Azure，只通过 `bun run .claude/skills/image-generation/scripts/generate-image.ts` 子命令调用。

---

### Task 4.1：写 SKILL.md（插图工作坊主入口）

**Files:**
- Create: `.claude/skills/scene-illustrator/SKILL.md`

- [ ] **Step 1：写 SKILL.md**

```markdown
---
name: scene-illustrator
description: Use to generate consistent character illustrations for all SCENE blocks in a chapter (or a single scene). Reads style.md / characters.md / chapter Markdown; produces PNG files plus a per-scene metadata JSON. Always invoked by `illustrated-audio-novel-creator` after chapter-workshop finishes a chapter; can also be used standalone to retry one scene.
---

# Scene Illustrator

## When to invoke

- 章节文件已存在且 mechanical_pass=true
- 角色立绘（portraits）已存在；若不存在，本 skill 会先生成
- 不要在 SCENE 标记不齐的章节上跑（请先回 chapter-workshop 修订）

## Inputs

| 字段 | 来源 |
|---|---|
| `output_dir` | 项目目录 |
| `chapter_n` | 章节号 |
| `mode` | `all` \| `scene <i>` \| `portraits-only` |

## Outputs

```
<output_dir>/
├── portraits/
│   ├── <name>.png            # 立绘（每角色 1 张，1024×1024）
│   └── <name>.meta.json      # 该立绘的 prompt + anchor
├── illustrations/ch_<NN>/
│   ├── scene_01.png          # 场景图（默认 1024×1024）
│   ├── scene_01.meta.json    # { sceneIndex, prompt, refsUsed, recheck }
│   └── ...
└── state.json                # 更新 chapters[N].illustrations = <count>
```

## Process

### Phase A：portraits（每项目仅一次）

如果 `<output_dir>/portraits/` 不存在或角色未齐，对每个 character.appearance：

1. 读 `style.md` 的 `promptPrefix` + `negative` + `palette`
2. 读 `characters.md` 该角色的 `appearance` 字段（英文锚定短语）
3. 拼 prompt = `promptPrefix` + `, character portrait, ` + `appearance` + `, neutral background`
4. 调 image-generation：
   ```bash
   bun run .claude/skills/image-generation/scripts/generate-image.ts \
     --prompt "<prompt>" \
     --output <output_dir>/portraits/<name>.png \
     --size 1024x1024 \
     --quality high
   ```
5. 写 `<name>.meta.json`：`{ prompt, anchor: <appearance>, generatedAt }`

完成后**人工检查环节**（见主编排器 stage-flow.md）：用户确认立绘可用，再进入 Phase B。

### Phase B：scenes（每章一次，按 mode）

#### Step 1：解析章节 SCENE 块

```bash
bun run .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts \
  --output-dir <output_dir> --chapter <N> --mode all
```

脚本内部：
1. 调 `scene-marker-parser.parseScenes(ch.md)`
2. 对每个 scene，按 mode 过滤
3. 对每个待出图 scene：
   - 拼 prompt（见 scene-prompt-builder.ts）
   - 收集 refs：`scene.participants` 中每人的 portrait 路径
   - 调 image-generation，**首位 participant 的 portrait 作为 `--ref`**（image-to-image 锚定）
   - 落盘 PNG + meta.json

#### Step 2：一致性 recheck（Tier 1.5）

每张 scene 图生成后：
1. 读 `references/recheck-prompt.md`
2. 调 LLM（vision），输入：scene 图 + 该 scene 中每个 participant 的 portrait
3. 让 LLM 返回 `{ consistent: true|false, drift: ["头发颜色变了", ...] }`
4. 若 `consistent=false` 且 drift 涉及"颜色/发型/服饰主色"等强锚定特征 → 自动重生（最多 1 次）
5. 把 recheck 结果写入 `scene_NN.meta.json.recheck`

#### Step 3：更新 state

成功生成的张数写入 `state.json` 的 `chapters[N].illustrations`。  
若有 scene 重试一次仍 inconsistent → 写入 `state.debts`，但**不阻塞**主流程。

## Quality bar

- [ ] portraits 每个角色 1 张，且 prompt 中包含 appearance 锚定
- [ ] 每张 scene 图：refsUsed.length ≥ 1（除非 participants=none）
- [ ] recheck 通过率 ≥ 80%
- [ ] illustrations 总数 ≈ Σ scene_count（允许 ±10%）

## References

- `references/character-anchor-spec.md`
- `references/recheck-prompt.md`
- `../novel-foundation-builder/references/style-presets-novel.md`
- `../novel-chapter-workshop/references/scene-marker-spec.md`
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/scene-illustrator/SKILL.md
git commit -m "feat(novel): scene-illustrator SKILL.md (portraits + scenes + recheck)"
```

---

### Task 4.2：写 character-anchor-spec.md

**Files:**
- Create: `.claude/skills/scene-illustrator/references/character-anchor-spec.md`

- [ ] **Step 1：写文档**

````markdown
# Character Anchor Spec

定义"角色锚定短语"的写法与拼接规则。foundation-builder 写入 characters.md 的 `appearance` 字段必须遵守本规范，scene-illustrator 才能稳定出图。

## 锚定的目标

让同一个角色在不同场景图里**视觉特征不漂移**：发色 / 发型 / 服饰主色 / 显著特征（眼罩、刀疤、瞳色、配饰等）三选二保持稳定。

## 写法（英文短语，便于 image API）

```
<hair color + style>, <主要服饰 + 颜色>, <显著特征>
```

例：
- `long silver hair tied with red ribbon, dark green robe, milky-white blind eyes`
- `short black hair shaved at the sides, navy military coat, vertical scar across left eye`
- `wavy auburn hair, ivory linen dress, golden hairpin shaped like a phoenix`

## 必须

- 全英文（中文 appearance 在不同模型里漂移更剧烈）
- 三选二原则：颜色锚定 + 服饰锚定 + 特征锚定 至少满足两类
- 不超过 25 个 token（过长会稀释强约束词）

## 不要

- 不要写心理特征（"温柔"、"忧郁"）— 模型会改外貌去匹配
- 不要写镜头（"close-up"）— 那是 scene-prompt-builder 的事
- 不要写情绪（"smiling"）— 由场景描述决定

## 拼接规则（scene-prompt-builder 怎么用）

对一个 scene，最终 prompt 顺序：

```
<style.promptPrefix>,
<scene mood/composition descriptor>,
<participant_1 anchor>, <participant_2 anchor>, ...,
<scene body 摘要 → 英文动作描述>,
<style.negative>
```

第一个 participant 的 portrait 作为 `--ref` 传给 image-to-image API（强锚定）。  
其余 participant 仅靠文本锚定（弱锚定）—— 但配合 mood/composition 通常足够。
````

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/scene-illustrator/references/character-anchor-spec.md
git commit -m "docs(novel): character anchor spec for scene illustration consistency"
```

---

### Task 4.3：写 recheck-prompt.md

**Files:**
- Create: `.claude/skills/scene-illustrator/references/recheck-prompt.md`

- [ ] **Step 1：写文档**

```markdown
# Recheck Prompt（Tier 1.5 一致性回扫）

## 触发

每张 scene 图生成后调一次。**只看强锚定特征**——颜色、发型、服饰主色、显著特征。  
不要打表情或姿势的分（那是场景该决定的）。

## 输入装配

- 主图：`scene_NN.png`
- 参考图：scene 中每个 participant 的 `<name>.png` 立绘
- 文本：每个 participant 的 anchor 短语

## Prompt（送给 vision LLM）

```
你是一位插图编辑。检查一张场景插画里的角色与参考立绘是否在以下"强锚定特征"上一致：
- 发色 / 发型轮廓
- 主要服饰的颜色
- 显著特征（如刀疤、眼罩、瞳色、配饰）

不要评价表情、姿势、镜头、背景、画质。

对每个角色，输出 JSON：
{
  "name": "<角色名>",
  "consistent": true | false,
  "drift": ["发色由银变为金", "..."]   // 仅在 consistent=false 时填
}

最后输出 overall：
{
  "overall_consistent": <true 当且仅当所有角色都 consistent=true>,
  "needs_regen": <true 当 overall_consistent=false 且 drift 涉及主色/主特征>
}
```

## 决策

- `needs_regen=true` → scene-illustrator 自动重生（最多 1 次）。第二次仍失败 → 接受当前图，但写入 state.debts
- `needs_regen=false` 但 `overall_consistent=false` → 接受当前图（仅微调，不重生）
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/scene-illustrator/references/recheck-prompt.md
git commit -m "docs(novel): recheck prompt for visual consistency (Tier 1.5)"
```

---

### Task 4.4：anchor-builder.ts —— 从 characters.md 抽取角色锚定（TDD）

**Files:**
- Create: `.claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts`

**职责**：读 characters.md（已被 foundation-builder 校验过），输出 `Map<name, anchor>`，并校验每条 anchor 是否符合 `character-anchor-spec.md` 的"三选二"原则（颜色/服饰/特征）。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts
import { describe, it, expect } from "bun:test";
import { buildAnchors, validateAnchor } from "../lib/anchor-builder";

const goodChars = `---\ncount: 2\n---\n\n## 林晚\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: long silver hair tied with red ribbon, dark green robe, milky-white blind eyes\n- voice_profile: zh-CN-XiaoxiaoNeural\n\n## 沈渊\n- role: 导师\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: tall man with grey beard, faded blue robe, jade pendant\n- voice_profile: zh-CN-YunyangNeural\n`;

describe("buildAnchors", () => {
  it("从 characters.md 抽出 name → anchor", () => {
    const map = buildAnchors(goodChars);
    expect(map.get("林晚")).toContain("silver hair");
    expect(map.get("沈渊")).toContain("jade pendant");
  });

  it("含中文 appearance 时报错（必须英文）", () => {
    const md = goodChars.replace("long silver hair", "长长的银发");
    expect(() => buildAnchors(md)).toThrow(/英文/);
  });
});

describe("validateAnchor", () => {
  it("接受满足三选二的 anchor", () => {
    expect(() =>
      validateAnchor("long silver hair, dark green robe"),
    ).not.toThrow(); // 颜色 + 服饰 ≥ 2
  });

  it("仅 1 类锚定时报错", () => {
    expect(() => validateAnchor("a person")).toThrow(/三选二/);
  });

  it("超过 25 token 报错", () => {
    const long = Array(30).fill("word").join(" ");
    expect(() => validateAnchor(long)).toThrow(/token/);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts
```
Expected: FAIL — `Cannot find module '../lib/anchor-builder'`

- [ ] **Step 3：实现 anchor-builder.ts**

```typescript
// .claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts

const COLOR_HINTS = [
  "silver", "gold", "golden", "black", "white", "red", "blue", "green",
  "grey", "gray", "auburn", "blonde", "navy", "ivory", "scarlet",
  "violet", "purple", "amber", "pink", "brown", "crimson", "jade",
  "milky", "milky-white",
];
const GARMENT_HINTS = [
  "robe", "coat", "dress", "shirt", "armor", "cloak", "uniform",
  "tunic", "gown", "kimono", "hanfu", "vest", "jacket", "trousers",
];
const FEATURE_HINTS = [
  "scar", "ribbon", "pendant", "eye-patch", "eyepatch", "earring",
  "tattoo", "blind", "mask", "glasses", "hairpin", "horns", "fangs",
];

const CN_RE = /[一-鿿]/;

export function validateAnchor(anchor: string): void {
  if (CN_RE.test(anchor)) throw new Error(`anchor 必须英文，实际: "${anchor}"`);
  const tokens = anchor.split(/\s+/).filter(Boolean);
  if (tokens.length > 25)
    throw new Error(`anchor 超过 25 token (${tokens.length})`);
  const lower = anchor.toLowerCase();
  let categories = 0;
  if (COLOR_HINTS.some((c) => lower.includes(c))) categories++;
  if (GARMENT_HINTS.some((g) => lower.includes(g))) categories++;
  if (FEATURE_HINTS.some((f) => lower.includes(f))) categories++;
  if (categories < 2)
    throw new Error(
      `anchor 不满足"三选二"（颜色/服饰/特征），仅命中 ${categories} 类: "${anchor}"`,
    );
}

export function buildAnchors(charactersMd: string): Map<string, string> {
  const fmMatch = charactersMd.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? charactersMd.slice(fmMatch[0].length) : charactersMd;
  const blocks = body.split(/^## /m).slice(1);
  const map = new Map<string, string>();
  for (const block of blocks) {
    const lines = block.split("\n");
    const name = lines[0].trim();
    const appearance = lines
      .find((l) => /^- appearance:/.test(l))
      ?.replace(/^- appearance:\s*/, "")
      .trim();
    if (!appearance) throw new Error(`角色 "${name}" 缺 appearance`);
    validateAnchor(appearance);
    map.set(name, appearance);
  }
  return map;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts
```
Expected: PASS（5 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts \
        .claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts
git commit -m "feat(novel): anchor-builder for character visual anchors"
```

---

### Task 4.5：scene-prompt-builder.ts —— 拼接 scene 出图 prompt（TDD）

**Files:**
- Create: `.claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts`

**职责**：把 (scene, anchors, style) 三元组按 character-anchor-spec.md 的拼接顺序拼成最终 prompt。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
import { describe, it, expect } from "bun:test";
import {
  buildScenePrompt,
  type StyleInfo,
} from "../lib/scene-prompt-builder";
import type { Scene } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

const style: StyleInfo = {
  promptPrefix: "Webtoon-style anime illustration, soft cel shading",
  negative: "no watermark, no text, no signature",
};

const anchors = new Map<string, string>([
  ["林晚", "long silver hair tied with red ribbon, dark green robe, milky eyes"],
  ["沈渊", "tall man with grey beard, faded blue robe"],
]);

describe("buildScenePrompt", () => {
  it("style + mood + anchors + body 顺序正确", () => {
    const scene: Scene = {
      index: 0,
      title: "门后之物",
      location: "北郊废墟",
      mood: "tense",
      participants: ["林晚", "沈渊"],
      body: "林晚走入废墟，听见沈渊的低语。",
      startLine: 5,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(prompt.startsWith("Webtoon-style anime illustration")).toBe(true);
    expect(prompt).toContain("tense atmosphere");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("grey beard");
    expect(prompt.endsWith("no watermark, no text, no signature")).toBe(true);
    expect(refPath).toBe("/tmp/portraits/林晚.png");
  });

  it("participants=[] 时无 ref", () => {
    const scene: Scene = {
      index: 0,
      title: "废墟",
      location: "北郊废墟",
      mood: "lonely",
      participants: [],
      body: "雪落在断墙上。",
      startLine: 1,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(refPath).toBeNull();
    expect(prompt).toContain("lonely atmosphere");
    expect(prompt).not.toContain("silver hair");
  });

  it("未知 participant 报错", () => {
    const scene: Scene = {
      index: 0,
      title: "x",
      location: "y",
      mood: "calm",
      participants: ["路人甲"],
      body: "x",
      startLine: 1,
    };
    expect(() =>
      buildScenePrompt(scene, anchors, style, { portraitsDir: "/tmp/portraits" }),
    ).toThrow(/路人甲/);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
```
Expected: FAIL — `Cannot find module '../lib/scene-prompt-builder'`

- [ ] **Step 3：实现 scene-prompt-builder.ts**

```typescript
// .claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts

import { join } from "node:path";
import type { Scene, Mood } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

export interface StyleInfo {
  promptPrefix: string;
  negative: string;
}

export interface BuildOpts {
  portraitsDir: string;
}

export interface BuildResult {
  prompt: string;
  refPath: string | null; // 第一个 participant 的立绘路径
}

const MOOD_DESCRIPTOR: Record<Mood, string> = {
  calm: "calm atmosphere, soft natural light",
  tense: "tense atmosphere, harsh contrast lighting",
  ominous: "ominous atmosphere, deep shadows, low key light",
  melancholy: "melancholy atmosphere, muted tones, overcast light",
  joyful: "joyful atmosphere, warm sunlight, bright palette",
  fearful: "fearful atmosphere, sharp shadows, off-center composition",
  awe: "awe-inspiring atmosphere, vast scale, golden hour light",
  defiant: "defiant atmosphere, strong silhouette, backlight",
  tender: "tender atmosphere, soft warm light, intimate framing",
  furious: "furious atmosphere, dynamic motion blur, red accents",
  lonely: "lonely atmosphere, wide empty space, cold palette",
  mysterious: "mysterious atmosphere, fog, partial silhouette",
};

function describeBody(body: string): string {
  // 极简：截前 80 字 → 让模型当场景动作描述
  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80) + "…" : cleaned;
}

export function buildScenePrompt(
  scene: Scene,
  anchors: Map<string, string>,
  style: StyleInfo,
  opts: BuildOpts,
): BuildResult {
  const parts: string[] = [];
  parts.push(style.promptPrefix);
  parts.push(MOOD_DESCRIPTOR[scene.mood]);

  const anchorParts: string[] = [];
  for (const name of scene.participants) {
    const a = anchors.get(name);
    if (!a) throw new Error(`参与者 "${name}" 不在 characters.md 锚定表中`);
    anchorParts.push(a);
  }
  if (anchorParts.length) parts.push(anchorParts.join("; "));
  parts.push(describeBody(scene.body));
  parts.push(style.negative);

  const prompt = parts.filter(Boolean).join(", ");
  const refPath = scene.participants.length
    ? join(opts.portraitsDir, `${scene.participants[0]}.png`)
    : null;
  return { prompt, refPath };
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
```
Expected: PASS（3 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts \
        .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
git commit -m "feat(novel): scene-prompt-builder for illustration prompts"
```

---

### Task 4.6：portrait-manager.ts —— 立绘存在性检查 + 缺漏列表（TDD）

**Files:**
- Create: `.claude/skills/scene-illustrator/scripts/lib/portrait-manager.ts`
- Create: `.claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts`

**职责**：给定 anchor map + portraits 目录，返回 `{ existing: [...], missing: [...] }`。供 illustrate-chapter.ts 决定是否要先跑 portraits Phase。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { audit } from "../lib/portrait-manager";

const TMP = "/tmp/scene-illustrator-test-portraits";

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
});
afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("audit", () => {
  it("两人有立绘、一人没有 → existing=2, missing=1", async () => {
    await writeFile(join(TMP, "林晚.png"), Buffer.from([0]));
    await writeFile(join(TMP, "沈渊.png"), Buffer.from([0]));
    const anchors = new Map<string, string>([
      ["林晚", "x"],
      ["沈渊", "y"],
      ["周泽", "z"],
    ]);
    const r = await audit(anchors, TMP);
    expect(r.existing).toEqual(["林晚", "沈渊"]);
    expect(r.missing).toEqual(["周泽"]);
  });

  it("空目录 → 全部 missing", async () => {
    const anchors = new Map<string, string>([
      ["A", "x"],
      ["B", "y"],
    ]);
    const r = await audit(anchors, TMP);
    expect(r.missing).toEqual(["A", "B"]);
    expect(r.existing).toEqual([]);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts
```
Expected: FAIL — `Cannot find module '../lib/portrait-manager'`

- [ ] **Step 3：实现 portrait-manager.ts**

```typescript
// .claude/skills/scene-illustrator/scripts/lib/portrait-manager.ts

import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface AuditResult {
  existing: string[];
  missing: string[];
}

export async function audit(
  anchors: Map<string, string>,
  portraitsDir: string,
): Promise<AuditResult> {
  const existing: string[] = [];
  const missing: string[] = [];
  for (const name of anchors.keys()) {
    const path = join(portraitsDir, `${name}.png`);
    try {
      const s = await stat(path);
      if (s.isFile() && s.size > 0) existing.push(name);
      else missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { existing, missing };
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts
```
Expected: PASS（2 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/lib/portrait-manager.ts \
        .claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts
git commit -m "feat(novel): portrait-manager audit (existing/missing)"
```

---

### Task 4.7：illustrate-chapter.ts —— CLI 总编排（薄壳）

**Files:**
- Create: `.claude/skills/scene-illustrator/scripts/illustrate-chapter.ts`

**职责**：CLI 串起 portraits / scenes 两阶段。**不做 LLM recheck**——recheck 由调用方 LLM（主编排器）负责（脚本只能用 vision 调 LLM 才行，过于复杂；让 LLM 看图判断更直接）。脚本写出 `meta.json` 占位 `recheck: null`，由主编排器后填。

- [ ] **Step 1：写实现**

```typescript
#!/usr/bin/env bun
// .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildAnchors } from "./lib/anchor-builder";
import { buildScenePrompt, type StyleInfo } from "./lib/scene-prompt-builder";
import { audit } from "./lib/portrait-manager";
import { parseScenes } from "../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    chapter: { type: "string" },
    mode: { type: "string", default: "all" }, // all | portraits-only | scene
    "scene-index": { type: "string" }, // mode=scene 时必填
  },
  strict: true,
});

if (!values["output-dir"]) {
  console.error("用法: --output-dir <dir> [--chapter N] [--mode all|portraits-only|scene --scene-index I]");
  process.exit(1);
}
const outputDir = resolve(values["output-dir"]!);
const mode = values.mode!;

// 1. 读 characters.md / style.md
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const styleMd = await readFile(join(outputDir, "style.md"), "utf8");
const anchors = buildAnchors(charactersMd);

function extractField(md: string, header: string): string {
  const re = new RegExp(`#\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`);
  return md.match(re)?.[1].trim() ?? "";
}
const style: StyleInfo = {
  promptPrefix: extractField(styleMd, "promptPrefix"),
  negative: extractField(styleMd, "negative"),
};

// 2. portraits Phase
const portraitsDir = join(outputDir, "portraits");
await mkdir(portraitsDir, { recursive: true });
const portraitAudit = await audit(anchors, portraitsDir);

async function runImageGen(args: string[]): Promise<void> {
  await new Promise<void>((res, rej) => {
    const cp = spawn("bun", ["run", ".claude/skills/image-generation/scripts/generate-image.ts", ...args], {
      stdio: "inherit",
    });
    cp.on("exit", (code) => (code === 0 ? res() : rej(new Error(`image-gen exit ${code}`))));
  });
}

for (const name of portraitAudit.missing) {
  const anchor = anchors.get(name)!;
  const prompt = `${style.promptPrefix}, character portrait, ${anchor}, neutral background, ${style.negative}`;
  const out = join(portraitsDir, `${name}.png`);
  await runImageGen(["--prompt", prompt, "--output", out, "--size", "1024x1024", "--quality", "high"]);
  await writeFile(
    join(portraitsDir, `${name}.meta.json`),
    JSON.stringify({ name, prompt, anchor, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`✓ portrait: ${name}`);
}

if (mode === "portraits-only") {
  console.log("portraits-only 完成。");
  process.exit(0);
}

// 3. scenes Phase
if (!values.chapter) {
  console.error("--chapter 必填（除非 mode=portraits-only）");
  process.exit(1);
}
const chapterN = parseInt(values.chapter, 10);
const chapterPath = join(outputDir, "chapters", `ch_${String(chapterN).padStart(2, "0")}.md`);
const chapterMd = await readFile(chapterPath, "utf8");
const scenes = parseScenes(chapterMd);

const targetScenes = mode === "scene"
  ? [scenes[parseInt(values["scene-index"]!, 10)]]
  : scenes;

const illustrationsDir = join(outputDir, "illustrations", `ch_${String(chapterN).padStart(2, "0")}`);
await mkdir(illustrationsDir, { recursive: true });

for (const scene of targetScenes) {
  if (!scene) continue;
  const { prompt, refPath } = buildScenePrompt(scene, anchors, style, { portraitsDir });
  const sceneIdx = String(scene.index + 1).padStart(2, "0");
  const out = join(illustrationsDir, `scene_${sceneIdx}.png`);
  const args = ["--prompt", prompt, "--output", out, "--size", "1024x1024", "--quality", "high"];
  if (refPath) args.push("--ref", refPath);
  await runImageGen(args);
  await writeFile(
    join(illustrationsDir, `scene_${sceneIdx}.meta.json`),
    JSON.stringify(
      {
        sceneIndex: scene.index,
        title: scene.title,
        mood: scene.mood,
        participants: scene.participants,
        prompt,
        refUsed: refPath,
        recheck: null, // 由主编排器后填
      },
      null,
      2,
    ),
  );
  console.log(`✓ scene ${sceneIdx}: ${scene.title}`);
}

console.log(`done. chapter ${chapterN} → ${illustrationsDir}`);
```

- [ ] **Step 2：本地烟雾测试（需 AZURE_API_KEY，可手动跳过）**

Run（需要预先准备一个迷你 output_dir）：
```bash
bun run .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts \
  --output-dir tmp-novel --chapter 1 --mode all
```
Expected: 看到 `✓ portrait: ...` 与 `✓ scene 01: ...`，文件落盘到 portraits/ 与 illustrations/ch_01/。

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts
git commit -m "feat(novel): illustrate-chapter CLI (portraits + scenes)"
```

---

## Phase 5 — audio-novel-packager（多 voice TTS + Reflowable EPUB3 + 句级高亮）

**目标**：把 `chapters/ch_NN.md` + `illustrations/ch_NN/*.png` + `portraits/*.png` 打包成：
- 一个 Reflowable EPUB3（含 Media Overlays / SMIL 句级高亮）
- 每章一个 MP3
- 一份归档 Markdown（合并所有章节，含图片引用）

**Files (Phase 5 全景)**：
- Create: `.claude/skills/audio-novel-packager/SKILL.md`
- Create: `.claude/skills/audio-novel-packager/references/voice-mapping.md`
- Create: `.claude/skills/audio-novel-packager/scripts/lib/chapter-splitter.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/lib/voice-resolver.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/lib/epub3-builder.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/package-novel.ts`

> 复用 `.claude/skills/audio-picture-book-creator/scripts/lib/{smil-builder,opf-builder}.ts`（已实现 SMIL/OPF 两个核心 builder）。本 skill 自己实现 chapter 切句 + voice 解析 + EPUB 打包。

---

### Task 5.1：写 SKILL.md（packager 主入口）

**Files:**
- Create: `.claude/skills/audio-novel-packager/SKILL.md`

- [ ] **Step 1：写 SKILL.md**

```markdown
---
name: audio-novel-packager
description: Use to package finished novel chapters + illustrations into a Reflowable EPUB3 (with sentence-level Media Overlays), per-chapter MP3 files, and a unified archive Markdown. Always invoked by `illustrated-audio-novel-creator` as the final stage; can also be used standalone if all chapters and illustrations are ready.
---

# Audio Novel Packager

## When to invoke

- 所有章节 mechanical_pass=true 且 status=ready
- 所有章节的 illustrations/ch_NN/ 已生成（允许少量 debt）
- portraits/ 完整
- 不要在 foundation/drafting 阶段调用

## Inputs

| 字段 | 来源 |
|---|---|
| `output_dir` | 项目目录 |
| `chapters?` | 限定章节范围（可选，默认全部） |
| `output_basename?` | 默认从 state.json.project 取 |

## Outputs

```
<output_dir>/
├── audio/
│   ├── ch_01.mp3
│   └── ch_NN.mp3
├── dist/
│   ├── <basename>.epub        # Reflowable EPUB3 + Media Overlays
│   └── <basename>.md          # 归档 Markdown（含图片相对引用）
└── state.json                 # phase=packaged
```

## Process

### Step 1：组装 voice 映射

读 `characters.md`（每个角色已有 voice_profile）+ `references/voice-mapping.md` 的"特例规则"。  
旁白 voice 取 narrator 池第一项。结果写入临时 `voice-resolved.json`。

### Step 2：按章切句 + 归属

调用：
```bash
bun run .claude/skills/audio-novel-packager/scripts/package-novel.ts \
  --output-dir <output_dir> --stage tts
```

脚本内部对每章：
1. `parseScenes(ch.md)` → 取每个 scene 的 body
2. `chapter-splitter.splitToSentences(body)` → 按中文标点切句，每句保留 `{ text, speaker }`
3. 说话人识别规则（按优先级）：
   - 直接对话："X说"/"X道"/"X低声" 等显式归属 → speaker = X
   - 当前 SCENE 的 participants 中只有 1 人 → 该人为 speaker
   - 否则 speaker = "narrator"
4. 把切句结果存为 `chapters/ch_NN.split.json`

### Step 3：生成音频（每章一个 MP3）

对每章：
1. 调 `text-to-speech` skill，按句循环：每句生成单声道 MP3 片段，记录每句 `{ start, dur }`
2. 用 `ffmpeg` 拼接片段 → `audio/ch_NN.mp3`
3. 写 `chapters/ch_NN.timing.json`：`[{ idx, text, speaker, start, dur }, ...]`

> text-to-speech 已支持 `--voice`，无需修改其 SKILL。仅按上面 voice-resolved.json 的映射循环调用。

### Step 4：构建 EPUB3 + Media Overlays

调用：
```bash
bun run .claude/skills/audio-novel-packager/scripts/package-novel.ts \
  --output-dir <output_dir> --stage epub
```

脚本内部：
1. 对每章：把 ch_NN.md 转 XHTML，每句包一个 `<span id="s_NN_M">…</span>`，scene 间插入插图 `<figure><img src=".../scene_KK.png"/></figure>`
2. 对每章：用 `chapters/ch_NN.timing.json` + 已有的 `audio-picture-book-creator/scripts/lib/smil-builder.ts` 生成 `audio/ch_NN.smil`
3. 用 `audio-picture-book-creator/scripts/lib/opf-builder.ts` 生成 OPF（manifest + spine + media-overlay 关联）
4. 用 jszip 打包：`mimetype` 必须为 store（不压缩）+ META-INF/container.xml + OEBPS/{...}
5. 落盘 `dist/<basename>.epub`

### Step 5：写归档 Markdown 与更新 state

```bash
bun run .claude/skills/audio-novel-packager/scripts/package-novel.ts \
  --output-dir <output_dir> --stage archive
```

合并所有 chapters → `dist/<basename>.md`，保留 SCENE 标记并把图替换为相对路径。  
state.json.phase = "packaged"。

## Quality bar

- [ ] EPUB 通过 epubcheck 基本结构（无 fatal）
- [ ] 每章 MP3 时长与 timing.json 总和差距 < 1s
- [ ] 句级高亮在阅读器（如 Thorium）实测可用
- [ ] 归档 Markdown 中图片路径全部相对 dist/
- [ ] state.json.phase=packaged

## References

- `references/voice-mapping.md`
- `../audio-picture-book-creator/scripts/lib/smil-builder.ts`（复用）
- `../audio-picture-book-creator/scripts/lib/opf-builder.ts`（复用）
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/audio-novel-packager/SKILL.md
git commit -m "feat(novel): audio-novel-packager SKILL.md (TTS + EPUB3 + archive)"
```

---

### Task 5.2：写 voice-mapping.md

**Files:**
- Create: `.claude/skills/audio-novel-packager/references/voice-mapping.md`

- [ ] **Step 1：写文档**

```markdown
# Voice Mapping Rules

定义如何把"说话人名字"解析成实际的 edge-tts voice id。绝大多数情况下读 characters.md 的 voice_profile 就够；本文档处理几个特例。

## 解析顺序

1. **narrator**（旁白）→ 取 `edge-tts-voice-catalog.md` 中"旁白"池第一项（默认 zh-CN-YunyangNeural）
2. **角色名命中 characters.md** → 该角色的 `voice_profile`
3. **角色名未命中**（如 outline 临时引入但未列进 characters.md 的过场角色）→ 退回 narrator
4. **群声**（"众人"、"商人们"）→ 退回 narrator，文本前加 "(群)" 提示音色无差别处理（v2 再做）

## 特例：同名歧义

如果有两个角色同名（不应该，foundation-builder 应已挡住），按 `characters.md` 中**先出现**的为准。

## 旁注与非对白

非对白叙述（包括场景描写、心理活动）一律用 narrator voice，**即使该段写的是某角色的内心**。  
理由：内心独白若用角色 voice 容易让听者误以为是对话。

## 调试钩子

`package-novel.ts` 在 `--stage tts` 阶段会落盘 `<output_dir>/voice-resolved.json`，把每个 chapter 每句的 `{idx, speaker, voice}` 列出，便于人工抽查。
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/audio-novel-packager/references/voice-mapping.md
git commit -m "docs(novel): voice mapping rules for packager"
```

---

### Task 5.3：chapter-splitter.ts —— 章节正文 → 句子 + speaker（TDD）

**Files:**
- Create: `.claude/skills/audio-novel-packager/scripts/lib/chapter-splitter.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts`

**职责**：输入一个 SCENE 的 body 文本 + participants，输出 `Sentence[]`，每条含 `{ idx, text, speaker }`。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts
import { describe, it, expect } from "bun:test";
import { splitToSentences, type Sentence } from "../lib/chapter-splitter";

describe("splitToSentences", () => {
  it("按中文句末标点切句", () => {
    const text = "天黑了。她抬起头。\"我来了？\"她问。";
    const out = splitToSentences(text, ["林晚"]);
    expect(out.map((s) => s.text)).toEqual([
      "天黑了。",
      "她抬起头。",
      "\"我来了？\"她问。",
    ]);
  });

  it("显式归属：'林晚说'", () => {
    const text = "\"我累了。\"林晚说。\"我也是。\"沈渊低声。";
    const out = splitToSentences(text, ["林晚", "沈渊"]);
    expect(out[0].speaker).toBe("林晚");
    expect(out[1].speaker).toBe("沈渊");
  });

  it("participants 仅 1 人时，对话归属于该人", () => {
    const text = "\"我可以走了吗？\"她又问了一遍。";
    const out = splitToSentences(text, ["林晚"]);
    expect(out[0].speaker).toBe("林晚");
  });

  it("无对话或多人歧义 → narrator", () => {
    const text = "雪落了一夜。山路湿滑。";
    const out = splitToSentences(text, ["林晚", "沈渊"]);
    expect(out.every((s) => s.speaker === "narrator")).toBe(true);
  });

  it("idx 从 0 开始连续编号", () => {
    const out = splitToSentences("一。二。三。", []);
    expect(out.map((s) => s.idx)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts
```
Expected: FAIL — `Cannot find module '../lib/chapter-splitter'`

- [ ] **Step 3：实现 chapter-splitter.ts**

```typescript
// .claude/skills/audio-novel-packager/scripts/lib/chapter-splitter.ts

export interface Sentence {
  idx: number;
  text: string;
  speaker: string; // "narrator" 或角色名
}

const SENT_END = /[。！？!?…]+["”]?/g;

function splitChinese(text: string): string[] {
  const sentences: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(SENT_END.source, "g");
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const piece = text.slice(last, end).trim();
    if (piece) sentences.push(piece);
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function detectExplicitSpeaker(
  sentence: string,
  participants: string[],
): string | null {
  // "X说" / "X道" / "X低声" / "X问" / "X答" / "X喊"
  for (const name of participants) {
    const re = new RegExp(`${name}(说|道|低声|问|答|喊|笑|叹|怒|喝|呢喃|低吼)`);
    if (re.test(sentence)) return name;
  }
  return null;
}

function isDialog(sentence: string): boolean {
  return /["“][^"”]*["”]/.test(sentence);
}

export function splitToSentences(
  body: string,
  participants: string[],
): Sentence[] {
  const raw = splitChinese(body);
  return raw.map((text, idx) => {
    let speaker = "narrator";
    const explicit = detectExplicitSpeaker(text, participants);
    if (explicit) speaker = explicit;
    else if (isDialog(text) && participants.length === 1) speaker = participants[0];
    return { idx, text, speaker };
  });
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts
```
Expected: PASS（5 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/audio-novel-packager/scripts/lib/chapter-splitter.ts \
        .claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts
git commit -m "feat(novel): chapter-splitter (sentence + speaker)"
```

---

### Task 5.4：voice-resolver.ts —— speaker → voice id（TDD）

**Files:**
- Create: `.claude/skills/audio-novel-packager/scripts/lib/voice-resolver.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts`

**职责**：实现 voice-mapping.md 的解析顺序。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts
import { describe, it, expect } from "bun:test";
import { resolveVoice, type CharacterVoice } from "../lib/voice-resolver";

const characters: CharacterVoice[] = [
  { name: "林晚", voice: "zh-CN-XiaoxiaoNeural" },
  { name: "沈渊", voice: "zh-CN-YunyangNeural" },
];
const narratorVoice = "zh-CN-YunyangNeural";

describe("resolveVoice", () => {
  it("narrator 命中 narrator voice", () => {
    expect(resolveVoice("narrator", characters, narratorVoice)).toBe(narratorVoice);
  });
  it("已知角色命中其 voice", () => {
    expect(resolveVoice("林晚", characters, narratorVoice)).toBe("zh-CN-XiaoxiaoNeural");
  });
  it("未知角色 → narrator voice", () => {
    expect(resolveVoice("过路人", characters, narratorVoice)).toBe(narratorVoice);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts
```
Expected: FAIL

- [ ] **Step 3：实现 voice-resolver.ts**

```typescript
// .claude/skills/audio-novel-packager/scripts/lib/voice-resolver.ts

export interface CharacterVoice {
  name: string;
  voice: string;
}

export function resolveVoice(
  speaker: string,
  characters: CharacterVoice[],
  narratorVoice: string,
): string {
  if (speaker === "narrator") return narratorVoice;
  const hit = characters.find((c) => c.name === speaker);
  return hit ? hit.voice : narratorVoice;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts
```
Expected: PASS（3 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/audio-novel-packager/scripts/lib/voice-resolver.ts \
        .claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts
git commit -m "feat(novel): voice-resolver (speaker → voice id)"
```

---

### Task 5.5：epub3-builder.ts —— XHTML + EPUB 打包（TDD）

**Files:**
- Create: `.claude/skills/audio-novel-packager/scripts/lib/epub3-builder.ts`
- Create: `.claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts`

**职责**：(1) 把章节转成 XHTML（每句包 `<span id="s_NN_M">…</span>`，scene 间插图）；(2) 用 jszip 写 EPUB（mimetype store + container.xml + OEBPS）。SMIL 与 OPF 调用 `audio-picture-book-creator` 已有 builder。

> 测试只覆盖 (1) XHTML 生成 + (2) zip 内最关键 entry（mimetype 必须为 store/未压缩）。完整 EPUB 互操作测试放到 Phase 7 集成。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts
import { describe, it, expect } from "bun:test";
import { renderChapterXhtml, packEpub } from "../lib/epub3-builder";
import JSZip from "jszip";

describe("renderChapterXhtml", () => {
  it("每句包 span，含 chapter+sentence id", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 1,
      title: "灰雪",
      scenes: [
        {
          sentences: [
            { idx: 0, text: "天黑了。", speaker: "narrator" },
            { idx: 1, text: "她抬起头。", speaker: "narrator" },
          ],
          illustration: null,
        },
      ],
    });
    expect(xhtml).toContain('<span id="s_01_000">天黑了。</span>');
    expect(xhtml).toContain('<span id="s_01_001">她抬起头。</span>');
    expect(xhtml).toContain("<title>灰雪</title>");
  });

  it("scene 之间插入 figure", () => {
    const xhtml = renderChapterXhtml({
      chapterIndex: 2,
      title: "门后",
      scenes: [
        {
          sentences: [{ idx: 0, text: "雪。", speaker: "narrator" }],
          illustration: { src: "../illustrations/ch_02/scene_01.png", alt: "废墟" },
        },
      ],
    });
    expect(xhtml).toContain('<figure><img src="../illustrations/ch_02/scene_01.png" alt="废墟"/></figure>');
  });
});

describe("packEpub", () => {
  it("mimetype 是 zip 的第一个 entry 且未压缩", async () => {
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [],
    });
    const z = await JSZip.loadAsync(buf);
    const mimetypeFile = z.file("mimetype");
    expect(mimetypeFile).not.toBeNull();
    const text = await mimetypeFile!.async("text");
    expect(text).toBe("application/epub+zip");
  });

  it("含 META-INF/container.xml 指向 OEBPS/content.opf", async () => {
    const buf = await packEpub({
      basename: "test",
      manifest: [],
      spine: [],
      extraFiles: [],
    });
    const z = await JSZip.loadAsync(buf);
    const container = await z.file("META-INF/container.xml")!.async("text");
    expect(container).toContain('full-path="OEBPS/content.opf"');
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts
```
Expected: FAIL — `Cannot find module '../lib/epub3-builder'`

- [ ] **Step 3：实现 epub3-builder.ts**

```typescript
// .claude/skills/audio-novel-packager/scripts/lib/epub3-builder.ts

import JSZip from "jszip";
import type { Sentence } from "./chapter-splitter";

export interface SceneRender {
  sentences: Sentence[];
  illustration: { src: string; alt: string } | null;
}

export interface ChapterRenderInput {
  chapterIndex: number;
  title: string;
  scenes: SceneRender[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

export function renderChapterXhtml(input: ChapterRenderInput): string {
  const chId = pad2(input.chapterIndex);
  const blocks: string[] = [];
  let globalIdx = 0;
  for (const scene of input.scenes) {
    if (scene.illustration) {
      blocks.push(
        `<figure><img src="${scene.illustration.src}" alt="${scene.illustration.alt}"/></figure>`,
      );
    }
    const paragraphs: string[] = [];
    for (const s of scene.sentences) {
      paragraphs.push(`<span id="s_${chId}_${pad3(globalIdx)}">${escapeXml(s.text)}</span>`);
      globalIdx++;
    }
    blocks.push(`<p>${paragraphs.join("")}</p>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(input.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/novel.css"/>
</head>
<body>
  <h1>${escapeXml(input.title)}</h1>
  ${blocks.join("\n  ")}
</body>
</html>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PackEpubInput {
  basename: string;
  manifest: Array<{ id: string; href: string; mediaType: string; mediaOverlay?: string; properties?: string }>;
  spine: string[]; // idref order
  extraFiles: Array<{ path: string; data: string | Buffer }>; // 例如 OPS/chapters/*.xhtml, *.smil, audio/*
  opfXml?: string;
  navXhtml?: string;
}

export async function packEpub(input: PackEpubInput): Promise<Buffer> {
  const z = new JSZip();

  // 1. mimetype 必须第一个 entry，store（不压缩）
  z.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. container.xml
  z.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3. content.opf（如果调用方没传则给一个 stub，集成时由 opf-builder 填）
  z.file("OEBPS/content.opf", input.opfXml ?? stubOpf(input));

  // 4. nav.xhtml（如果有）
  if (input.navXhtml) z.file("OEBPS/nav.xhtml", input.navXhtml);

  // 5. extra files
  for (const f of input.extraFiles) {
    z.file(`OEBPS/${f.path}`, f.data);
  }

  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function stubOpf(input: PackEpubInput): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${input.basename}</dc:identifier>
    <dc:title>${input.basename}</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    ${input.manifest.map((m) => `<item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${m.mediaOverlay ? ` media-overlay="${m.mediaOverlay}"` : ""}${m.properties ? ` properties="${m.properties}"` : ""}/>`).join("\n    ")}
  </manifest>
  <spine>
    ${input.spine.map((id) => `<itemref idref="${id}"/>`).join("\n    ")}
  </spine>
</package>`;
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts
```
Expected: PASS（4 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/audio-novel-packager/scripts/lib/epub3-builder.ts \
        .claude/skills/audio-novel-packager/scripts/test/epub3-builder.test.ts
git commit -m "feat(novel): epub3-builder (xhtml render + zip pack)"
```

---

### Task 5.6：package-novel.ts —— CLI 总编排（薄壳）

**Files:**
- Create: `.claude/skills/audio-novel-packager/scripts/package-novel.ts`

**职责**：CLI 三阶段（tts / epub / archive），串起前面的 lib + 复用 audio-picture-book-creator 的 SMIL/OPF builder。

> **注意**：下面实现里 `buildSmil` / `buildOpf` 的参数名是按本 plan 拟定的形状写的。**实现本 task 之前**先 `Read` 这两个文件，按它们的真实导出签名调整调用形状（参数名 / 返回类型可能略有差异）。如果差异大到难以适配，允许：(a) 在 epub3-builder.ts 里再封一层 adapter，(b) 不改动 audio-picture-book-creator 任何文件。

- [ ] **Step 0：核对复用 builder 真实签名**

Run:
```bash
cat .claude/skills/audio-picture-book-creator/scripts/lib/smil-builder.ts
cat .claude/skills/audio-picture-book-creator/scripts/lib/opf-builder.ts
```
若导出名 / 参数形状与本 task 的 import 不一致 → 在 package-novel.ts 内做最小 adapter（不要改 audio-picture-book-creator）。

- [ ] **Step 1：写实现**

```typescript
#!/usr/bin/env bun
// .claude/skills/audio-novel-packager/scripts/package-novel.ts

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { parseScenes } from "../../novel-chapter-workshop/scripts/lib/scene-marker-parser";
import { splitToSentences, type Sentence } from "./lib/chapter-splitter";
import { resolveVoice, type CharacterVoice } from "./lib/voice-resolver";
import { renderChapterXhtml, packEpub, type SceneRender } from "./lib/epub3-builder";
// 复用 audio-picture-book-creator 的 builder
import { buildSmil } from "../../audio-picture-book-creator/scripts/lib/smil-builder";
import { buildOpf } from "../../audio-picture-book-creator/scripts/lib/opf-builder";

const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    stage: { type: "string" }, // tts | epub | archive | all
    basename: { type: "string" },
  },
  strict: true,
});
if (!values["output-dir"] || !values.stage) {
  console.error("用法: --output-dir <dir> --stage tts|epub|archive|all");
  process.exit(1);
}

const outputDir = resolve(values["output-dir"]!);
const state = JSON.parse(await readFile(join(outputDir, "state.json"), "utf8"));
const proj = values.basename ?? state.project;

// === 公共：读 characters + narrator voice ===
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const charBlocks = charactersMd.split(/^## /m).slice(1);
const characters: CharacterVoice[] = charBlocks.map((b) => {
  const name = b.split("\n")[0].trim();
  const voice =
    b.match(/voice_profile:\s*([\w-]+)/)?.[1] ?? "zh-CN-YunyangNeural";
  return { name, voice };
});
const NARRATOR_VOICE = characters.find((c) => c.name === "旁白")?.voice ?? "zh-CN-YunyangNeural";

// === stage = tts ===
async function runTts(): Promise<void> {
  const chaptersDir = join(outputDir, "chapters");
  const audioDir = join(outputDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const files = (await readdir(chaptersDir)).filter((f) => /^ch_\d+\.md$/.test(f)).sort();
  const resolvedAll: Record<string, Array<{ idx: number; speaker: string; voice: string; text: string }>> = {};

  for (const file of files) {
    const chN = parseInt(file.match(/^ch_(\d+)\.md$/)![1], 10);
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

    // 逐句 TTS（调 text-to-speech skill）
    const fragmentsDir = join(audioDir, `_frag_ch_${String(chN).padStart(2, "0")}`);
    await mkdir(fragmentsDir, { recursive: true });
    const timing: Array<{ idx: number; text: string; speaker: string; start: number; dur: number }> = [];
    let cursor = 0;
    for (const s of resolved) {
      const out = join(fragmentsDir, `${String(s.idx).padStart(4, "0")}.mp3`);
      await spawnP("bun", ["run", ".claude/skills/text-to-speech/scripts/synthesize.ts", "--text", s.text, "--voice", s.voice, "--output", out]);
      const dur = await ffprobeDuration(out);
      timing.push({ idx: s.idx, text: s.text, speaker: s.speaker, start: cursor, dur });
      cursor += dur;
    }
    // ffmpeg concat
    const listFile = join(fragmentsDir, "list.txt");
    await writeFile(listFile, timing.map((t) => `file '${join(fragmentsDir, String(t.idx).padStart(4, "0") + ".mp3")}'`).join("\n"));
    const finalMp3 = join(audioDir, `ch_${String(chN).padStart(2, "0")}.mp3`);
    await spawnP("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", finalMp3]);

    await writeFile(join(chaptersDir, `ch_${String(chN).padStart(2, "0")}.timing.json`), JSON.stringify(timing, null, 2));
    await writeFile(join(chaptersDir, `ch_${String(chN).padStart(2, "0")}.split.json`), JSON.stringify(resolved, null, 2));
    console.log(`✓ tts ch_${chN} (${timing.length} sentences, ${cursor.toFixed(1)}s)`);
  }
  await writeFile(join(outputDir, "voice-resolved.json"), JSON.stringify(resolvedAll, null, 2));
}

// === stage = epub ===
async function runEpub(): Promise<void> {
  const chaptersDir = join(outputDir, "chapters");
  const distDir = join(outputDir, "dist");
  await mkdir(distDir, { recursive: true });
  const files = (await readdir(chaptersDir)).filter((f) => /^ch_\d+\.md$/.test(f)).sort();

  const extra: Array<{ path: string; data: string | Buffer }> = [];
  const manifest: Array<{ id: string; href: string; mediaType: string; mediaOverlay?: string; properties?: string }> = [];
  const spine: string[] = [];

  // CSS
  extra.push({ path: "styles/novel.css", data: "body{font-family:serif;line-height:1.7;} figure{margin:1em 0;text-align:center;} img{max-width:100%;}" });
  manifest.push({ id: "css", href: "styles/novel.css", mediaType: "text/css" });

  for (const file of files) {
    const chN = parseInt(file.match(/^ch_(\d+)\.md$/)![1], 10);
    const padded = String(chN).padStart(2, "0");
    const md = await readFile(join(chaptersDir, file), "utf8");
    const title = md.match(/^title:\s*"?([^"\n]+)"?/m)?.[1] ?? `Chapter ${chN}`;
    const scenes = parseScenes(md);
    const renderScenes: SceneRender[] = scenes.map((sc, i) => {
      const sents = splitToSentences(sc.body, sc.participants).map((s, k) => ({ ...s, idx: k }));
      const imgPath = join(outputDir, "illustrations", `ch_${padded}`, `scene_${String(i + 1).padStart(2, "0")}.png`);
      return {
        sentences: sents,
        illustration: { src: `../illustrations/ch_${padded}/scene_${String(i + 1).padStart(2, "0")}.png`, alt: sc.title },
      };
    });
    const xhtml = renderChapterXhtml({ chapterIndex: chN, title, scenes: renderScenes });
    extra.push({ path: `chapters/ch_${padded}.xhtml`, data: xhtml });

    // SMIL
    const timing = JSON.parse(await readFile(join(chaptersDir, `ch_${padded}.timing.json`), "utf8"));
    const smil = buildSmil({
      chapterHref: `chapters/ch_${padded}.xhtml`,
      audioHref: `audio/ch_${padded}.mp3`,
      sentences: timing.map((t: any) => ({ id: `s_${padded}_${String(t.idx).padStart(3, "0")}`, start: t.start, dur: t.dur })),
    });
    extra.push({ path: `audio/ch_${padded}.smil`, data: smil });

    // audio file (relative copy)
    const mp3 = await readFile(join(outputDir, "audio", `ch_${padded}.mp3`));
    extra.push({ path: `audio/ch_${padded}.mp3`, data: mp3 });

    // illustrations: copy referenced
    for (let i = 0; i < scenes.length; i++) {
      const png = await readFile(join(outputDir, "illustrations", `ch_${padded}`, `scene_${String(i + 1).padStart(2, "0")}.png`));
      extra.push({ path: `illustrations/ch_${padded}/scene_${String(i + 1).padStart(2, "0")}.png`, data: png });
    }

    manifest.push({ id: `ch${padded}`, href: `chapters/ch_${padded}.xhtml`, mediaType: "application/xhtml+xml", mediaOverlay: `smil_ch${padded}` });
    manifest.push({ id: `smil_ch${padded}`, href: `audio/ch_${padded}.smil`, mediaType: "application/smil+xml" });
    manifest.push({ id: `audio_ch${padded}`, href: `audio/ch_${padded}.mp3`, mediaType: "audio/mpeg" });
    spine.push(`ch${padded}`);
  }

  // 用 opf-builder 替换 stub
  const opfXml = buildOpf({ uid: proj, title: proj, language: "zh-CN", manifest, spine });
  const epubBuf = await packEpub({ basename: proj, manifest, spine, extraFiles: extra, opfXml });
  await writeFile(join(distDir, `${proj}.epub`), epubBuf);
  console.log(`✓ epub: ${join(distDir, proj + ".epub")}`);
}

// === stage = archive ===
async function runArchive(): Promise<void> {
  const distDir = join(outputDir, "dist");
  await mkdir(distDir, { recursive: true });
  const chaptersDir = join(outputDir, "chapters");
  const files = (await readdir(chaptersDir)).filter((f) => /^ch_\d+\.md$/.test(f)).sort();
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
    const cp = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
    let out = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.on("exit", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe exit ${c}`))));
  });
}

// === dispatch ===
const stage = values.stage!;
if (stage === "tts" || stage === "all") await runTts();
if (stage === "epub" || stage === "all") await runEpub();
if (stage === "archive" || stage === "all") await runArchive();
```

- [ ] **Step 2：本地烟雾测试（需 audio-picture-book-creator 的 builder + ffmpeg + AZURE_API_KEY，可跳过）**

```bash
bun run .claude/skills/audio-novel-packager/scripts/package-novel.ts \
  --output-dir tmp-novel --stage all
ls tmp-novel/dist/
```
Expected: `dist/<project>.epub` 与 `dist/<project>.md` 存在。

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/audio-novel-packager/scripts/package-novel.ts
git commit -m "feat(novel): package-novel CLI (tts + epub + archive)"
```

---

## Phase 6 — illustrated-audio-novel-creator（主编排器）

**目标**：单一用户入口。接收 `seed + tier`，按 stage 编排前 5 个 skill；在 4 个人工确认点暂停；负责 Opus review 循环；管理 state.json 与 debt 列表。

**Files (Phase 6 全景)**：
- Create: `.claude/skills/illustrated-audio-novel-creator/SKILL.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/references/stage-flow.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/references/tier-presets.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/references/opus-review-prompt.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/lib/tier-config.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts`

> 主编排器**没有自己的 CLI 总入口**——它由 LLM（agent）按 SKILL.md 一步步驱动。脚本只提供 (1) tier 参数表 (2) state 读写工具，便于 LLM 调用做确定性判断。

---

### Task 6.1：写 SKILL.md（主入口 + 阶段编排）

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/SKILL.md`

- [ ] **Step 1：写 SKILL.md**

```markdown
---
name: illustrated-audio-novel-creator
description: Use when the user wants to produce a complete illustrated audio novel (Reflowable EPUB3 + multi-voice MP3 + archive Markdown) from a seed concept. Handles all stages — foundation, drafting, revision, illustration, audio packaging — with 4 human-confirmation pause points and an Opus review loop. This is the single entry skill for the entire pipeline.
---

# Illustrated Audio Novel Creator（主编排器）

## When to invoke

- 用户给出"想写一本中文有声图文小说"的需求 + seed 概念（一句到几段）
- 任何"从零到 EPUB"的请求
- **不要**用本 skill 做单章修订或单图重生 —— 直接用对应子 skill

## Inputs

| 字段 | 来源 | 备注 |
|---|---|---|
| `seed` | 用户输入 | 50–500 字 |
| `tier` | 用户选择：short / medium / long | 详见 `references/tier-presets.md` |
| `language` | 默认 zh | v1 仅支持中文 |
| `project_name?` | 可选；缺省由 seed 派生 | |

## Outputs

```
novel-output/<YYYY-MM-DD>-<slug>/
├── world.md / characters.md / outline.md / voice.md / style.md
├── chapters/ch_NN.md (+ .eval.json + .timing.json + .split.json)
├── portraits/<name>.png (+ .meta.json)
├── illustrations/ch_NN/scene_KK.png (+ .meta.json)
├── audio/ch_NN.mp3 (+ _frag_ch_NN/)
├── dist/<basename>.epub
├── dist/<basename>.md
├── voice-resolved.json
└── state.json
```

## 4 个人工确认点（HARD GATE）

每到一个点必须**暂停**，明确报告产物路径与下一步动作，等用户回 "OK" / "继续" / 给出修改指令后再走下一阶段。

| 点 | 时机 | 用户该看什么 |
|---|---|---|
| GATE-1 | Stage 1 后 | 故事方向（10 行内 elevator pitch + outline 概览） |
| GATE-2 | Stage 2 后 | outline.md 全文 + characters.md 全文 |
| GATE-3 | Stage 4 portraits 完成后 | portraits/ 所有立绘缩略图 |
| GATE-4 | Stage 5 修订完成后 | 抽查 1–2 章正文 + 抽查 1–2 张插图 |

## Stages（按顺序，每 stage 完成更新 state.phase）

详见 `references/stage-flow.md`。摘要：

```
Stage 0：参数化 + 创建 output_dir + 写 state.json (phase=init)
Stage 1：seed → 故事方向草案（在 LLM 上下文里，不写文件） → GATE-1
Stage 2：调 novel-foundation-builder → GATE-2
Stage 3：按 outline 顺序逐章调 novel-chapter-workshop（mode=draft） — 每章未达分自动 revise，最多 3 轮
Stage 3.5（可选，仅 long）：Opus review 循环（见下）
Stage 4：调 scene-illustrator portraits → GATE-3 → 逐章 scenes
Stage 5：抽查（自动列 3 章 + 3 图） → GATE-4
Stage 6：调 audio-novel-packager --stage all
Stage 7：报告：dist/*.epub / *.md / audio/* 路径与摘要
```

## Opus review 循环（仅 tier=long）

- 全 manuscript 拼接 → 调 Opus + `references/opus-review-prompt.md`
- 解析返回的 actionable items（按"qualified hedge"过滤）
- 选 top 3 项 → 转化为对应章节的"revision brief" → 调 chapter-workshop mode=revise
- 重新跑一次 Opus → 若没有 major unqualified item，停止；否则重复，最多 3 轮

实现细节：本 skill 自己写 review prompt + 解析；不必新建子 skill。

## State + Debt 管理

每个 stage 结束都用 `scripts/lib/state-helpers.ts` 更新：
```bash
bun run .claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts \
  --output-dir <dir> --set-phase drafted
```

debt 三类（写 state.json.debts）：
- `chapter_low_score`：3 轮 revise 仍 < 6.0
- `illustration_drift`：Tier 1.5 recheck 重生后仍漂
- `scene_marker_invalid`：某 scene parse 失败被跳过

完成 Stage 7 时报告 debt 列表，让用户决定是否人工修。

## Quality bar

- [ ] 每 GATE 都有暂停 + 报告
- [ ] state.json 在每 stage 后均更新 phase 字段
- [ ] dist/*.epub 通过 epubcheck 无 fatal
- [ ] tier 参数全程一致（outline.tier === state.tier === packager 用的 basename 后缀）

## References

- `references/stage-flow.md`
- `references/tier-presets.md`
- `references/opus-review-prompt.md`
- 子 skill：novel-foundation-builder / novel-chapter-workshop / scene-illustrator / audio-novel-packager
- 复用：image-generation（已扩展 --ref）、text-to-speech
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/SKILL.md
git commit -m "feat(novel): illustrated-audio-novel-creator main SKILL.md"
```

---

### Task 6.2：写 stage-flow.md

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/references/stage-flow.md`

- [ ] **Step 1：写文档**

```markdown
# Stage Flow（详细执行说明）

每个 stage 必做的动作、写入文件、退出条件、人工 GATE 触发时机。

## Stage 0：初始化

1. 由 seed 派生 slug：取前 12 个非标点中文字符 + 拼音首字母 →（如算法复杂直接让用户给）
2. 读 tier-presets.md，根据 tier 决定 `target_words` / `chapter_count`
3. `mkdir -p novel-output/<YYYY-MM-DD>-<slug>/`
4. 写 state.json（phase="init"，包含 seed/tier/target_words/chapter_count/created_at）

## Stage 1：方向草案

1. LLM 自己读 seed + craft-zh.md 的 Wound-Want-Need-Lie 框架
2. **在对话上下文里**草拟：(a) 故事核 200 字 (b) 主角四要素 (c) 中央冲突 (d) 主题
3. 不写文件
4. **GATE-1**：把 (a)–(d) 用 < 25 行报告给用户，等 "OK" 或修改指令

## Stage 2：foundation

1. 让 LLM 按 novel-foundation-builder/SKILL.md 写出 5 个 .md
2. 落盘到 output_dir
3. 调 init-foundation.ts CLI 校验 + 分配 voice + 写 state.json
4. **GATE-2**：把 outline.md 全文 + characters.md 全文 + style.md preset 报告给用户
5. state.phase = "foundation_done"

## Stage 3：drafting

按 outline 顺序，循环 1..N：
1. 调 novel-chapter-workshop mode=draft（让 LLM 按 SKILL.md 写章节 + 跑 evaluate-chapter.ts）
2. 若 mechanical_pass=false 或 LLM judge < 6.0 → mode=revise（最多 3 轮）
3. 3 轮后仍不达标 → 写入 state.debts 类型 `chapter_low_score`，仍标 status=needs_human，但**不阻塞**——继续下一章
4. 每章完成后更新 state.json.chapters[N]={ drafted: true, score: X }
5. 全部完成后 state.phase = "drafted"

## Stage 3.5：Opus review（仅 tier=long）

详见 SKILL.md "Opus review 循环"。最多 3 轮，每轮调 1 次 Opus，每次只修 top 3 章。  
完成后 state.phase = "revised"。  
short / medium：跳过本 stage，直接 revised = drafted。

## Stage 4：illustration

1. 调 illustrate-chapter.ts --mode portraits-only
2. **GATE-3**：列出 portraits/*.png + 缩略报告（角色名 + 锚定短语 + 文件路径），等用户确认
3. 若用户拒绝某张 → 删除 → 调整 anchor → 重生
4. 用户 OK → 按章循环调 illustrate-chapter.ts --mode all
5. 每章完成后：让 LLM 按 recheck-prompt.md 对每张 scene 图做 vision recheck，写回 scene_NN.meta.json.recheck；needs_regen → 重生 1 次
6. 全部完成 state.phase = "illustrated"

## Stage 5：抽查（自动）

1. 抽 3 章正文（首章 + 中段章 + 末章）+ 3 张插图（首章首图 + 中段中图 + 末章末图）
2. 用 < 30 行汇报给用户：每章 word_count / score / debt 状态；每图 prompt + recheck 结果
3. **GATE-4**：等 OK；若用户挑出问题 → 回到对应 sub-skill 修复后回到 Stage 5 复核

## Stage 6：packaging

1. 调 package-novel.ts --stage all
2. 完成后 state.phase = "packaged"

## Stage 7：交付报告

回放：
- output_dir 路径
- dist/*.epub / *.md 路径
- 每章 word_count / score
- portraits + illustrations 计数
- debt 列表（按类型分组）
- "下一步建议"：epub 用 Thorium 打开测试；mp3 用任意播放器
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/references/stage-flow.md
git commit -m "docs(novel): stage-flow detailed execution spec"
```

---

### Task 6.3：写 tier-presets.md

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/references/tier-presets.md`

- [ ] **Step 1：写文档**

```markdown
# Tier Presets

3 档参数表。LLM 在 Stage 0 按本表派生 chapter_count / target_words。  
插图密度遵循"网漫范式"——每 800–1000 字 1 张图（章首装饰图不算）。

| tier | chapter_count | words/chapter | total_words | beat_structure | est. illustrations | est. duration (TTS, ~250 字/分钟) |
|---|---|---|---|---|---|---|
| short | 5 | 2000 | 10,000 | 5-act | 10–15 | 40 min |
| medium | 12 | 2500 | 30,000 | 9-beat | 30–45 | 2 h |
| long | 24 | 3000 | 72,000 | save-the-cat-15 | 80–120 | 5 h |

## 派生规则

- `target_words = chapter_count × words/chapter`
- `est. illustrations` 由各章 outline 的 `scene_count_hint` 加总（参考表中的范围）
- `est. duration` 仅做用户预期管理，不参与执行流程

## 用户可覆盖

- 用户在 Stage 1 GATE-1 之前可以修改 chapter_count / words/chapter
- 修改后 LLM 必须重新派生 target_words 并写入 state.json，下游一切以 state.json 为准
- 不要在 Stage 2 之后改 tier（会让 outline / portraits / 已写章节失配）

## tier 与 Opus review

- short / medium：仅自动 mechanical + LLM judge revise
- long：额外 Opus review 循环（最多 3 轮，每轮修 top 3 章）

## 与子 skill 的对应

| 子 skill | 接收的 tier 字段 |
|---|---|
| novel-foundation-builder | tier（决定 outline.beat_structure）+ target_words + chapter_count |
| novel-chapter-workshop | 不直接看 tier，但 word_count 校验依赖 outline 的 scene_count_hint × 600 |
| scene-illustrator | 不依赖 tier；仅按 SCENE 标记数生成 |
| audio-novel-packager | 不依赖 tier；按已存在的章节列表打包 |
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/references/tier-presets.md
git commit -m "docs(novel): tier presets (short/medium/long parameters)"
```

---

### Task 6.4：写 opus-review-prompt.md

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/references/opus-review-prompt.md`

- [ ] **Step 1：写文档**

```markdown
# Opus Review Prompt

仅 tier=long 使用。在每轮调用前由主编排器把全 manuscript（chapters/ch_*.md 拼接，去 SCENE 标记）作为输入，套用本 prompt。

## Prompt（送给 Claude Opus）

```
你将分别以两个身份审阅一部下面给出的中文小说：
1. 文学评论家（关注主题深度、人物纵深、节奏、文体）
2. 小说写作教授（关注技法、结构、可读性、情节漏洞）

请按下列格式输出：

## 评论家视角
- [严重 | 中等 | 微小]：<具体问题，引用章节号 + 段落特征>
- ...
（不必凑数；如无显著问题请说明"无显著问题"）

## 教授视角
- [严重 | 中等 | 微小]：<具体问题 + 建议改法>
- ...

## 综合 actionable 列表
按优先级 1..K 给出"如果只能改 3 处，应该改哪 3 处"，每条含：
- chapter: <N>
- issue: <一句话>
- suggested_fix: <一句话>

## 停止判据
- 如果"严重"项 = 0 且"中等"项 ≤ 2，请在末尾输出：`STOP_CONDITION_MET`
```

## 解析

主编排器负责：
1. 抓 `STOP_CONDITION_MET` → 若存在则结束循环
2. 否则解析"综合 actionable 列表"，提取 top 3 items 写入 brief：
   ```
   <output_dir>/briefs/round_<R>_top_<I>.md
   ```
3. 对每个 brief 调 chapter-workshop mode=revise，把 brief 内容塞进对话
4. 完成 → 重跑 Opus

## 边界

- 单轮 Opus 输入大约不能超过 200K tokens；long tier 72K 字 ≈ 110K tokens（中文每字约 1.5 token），安全
- 输出超 5000 字的 review 视为异常 → 让 LLM 重提
```

- [ ] **Step 2：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/references/opus-review-prompt.md
git commit -m "docs(novel): opus review prompt for long-tier review loop"
```

---

### Task 6.5：tier-config.ts —— tier 派生表（TDD）

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/lib/tier-config.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts`

**职责**：纯函数 `tierToConfig(tier) → { chapter_count, words_per_chapter, target_words, beat_structure, opus_review_enabled }`，与 tier-presets.md 一一对应。供 LLM 通过 CLI 调用得到确定性参数。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts
import { describe, it, expect } from "bun:test";
import { tierToConfig, type TierConfig } from "../lib/tier-config";

describe("tierToConfig", () => {
  it("short", () => {
    const c = tierToConfig("short");
    expect(c.chapter_count).toBe(5);
    expect(c.words_per_chapter).toBe(2000);
    expect(c.target_words).toBe(10000);
    expect(c.beat_structure).toBe("5-act");
    expect(c.opus_review_enabled).toBe(false);
  });
  it("medium", () => {
    const c = tierToConfig("medium");
    expect(c.chapter_count).toBe(12);
    expect(c.target_words).toBe(30000);
    expect(c.beat_structure).toBe("9-beat");
    expect(c.opus_review_enabled).toBe(false);
  });
  it("long enables opus review", () => {
    const c = tierToConfig("long");
    expect(c.chapter_count).toBe(24);
    expect(c.target_words).toBe(72000);
    expect(c.beat_structure).toBe("save-the-cat-15");
    expect(c.opus_review_enabled).toBe(true);
  });
  it("非法 tier 报错", () => {
    expect(() => tierToConfig("epic" as any)).toThrow(/tier/);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts
```
Expected: FAIL — `Cannot find module '../lib/tier-config'`

- [ ] **Step 3：实现 tier-config.ts**

```typescript
// .claude/skills/illustrated-audio-novel-creator/scripts/lib/tier-config.ts

export type Tier = "short" | "medium" | "long";

export interface TierConfig {
  tier: Tier;
  chapter_count: number;
  words_per_chapter: number;
  target_words: number;
  beat_structure: "5-act" | "9-beat" | "save-the-cat-15";
  opus_review_enabled: boolean;
}

const TABLE: Record<Tier, Omit<TierConfig, "tier" | "target_words">> = {
  short: { chapter_count: 5, words_per_chapter: 2000, beat_structure: "5-act", opus_review_enabled: false },
  medium: { chapter_count: 12, words_per_chapter: 2500, beat_structure: "9-beat", opus_review_enabled: false },
  long: { chapter_count: 24, words_per_chapter: 3000, beat_structure: "save-the-cat-15", opus_review_enabled: true },
};

export function tierToConfig(tier: Tier): TierConfig {
  const row = TABLE[tier];
  if (!row) throw new Error(`非法 tier: ${tier}`);
  return {
    tier,
    ...row,
    target_words: row.chapter_count * row.words_per_chapter,
  };
}

// CLI 入口（让 LLM 通过 bun run 调用得到 JSON）
if (import.meta.main) {
  const tier = process.argv[2] as Tier;
  if (!tier) {
    console.error("用法: bun run tier-config.ts <short|medium|long>");
    process.exit(1);
  }
  console.log(JSON.stringify(tierToConfig(tier), null, 2));
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts
```
Expected: PASS（4 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/scripts/lib/tier-config.ts \
        .claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts
git commit -m "feat(novel): tier-config (deterministic tier → params)"
```

---

### Task 6.6：state-helpers.ts —— state.json 读写工具（TDD）

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts`

**职责**：让 LLM 通过 CLI 做"原子状态变更"——避免它自己 json patch 出错。

- [ ] **Step 1：写失败测试**

```typescript
// .claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setPhase, addDebt, markChapter, readState } from "../lib/state-helpers";

const TMP = "/tmp/state-helpers-test";

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  await writeFile(
    join(TMP, "state.json"),
    JSON.stringify({
      version: 1,
      project: "x",
      tier: "short",
      phase: "init",
      seed: "s",
      target_words: 10000,
      chapter_count: 5,
      created_at: "2026-05-13T00:00:00Z",
      debts: [],
      chapters: { "1": {}, "2": {} },
    }),
  );
});
afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("setPhase", () => {
  it("phase 转换合法 → 写回成功", async () => {
    await setPhase(TMP, "foundation_done");
    const s = await readState(TMP);
    expect(s.phase).toBe("foundation_done");
  });
  it("非法 phase 报错", async () => {
    await expect(setPhase(TMP, "garbage" as any)).rejects.toThrow(/phase/);
  });
});

describe("addDebt", () => {
  it("追加 debt 不重复", async () => {
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "score=4.2" });
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "score=4.2" });
    const s = await readState(TMP);
    expect(s.debts).toHaveLength(1);
  });
});

describe("markChapter", () => {
  it("写入章节状态", async () => {
    await markChapter(TMP, 1, { drafted: true, score: 7.1 });
    const s = await readState(TMP);
    expect(s.chapters["1"]).toEqual({ drafted: true, score: 7.1 });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run:
```bash
bun test .claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts
```
Expected: FAIL — `Cannot find module '../lib/state-helpers'`

- [ ] **Step 3：实现 state-helpers.ts**

```typescript
// .claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const VALID_PHASES = [
  "init",
  "foundation_done",
  "drafting",
  "drafted",
  "revising",
  "revised",
  "illustrated",
  "audio_done",
  "packaged",
] as const;
export type Phase = (typeof VALID_PHASES)[number];

export interface Debt {
  kind: string;
  ref: string;
  note: string;
}

export interface ChapterState {
  drafted?: boolean;
  revised?: boolean;
  score?: number;
  illustrations?: number;
  audio?: boolean;
}

export interface NovelState {
  version: 1;
  project: string;
  tier: "short" | "medium" | "long";
  phase: Phase;
  seed: string;
  target_words: number;
  chapter_count: number;
  created_at: string;
  debts: Debt[];
  chapters: Record<string, ChapterState>;
}

const statePath = (dir: string) => join(resolve(dir), "state.json");

export async function readState(dir: string): Promise<NovelState> {
  return JSON.parse(await readFile(statePath(dir), "utf8"));
}
async function writeState(dir: string, s: NovelState): Promise<void> {
  await writeFile(statePath(dir), JSON.stringify(s, null, 2));
}

export async function setPhase(dir: string, phase: Phase): Promise<void> {
  if (!VALID_PHASES.includes(phase)) throw new Error(`非法 phase: ${phase}`);
  const s = await readState(dir);
  s.phase = phase;
  await writeState(dir, s);
}

export async function addDebt(dir: string, debt: Debt): Promise<void> {
  const s = await readState(dir);
  const dup = s.debts.find(
    (d) => d.kind === debt.kind && d.ref === debt.ref && d.note === debt.note,
  );
  if (!dup) s.debts.push(debt);
  await writeState(dir, s);
}

export async function markChapter(
  dir: string,
  n: number,
  patch: Partial<ChapterState>,
): Promise<void> {
  const s = await readState(dir);
  s.chapters[String(n)] = { ...(s.chapters[String(n)] ?? {}), ...patch };
  await writeState(dir, s);
}

// CLI
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "output-dir": { type: "string" },
      "set-phase": { type: "string" },
      "add-debt-kind": { type: "string" },
      "add-debt-ref": { type: "string" },
      "add-debt-note": { type: "string" },
      "mark-chapter": { type: "string" },
      "patch": { type: "string" }, // JSON
    },
    strict: true,
  });
  if (!values["output-dir"]) {
    console.error("--output-dir 必填");
    process.exit(1);
  }
  if (values["set-phase"]) {
    await setPhase(values["output-dir"], values["set-phase"] as Phase);
    console.log(`✓ phase=${values["set-phase"]}`);
  }
  if (values["add-debt-kind"]) {
    await addDebt(values["output-dir"], {
      kind: values["add-debt-kind"]!,
      ref: values["add-debt-ref"] ?? "",
      note: values["add-debt-note"] ?? "",
    });
    console.log("✓ debt added");
  }
  if (values["mark-chapter"] && values["patch"]) {
    await markChapter(
      values["output-dir"],
      parseInt(values["mark-chapter"], 10),
      JSON.parse(values["patch"]),
    );
    console.log("✓ chapter marked");
  }
}
```

- [ ] **Step 4：跑测试确认通过**

Run:
```bash
bun test .claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts
```
Expected: PASS（4 tests pass）

- [ ] **Step 5：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts \
        .claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts
git commit -m "feat(novel): state-helpers (atomic state.json mutations + CLI)"
```

---

## Phase 7 — 集成测试 + README + 自检验收

**目标**：把 6 个 phase 的产物拼起来跑一次端到端 mini-run（短篇 + 极小 chapter_count），验证主链路无错；写项目 README 入口；做最终验收清单。

**Files (Phase 7 全景)**：
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/{characters.md,outline.md,world.md,voice.md,style.md}`
- Modify: `README.md`（在末尾加一个"有声图文小说"入口区块）

> 集成测试不调真实外部 API（image-gen / TTS / Opus）；只串本地 lib 与 CLI 的"无外部依赖"路径，验证：(1) foundation init 能跑通 (2) chapter-workshop 的 mechanical 三件套能跑通 (3) state-helpers 能流转 phase。真正的端到端跑由人手验证（在 README 里写步骤）。

---

### Task 7.1：mini fixtures（最小可校验项目）

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/characters.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/outline.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/world.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/voice.md`
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/style.md`

- [ ] **Step 1：写 characters.md**

```markdown
---
count: 4
---

## 林晚
- role: 主角
- core: 失明少女靠灵气感知世界
- wound: 12 岁失去视力
- want: 复明
- need: 接受新感官
- lie: 必须看见才有价值
- appearance: long silver hair tied with red ribbon, dark green robe, milky-white blind eyes
- voice_profile: auto

## 沈渊
- role: 导师
- core: 隐居灵气医师
- wound: 失去爱徒
- want: 不再收徒
- need: 重新信任
- lie: 教导即背叛
- appearance: tall man with grey beard, faded blue robe, jade pendant
- voice_profile: auto

## 周泽
- role: 盟友
- core: 残废老兵
- wound: 一条腿
- want: 复仇
- need: 放下
- lie: 仇恨是燃料
- appearance: shaved head with vertical scar, brown leather coat, wooden crutch
- voice_profile: auto

## 苏雨
- role: 对手
- core: 灵气掮客
- wound: 出身底层
- want: 富贵
- need: 自尊
- lie: 钱能买回尊严
- appearance: wavy auburn hair, ivory linen dress, golden hairpin
- voice_profile: auto
```

- [ ] **Step 2：写 outline.md**

```markdown
---
tier: short
chapter_count: 5
target_words_total: 10000
beat_structure: 5-act
---

## Chapter 1: 灰雪
- beat: Opening Image
- pov: 林晚
- summary: 林晚在废墟中苏醒，第一次清晰感知到灵气流动。她意识到失明之后，世界以另一种方式回到她身边。这一章建立基调与角色处境。
- scene_count_hint: 2

## Chapter 2: 门后
- beat: Catalyst
- pov: 林晚
- summary: 林晚遇到沈渊，被告知她的感知能力极为罕见。她拒绝相信，但被一场袭击逼迫接受现实。沈渊勉强答应教她。
- scene_count_hint: 3

## Chapter 3: 旧伤
- beat: Midpoint
- pov: 林晚
- summary: 林晚结识周泽，两人在废墟外缘巡视时遭遇苏雨手下。林晚第一次主动用灵气护住周泽，但代价让她昏迷一夜。
- scene_count_hint: 3

## Chapter 4: 抉择
- beat: All Is Lost
- pov: 林晚
- summary: 苏雨抓住沈渊作要挟，林晚必须选择独自闯入对手据点。她以为自己将永远失去导师，但沈渊在最后一刻自救出场。
- scene_count_hint: 3

## Chapter 5: 新眼
- beat: Final Image
- pov: 林晚
- summary: 危机解除后，林晚不再追求复明，而是接受灵气视野作为新的自我。她决定留下来教其他孩子。
- scene_count_hint: 2
```

- [ ] **Step 3：写 world.md / voice.md / style.md（极简）**

```markdown
<!-- file: world.md -->
---
title: 北郊废墟
genre: 玄幻
era: 末世后
---

# 地理
北郊废墟由地震掀翻的城市遗骸组成，灵气浓度异常。

# 历史
大灾三十年。

# 体系
- 能做什么：感知灵气流向、短距推/拒
- 限制：每日额度有限
- 代价：透支会昏迷或失去其他感官

# 恒定真相
- 失明者更易感知灵气
- 灵气消耗超过 50% 必然昏迷
```

```markdown
<!-- file: voice.md -->
---
person: 第三人称限知
tense: 过去时
language: zh
---

# 句感
克制，节奏短促，少形容词。

# 句长偏好
- 平均：18 字
- 节奏：短句为主

# 禁用词清单
- 缓缓地
- 不禁
```

```markdown
<!-- file: style.md -->
---
preset: webtoon-anime
---

# promptPrefix
Webtoon-style anime illustration, soft cel shading, muted earth palette

# negative
no watermark, no text, no signature, no extra fingers

# palette
- charcoal grey
- jade green
- dust ivory

# 角色锚定短语索引
| name | anchor (English) |
|---|---|
| 林晚 | long silver hair tied with red ribbon, dark green robe, milky-white blind eyes |
| 沈渊 | tall man with grey beard, faded blue robe, jade pendant |
| 周泽 | shaved head with vertical scar, brown leather coat, wooden crutch |
| 苏雨 | wavy auburn hair, ivory linen dress, golden hairpin |
```

- [ ] **Step 4：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/scripts/test/fixtures/mini-foundation/
git commit -m "test(novel): mini-foundation fixtures for integration test"
```

---

### Task 7.2：integration.test.ts —— 端到端无外部依赖路径

**Files:**
- Create: `.claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts`

**职责**：跑通 (a) foundation init → state.json (b) state-helpers 流转 phase (c) chapter-workshop 的 scanner 三件套能在生成的 fixture chapter 上工作。**不调任何远程 API**。

- [ ] **Step 1：写测试**

```typescript
// .claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { tierToConfig } from "../lib/tier-config";
import { setPhase, readState, addDebt, markChapter } from "../lib/state-helpers";
import { parseCharactersMd, parseOutlineMd } from "../../../novel-foundation-builder/scripts/lib/schemas";
import { scanSlop } from "../../../novel-chapter-workshop/scripts/lib/slop-scanner";
import { scanPatterns } from "../../../novel-chapter-workshop/scripts/lib/pattern-scanner";
import { parseScenes } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";
import { buildAnchors } from "../../../scene-illustrator/scripts/lib/anchor-builder";

const FIX = resolve(import.meta.dir, "fixtures/mini-foundation");
const TMP = "/tmp/iaa-novel-integration";

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  for (const f of ["characters.md", "outline.md", "world.md", "voice.md", "style.md"]) {
    await cp(join(FIX, f), join(TMP, f));
  }
});
afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("integration: foundation init → state", () => {
  it("init-foundation.ts 能写出 state.json 且 phase=foundation_done", async () => {
    await new Promise<void>((res, rej) => {
      const cp = spawn(
        "bun",
        [
          "run",
          ".claude/skills/novel-foundation-builder/scripts/init-foundation.ts",
          "--output-dir", TMP,
          "--seed", "测试种子",
          "--tier", "short",
        ],
        { stdio: "inherit" },
      );
      cp.on("exit", (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`))));
    });
    const state = await readState(TMP);
    expect(state.phase).toBe("foundation_done");
    expect(state.chapter_count).toBe(5);
    expect(Object.keys(state.chapters)).toHaveLength(5);
  });

  it("characters.md 中 voice_profile 不再含 'auto'", async () => {
    const md = await readFile(join(TMP, "characters.md"), "utf8");
    expect(md).not.toContain("voice_profile: auto");
  });
});

describe("integration: schemas + anchors 一致", () => {
  it("foundation 通过的 characters.md 可以被 anchor-builder 解析", async () => {
    const md = await readFile(join(TMP, "characters.md"), "utf8");
    const parsed = parseCharactersMd(md);
    const anchors = buildAnchors(md);
    expect(anchors.size).toBe(parsed.count);
    expect(anchors.get("林晚")).toContain("silver hair");
  });
});

describe("integration: tier-config 与 outline 一致", () => {
  it("tier-config short 与 fixture outline.md 互相印证", async () => {
    const cfg = tierToConfig("short");
    const md = await readFile(join(TMP, "outline.md"), "utf8");
    const o = parseOutlineMd(md);
    expect(cfg.chapter_count).toBe(o.chapterCount);
    expect(cfg.target_words).toBe(o.targetWordsTotal);
  });
});

describe("integration: 章节 scanner 三件套联跑", () => {
  it("把 ch-good fixture 当作 ch_01 处理 → 三件套全过", async () => {
    const goodMd = await readFile(
      ".claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md",
      "utf8",
    );
    await mkdir(join(TMP, "chapters"), { recursive: true });
    await writeFile(join(TMP, "chapters", "ch_01.md"), goodMd);
    const slopFile = await readFile(
      ".claude/skills/novel-chapter-workshop/references/anti-slop-zh.md",
      "utf8",
    );
    const slop = scanSlop(goodMd, slopFile);
    const pat = scanPatterns(goodMd);
    const scenes = parseScenes(goodMd);
    expect(slop.filter((h) => h.tier === 1)).toHaveLength(0);
    expect(pat).toHaveLength(0);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("integration: state-helpers 跨 phase", () => {
  it("流转 init → drafted → packaged，debt 累积，chapter mark 持久化", async () => {
    await setPhase(TMP, "drafted");
    await markChapter(TMP, 1, { drafted: true, score: 7.5 });
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "score=5.4" });
    await setPhase(TMP, "packaged");
    const s = await readState(TMP);
    expect(s.phase).toBe("packaged");
    expect(s.chapters["1"]).toEqual({ drafted: true, score: 7.5 });
    expect(s.debts).toHaveLength(1);
  });
});
```

- [ ] **Step 2：跑测试**

Run:
```bash
bun test .claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts
```
Expected: 全部 PASS（5 tests）。  
若 fail：定位到具体 phase 的 lib 修复，不要在集成测试里加 mock。

- [ ] **Step 3：Commit**

```bash
git add .claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts
git commit -m "test(novel): integration test for foundation→scanner→state pipeline"
```

---

### Task 7.3：跑全量测试

**Files:** —（不修改文件，仅验证）

- [ ] **Step 1：跑全部 skill 测试**

Run:
```bash
bun test .claude/skills/
```
Expected: 全 PASS。涵盖：
- novel-foundation-builder（schemas + voice-assigner）
- novel-chapter-workshop（slop + pattern + scene-marker）
- scene-illustrator（anchor-builder + scene-prompt-builder + portrait-manager）
- audio-novel-packager（chapter-splitter + voice-resolver + epub3-builder）
- illustrated-audio-novel-creator（tier-config + state-helpers + integration）
- 已有的 audio-picture-book-creator / image-generation 测试（不受本次改动影响）

若 image-generation Phase 0 改动引入回归 → 优先修复回归。

- [ ] **Step 2：Commit（如本步无新文件改动可跳过）**

仅当跑测试中临时改了 lint / 类型问题，作为单独 commit 提交。

---

### Task 7.4：在项目 README 加入口

**Files:**
- Modify: `README.md`

- [ ] **Step 1：读现状**

Run:
```bash
cat README.md | head -60
```
确认现有结构，找到合适的"功能模块"区段。

- [ ] **Step 2：在末尾追加"有声图文小说"小节**

```markdown
## 有声图文小说（Illustrated Audio Novel）

从一个 seed 概念产出 Reflowable EPUB3（句级高亮） + 多 voice MP3 + 网漫范式插图的端到端流水线。

```text
用户对话 → /illustrated-audio-novel-creator
        → seed + tier(short|medium|long)
        → Stage 1..7（4 个人工 GATE）
        → novel-output/<date>-<slug>/dist/*.epub + *.md + audio/*.mp3
```

设计与实现：
- Spec：`docs/superpowers/specs/2026-05-13-illustrated-audio-novel-design.md`
- Plan：`docs/superpowers/plans/2026-05-13-illustrated-audio-novel-plan.md`

参与的 skill：

| Skill | 责任 |
|---|---|
| `illustrated-audio-novel-creator` | 主编排器（用户入口） |
| `novel-foundation-builder` | world / characters / outline / voice / style 5 层文档 |
| `novel-chapter-workshop` | 单章 draft / evaluate / revise |
| `scene-illustrator` | 角色立绘 + 场景插图（image-to-image 锚定） |
| `audio-novel-packager` | 多 voice TTS + Reflowable EPUB3 + Media Overlays |
| `image-generation`（已扩展 `--ref`） | 通用出图，Azure gpt-image-2 /generations + /edits |
| `text-to-speech` | 通用 TTS，edge-tts |

第一次使用：按 plan 段顺序实现各 phase，跑 `bun test .claude/skills/` 验证全绿。
```

- [ ] **Step 3：Commit**

```bash
git add README.md
git commit -m "docs: add illustrated audio novel pipeline section to README"
```

---

### Task 7.5：最终自检清单

**Files:** —（不修改文件，纯人工 checklist）

逐项确认；不通过则回到对应 task 修复。

#### 实现完整性

- [ ] 5 个新 skill 目录均存在 SKILL.md
- [ ] image-generation 已支持 `--ref` 参数（Phase 0）
- [ ] novel-foundation-builder/{init-foundation.ts, lib/schemas.ts, lib/voice-assigner.ts} 全部存在且测试通过
- [ ] novel-chapter-workshop/{evaluate-chapter.ts, lib/{slop-scanner,pattern-scanner,scene-marker-parser}.ts} 全部存在且测试通过
- [ ] scene-illustrator/{illustrate-chapter.ts, lib/{anchor-builder,scene-prompt-builder,portrait-manager}.ts} 全部存在且测试通过
- [ ] audio-novel-packager/{package-novel.ts, lib/{chapter-splitter,voice-resolver,epub3-builder}.ts} 全部存在且测试通过
- [ ] illustrated-audio-novel-creator/{lib/{tier-config,state-helpers}.ts, test/integration.test.ts} 全部存在且测试通过

#### references 完整性

- [ ] anti-slop-zh.md / anti-patterns.md / craft-zh.md（共享）
- [ ] edge-tts-voice-catalog.md / style-presets-novel.md（共享）
- [ ] foundation 的 output-schema.md
- [ ] chapter-workshop 的 draft-prompt-template / eval-rubric / scene-marker-spec
- [ ] scene-illustrator 的 character-anchor-spec / recheck-prompt
- [ ] packager 的 voice-mapping
- [ ] 主编排器的 stage-flow / tier-presets / opus-review-prompt

#### 跨 skill 一致性（type 名 / 命名）

- [ ] `Tier` 在 tier-config.ts 与 schemas.ts 中含义一致（都是 "short" | "medium" | "long"）
- [ ] `Phase` 列表在 schemas.ts 与 state-helpers.ts 中一致
- [ ] `Mood` 12 项在 scene-marker-parser.ts 与 scene-prompt-builder.ts 中保持 1:1
- [ ] `Sentence` 类型仅在 chapter-splitter.ts 定义，被 epub3-builder.ts、package-novel.ts 复用
- [ ] state.json schema 在文档（output-schema.md）与 state-helpers.ts 中字段一致

#### 全测试绿

```bash
bun test .claude/skills/
```
- [ ] 全 PASS

#### 文档闭环

- [ ] README.md 含"有声图文小说"小节，指向 spec + plan
- [ ] spec 文件未变（本 plan 不修改 spec）
- [ ] 所有新 skill 的 SKILL.md 描述（description 字段）以"Use when..."开头，符合 superpowers 风格

完成全部勾选后，宣告 plan 实现完成。

---

## Execution Handoff

Plan 完整保存于 `docs/superpowers/plans/2026-05-13-illustrated-audio-novel-plan.md`。两种执行方式：

**1. Subagent-Driven（推荐）** —— 每个 task 派一个新 subagent 执行 + 两阶段 review，迭代快、可并行多个独立 task（如 references 文档与 lib 测试）

**2. Inline Execution** —— 在当前 session 顺序执行，按 phase 检查点回看

请告诉我使用哪种方式继续。

