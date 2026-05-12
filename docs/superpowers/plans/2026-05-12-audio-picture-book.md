# 有声绘本生成系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有静态绘本基础上新增两个 skill，把 `output/<topic>/` 升级为带 EPUB3 Media Overlays 的有声绘本（朗读 + 句级高亮 + 自动翻页）。

**Architecture:** 两个新 skill 协作 —— `text-to-speech` 是原子 skill（1 段文本 → 1 个 mp3 + 1 份时间戳 JSON，镜像 image-generation），`audio-picture-book-creator` 是编排 skill（读 script.md → 派发 tts → 重打包 EPUB3）。完全不动现有 picture-book-creator / image-generation。

**Tech Stack:** Bun + TypeScript（已有），Python venv + edge-tts（新），JSZip（已有），bun:test（新）。

**Spec：** `docs/superpowers/specs/2026-05-12-audio-picture-book-design.md`

---

## 文件结构总览

### 新增文件

```
.claude/skills/text-to-speech/
├── SKILL.md                                # skill 描述与触发关键词
└── scripts/
    ├── generate-audio.ts                   # Bun 入口（CLI + 子进程编排 + json 写出）
    ├── edge_tts_helper.py                  # Python helper（mp3→stdout, WordBoundary→stderr NDJSON）
    ├── lib/
    │   ├── sentence-split.ts               # 中文拆句规则（共享给 audio-picture-book-creator）
    │   ├── timestamp-aggregator.ts         # word boundary → sentence 聚合
    │   └── env.ts                          # venv 路径探测
    └── test/
        ├── sentence-split.test.ts
        └── timestamp-aggregator.test.ts

.claude/skills/audio-picture-book-creator/
├── SKILL.md                                # 编排 skill 描述
├── references/
│   └── media-overlays-spec.md              # EPUB3 SMIL 速查
└── scripts/
    ├── generate-audio-epub.ts              # 主入口：重打包 EPUB3 + Media Overlays
    ├── lib/
    │   ├── parse-script.ts                 # 解析 script.md 提取每页 text
    │   ├── smil-builder.ts                 # 生成 SMIL XML
    │   ├── opf-builder.ts                  # 生成 content.opf
    │   ├── xhtml-builder.ts                # 生成每页 XHTML
    │   └── duration.ts                     # 毫秒 → ISO 8601 PT 格式
    └── test/
        ├── parse-script.test.ts
        ├── smil-builder.test.ts
        ├── opf-builder.test.ts
        ├── xhtml-builder.test.ts
        └── fixtures/
            ├── mini-script.md
            ├── mini-0.png
            ├── mini-0.mp3                  # 预录的极短音频（< 1KB）
            └── mini-0.json
```

### 修改文件

- `package.json` — 新增 `audio-tts` 与 `audio-epub` scripts；新增 dev 依赖 `@types/bun` 已有
- `.gitignore` — 新增 `.venv/`、`node_modules/`（确认）
- `README.md` — 新增"有声绘本"章节，含 setup 与使用说明

### 共享原则

- `sentence-split.ts` 只放在 `text-to-speech/scripts/lib/`。`audio-picture-book-creator` **不重新拆句**，直接消费 tts 产出 json 的 `sentences[]` 字段（避免双份实现）
- `audio-picture-book-creator/scripts/lib/parse-script.ts` 复用现有 `picture-book-creator/scripts/generate-epub.ts` 中的正则模式（不导入，复制 6 行即可，避免跨 skill 依赖）
- 测试用 `bun:test`（Bun 内置，零安装）

---

## Task 1: Setup Python venv 与 edge-tts

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: 在 .gitignore 增加 .venv/**

打开 `.gitignore`，在末尾加：

```
.venv/
```

- [ ] **Step 2: 创建项目 venv 并装 edge-tts**

```bash
cd /Users/jianliwei/personal-repos/picture-book
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install edge-tts
```

- [ ] **Step 3: 验证 edge-tts 可调用**

```bash
.venv/bin/python -c "import edge_tts; print(edge_tts.__version__)"
```

Expected: 输出版本号（如 `7.0.0` 或更高），无 ImportError。

- [ ] **Step 4: 验证中文 Xiaoyi 声音可用**

```bash
.venv/bin/python -c "
import asyncio, edge_tts
async def main():
    c = edge_tts.Communicate('你好世界', 'zh-CN-XiaoyiNeural')
    async for chunk in c.stream():
        if chunk['type'] == 'audio':
            print('audio chunk', len(chunk['data']))
            return
asyncio.run(main())
"
```

Expected: 至少打印一行 `audio chunk <数字>`，无网络/认证错误。

- [ ] **Step 5: 在 README 增加"有声绘本"章节占位**

在 README.md 末尾追加：

```markdown
## 有声绘本（实验功能）

把已生成的静态绘本升级为带朗读、文字高亮、自动翻页的 EPUB3 电子书。

### 一次性 setup

\`\`\`bash
python3 -m venv .venv
.venv/bin/pip install edge-tts
# 可选：装 epubcheck 做结构校验
brew install epubcheck
\`\`\`

### 使用

在 Claude Code 中直接说："给 zhouwu-yuehao 做有声版"，audio-picture-book-creator skill 会自动触发。

### 阅读器建议

- ✅ Apple Books（iOS / macOS）：完整支持朗读 + 高亮 + 翻页
- ✅ Thorium Reader（跨平台）：完整支持
- ⚠️ Kindle / 微信读书：不支持 Media Overlays，仅作为静态 EPUB 显示
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: add .venv to gitignore and document audio-book setup

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: text-to-speech skill 骨架与 SKILL.md

**Files:**
- Create: `.claude/skills/text-to-speech/SKILL.md`

- [ ] **Step 1: 写 SKILL.md**

创建 `.claude/skills/text-to-speech/SKILL.md`：

```markdown
---
name: text-to-speech
description: |
  Use when needing to synthesize one MP3 from one piece of text via edge-tts
  (Microsoft Edge online neural voices). Triggered by audio-picture-book-creator
  (one call per page) or any task that says "生成音频/朗读/TTS/text to speech".
  One invocation = exactly one MP3 + one timestamps JSON. Concurrency, batching
  and retries are caller's responsibility. Requires the project venv at
  <repo>/.venv with edge-tts installed.
---

# Text To Speech

通过 edge-tts 调用微软 Edge 在线神经语音，把一段文本合成一份 mp3 + 一份词/句级时间戳 JSON。

## When to Use

- audio-picture-book-creator 阶段 C 派发的逐页朗读（每页一次调用）
- 任何"text → 1 个 mp3 + 时间戳"的需求

## When NOT to Use

- **音色克隆 / 训练**：edge-tts 不支持，强需求时换 CosyVoice 2
- **批量并发**：本 skill 单次只生成一段。并发由调用方控制（audio-picture-book-creator 限 4 并发）
- **失败自动重试**：本 skill 失败即 `exit 1`。调用方决定是否重试

## Prerequisites

`<repo>/.venv/bin/python` 必须存在且可 `import edge_tts`：

\`\`\`bash
python3 -m venv .venv
.venv/bin/pip install edge-tts
\`\`\`

## Quick Reference

\`\`\`bash
bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --output <mp3 路径>              # 必填，会同时写 <output>.json 在同目录同名
  [--text "<text>"]               # 不传则从 stdin（推荐：长文本 / 含引号）
  [--voice zh-CN-XiaoyiNeural]    # 默认晰晰童声
  [--rate -10%]                   # 默认 -10%（适合儿童）
  [--volume +0%]                  # 默认 +0%
  [--pitch +0Hz]                  # 默认 +0Hz
\`\`\`

退出码：

| 退出码 | 含义 | 调用方应当 |
|---|---|---|
| 0 | mp3 + json 都已写盘 | 继续 |
| 1 | 任意失败 | 读 stderr 判断是否重试 |

## 输出 JSON 格式

\`\`\`json
{
  "voice": "zh-CN-XiaoyiNeural",
  "rate": "-10%",
  "volume": "+0%",
  "pitch": "+0Hz",
  "duration_ms": 4820,
  "text": "毛毛在外婆家过暑假。每天有讲不完的故事。",
  "sentences": [
    {"text": "毛毛在外婆家过暑假。", "start_ms": 0, "end_ms": 1880},
    {"text": "每天有讲不完的故事。", "start_ms": 1920, "end_ms": 4820}
  ],
  "words": [
    {"text": "毛毛", "start_ms": 0, "end_ms": 320}
  ],
  "timestamps_adjusted": false
}
\`\`\`

## Behavior on Error

| stderr 关键字 | 触发条件 | 调用方处置建议 |
|---|---|---|
| `edge-tts 未安装` | venv 不存在或包未装 | 提示用户跑 setup，不重试 |
| `网络错误` | DNS / 连接超时 | 退避 2-5s 重试 |
| `edge-tts 限流` | 服务返回 HTTP 429 | 退避 5-10s 重试 |
| `合成失败：<原文>` | 文本含未支持字符 | 修剪后重试或跳过 |
| `text 为空` | 调用方没传 text | 修复调用代码 |
| `写盘失败` | 磁盘问题 | 检查路径权限 |
\`\`\`

- [ ] **Step 2: 验证文件创建**

```bash
test -f .claude/skills/text-to-speech/SKILL.md && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/text-to-speech/SKILL.md
git commit -m "feat(text-to-speech): add SKILL.md with edge-tts contract

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: sentence-split lib + 测试

中文拆句规则（设计 §6.1）。

**Files:**
- Create: `.claude/skills/text-to-speech/scripts/lib/sentence-split.ts`
- Create: `.claude/skills/text-to-speech/scripts/test/sentence-split.test.ts`

- [ ] **Step 1: 写测试（先红）**

创建 `.claude/skills/text-to-speech/scripts/test/sentence-split.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { splitSentences } from "../lib/sentence-split";

describe("splitSentences", () => {
  test("按。！？切句并保留标点", () => {
    expect(splitSentences("毛毛跑啊跑！前面有什么？小兔子说。")).toEqual([
      "毛毛跑啊跑！",
      "前面有什么？",
      "小兔子说。",
    ]);
  });

  test("引号包裹的对话作为整体不拆", () => {
    expect(splitSentences('他说"我要回家！现在就走"。')).toEqual([
      '他说"我要回家！现在就走"。',
    ]);
  });

  test("「」中文引号同样保护", () => {
    expect(splitSentences("妈妈说「快睡吧。明天再玩」。")).toEqual([
      "妈妈说「快睡吧。明天再玩」。",
    ]);
  });

  test("超过25字的长段按，；二次拆", () => {
    const long = "今天的天气特别好阳光明媚而且没有风，所以我们决定去公园玩耍；带上风筝和野餐垫。";
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(long);
  });

  test("短段不二次拆即使有逗号", () => {
    expect(splitSentences("小猫，跑了。")).toEqual(["小猫，跑了。"]);
  });

  test("句末无标点整段一句", () => {
    expect(splitSentences("毛毛在外婆家过暑假")).toEqual(["毛毛在外婆家过暑假"]);
  });

  test("纯空字符串返回空数组", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  test("过滤空切片", () => {
    expect(splitSentences("！！句子。")).toEqual(["！", "！", "句子。"]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/jianliwei/personal-repos/picture-book
bun test .claude/skills/text-to-speech/scripts/test/sentence-split.test.ts
```

Expected: FAIL，提示 `splitSentences` 未定义或 module not found。

- [ ] **Step 3: 写实现**

创建 `.claude/skills/text-to-speech/scripts/lib/sentence-split.ts`：

```typescript
/**
 * 中文句子拆分。
 *
 * 规则（见 spec §6.1）：
 * - 主分隔符 。！？ 切句并保留标点
 * - 引号 ""「」 包裹的对话作为整体不拆（即引号内的句末标点不触发切分）
 * - 拆出的某段 > 25 字时，按 ，； 二次拆短
 * - 过滤空字符串
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  // 阶段 1：按主分隔符切，但引号内的标点不算
  const primary = splitRespectingQuotes(trimmed, /[。！？]/);

  // 阶段 2：长段二次拆
  const result: string[] = [];
  for (const seg of primary) {
    if (seg.length > 25) {
      const parts = splitRespectingQuotes(seg, /[，；]/);
      for (const p of parts) {
        if (p !== "") result.push(p);
      }
    } else {
      if (seg !== "") result.push(seg);
    }
  }
  return result;
}

/**
 * 按 splitter 切分，但跳过 ""「」 引号内的字符。
 * 切分点保留在前一段末尾。
 */
function splitRespectingQuotes(text: string, splitter: RegExp): string[] {
  const result: string[] = [];
  let buf = "";
  let inDQuote = false;
  let inCQuote = false;

  for (const ch of text) {
    buf += ch;
    if (ch === '"') inDQuote = !inDQuote;
    else if (ch === "「") inCQuote = true;
    else if (ch === "」") inCQuote = false;
    else if (!inDQuote && !inCQuote && splitter.test(ch)) {
      result.push(buf);
      buf = "";
    }
  }
  if (buf !== "") result.push(buf);
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test .claude/skills/text-to-speech/scripts/test/sentence-split.test.ts
```

Expected: 8 pass, 0 fail。如某测试不过，调整正则或边界处理后重跑。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/text-to-speech/scripts/lib/sentence-split.ts \
        .claude/skills/text-to-speech/scripts/test/sentence-split.test.ts
git commit -m "feat(text-to-speech): add sentence-split lib with quote protection

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: timestamp-aggregator lib + 测试

把 edge-tts 的 word boundary 序列聚合成句级时间戳（设计 §6.2 + §6.3）。

**Files:**
- Create: `.claude/skills/text-to-speech/scripts/lib/timestamp-aggregator.ts`
- Create: `.claude/skills/text-to-speech/scripts/test/timestamp-aggregator.test.ts`

- [ ] **Step 1: 写测试**

创建 `.claude/skills/text-to-speech/scripts/test/timestamp-aggregator.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { aggregateToSentences, sanityCheck } from "../lib/timestamp-aggregator";

describe("aggregateToSentences", () => {
  test("把 words 按句子原文位置切片成句级时间戳", () => {
    const text = "毛毛跑了。前面有花。";
    const sentences = ["毛毛跑了。", "前面有花。"];
    const words = [
      { text: "毛毛", start_ms: 0, end_ms: 400 },
      { text: "跑", start_ms: 400, end_ms: 600 },
      { text: "了", start_ms: 600, end_ms: 900 },
      { text: "前面", start_ms: 1100, end_ms: 1500 },
      { text: "有", start_ms: 1500, end_ms: 1700 },
      { text: "花", start_ms: 1700, end_ms: 2000 },
    ];

    const result = aggregateToSentences(text, sentences, words);
    expect(result).toEqual([
      { text: "毛毛跑了。", start_ms: 0, end_ms: 900 },
      { text: "前面有花。", start_ms: 1100, end_ms: 2000 },
    ]);
  });

  test("某句无对应word时取前后句的边界兜底", () => {
    const text = "啊。哈。哦。";
    const sentences = ["啊。", "哈。", "哦。"];
    const words = [
      { text: "啊", start_ms: 0, end_ms: 200 },
      // "哈" 缺失
      { text: "哦", start_ms: 800, end_ms: 1000 },
    ];

    const result = aggregateToSentences(text, sentences, words);
    expect(result[0]).toEqual({ text: "啊。", start_ms: 0, end_ms: 200 });
    expect(result[1]).toEqual({ text: "哈。", start_ms: 200, end_ms: 800 });
    expect(result[2]).toEqual({ text: "哦。", start_ms: 800, end_ms: 1000 });
  });

  test("第一句缺word时start_ms=0", () => {
    const text = "啊。哈。";
    const sentences = ["啊。", "哈。"];
    const words = [{ text: "哈", start_ms: 500, end_ms: 800 }];

    const result = aggregateToSentences(text, sentences, words);
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(500);
  });
});

describe("sanityCheck", () => {
  test("words总时长在mp3 duration ±10%内不调整", () => {
    const sentences = [{ text: "啊", start_ms: 0, end_ms: 1000 }];
    const result = sanityCheck(sentences, 1050);
    expect(result.adjusted).toBe(false);
    expect(result.sentences[0].end_ms).toBe(1000);
  });

  test("words总时长偏差>10%按比例线性重整", () => {
    const sentences = [
      { text: "a", start_ms: 0, end_ms: 500 },
      { text: "b", start_ms: 500, end_ms: 1000 },
    ];
    // 实际 mp3 duration 2000ms，words 报告 1000ms，比例 2x
    const result = sanityCheck(sentences, 2000);
    expect(result.adjusted).toBe(true);
    expect(result.sentences[0].end_ms).toBe(1000);
    expect(result.sentences[1].end_ms).toBe(2000);
  });

  test("words为空时兜底单段", () => {
    const result = sanityCheck([], 3000);
    expect(result.adjusted).toBe(true);
    expect(result.sentences).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test .claude/skills/text-to-speech/scripts/test/timestamp-aggregator.test.ts
```

Expected: FAIL with module not found。

- [ ] **Step 3: 写实现**

创建 `.claude/skills/text-to-speech/scripts/lib/timestamp-aggregator.ts`：

```typescript
export interface Word {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface Sentence {
  text: string;
  start_ms: number;
  end_ms: number;
}

/**
 * 按句子在原文中的位置区间，把 words 分组为句级时间戳。
 * 见 spec §6.2。
 */
export function aggregateToSentences(
  text: string,
  sentences: string[],
  words: Word[]
): Sentence[] {
  // 计算每个句子在原文中的 [charStart, charEnd) 位置
  const positions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of sentences) {
    const idx = text.indexOf(s, cursor);
    positions.push({ start: idx, end: idx + s.length });
    cursor = idx + s.length;
  }

  // 给每个 word 标注它在原文中的字符位置（顺序匹配，避免重复词混淆）
  const wordPositions: Array<{ word: Word; charStart: number }> = [];
  let wcursor = 0;
  for (const w of words) {
    const idx = text.indexOf(w.text, wcursor);
    if (idx === -1) continue; // word 找不到（罕见），跳过
    wordPositions.push({ word: w, charStart: idx });
    wcursor = idx + w.text.length;
  }

  const result: Sentence[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const pos = positions[i]!;
    const matched = wordPositions.filter(
      (wp) => wp.charStart >= pos.start && wp.charStart < pos.end
    );

    if (matched.length > 0) {
      result.push({
        text: sentences[i]!,
        start_ms: matched[0]!.word.start_ms,
        end_ms: matched[matched.length - 1]!.word.end_ms,
      });
    } else {
      // 兜底：取前句 end_ms 作为 start，后句的第一个 word 的 start_ms 作为 end
      const prevEnd = i > 0 ? result[i - 1]!.end_ms : 0;
      let nextStart = 0;
      for (let j = i + 1; j < sentences.length; j++) {
        const npos = positions[j]!;
        const nm = wordPositions.find((wp) => wp.charStart >= npos.start);
        if (nm) {
          nextStart = nm.word.start_ms;
          break;
        }
      }
      if (nextStart === 0) nextStart = prevEnd;
      result.push({
        text: sentences[i]!,
        start_ms: prevEnd,
        end_ms: nextStart,
      });
    }
  }
  return result;
}

/**
 * 时间戳健全性校验（spec §6.3）。
 * 若 words 报告总时长与 mp3 实际 duration 偏差 > 10%，按比例线性重整。
 */
export function sanityCheck(
  sentences: Sentence[],
  actualDurationMs: number
): { sentences: Sentence[]; adjusted: boolean } {
  if (sentences.length === 0) {
    return { sentences: [], adjusted: true };
  }

  const reportedDuration = sentences[sentences.length - 1]!.end_ms;
  if (reportedDuration === 0) {
    return { sentences, adjusted: false };
  }

  const ratio = actualDurationMs / reportedDuration;
  const deviation = Math.abs(ratio - 1);

  if (deviation <= 0.1) {
    return { sentences, adjusted: false };
  }

  const adjusted = sentences.map((s) => ({
    text: s.text,
    start_ms: Math.round(s.start_ms * ratio),
    end_ms: Math.round(s.end_ms * ratio),
  }));
  return { sentences: adjusted, adjusted: true };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test .claude/skills/text-to-speech/scripts/test/timestamp-aggregator.test.ts
```

Expected: 6 pass, 0 fail。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/text-to-speech/scripts/lib/timestamp-aggregator.ts \
        .claude/skills/text-to-speech/scripts/test/timestamp-aggregator.test.ts
git commit -m "feat(text-to-speech): add timestamp aggregator with sanity check

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: env.ts venv 探测 lib

向上查找项目根的 .venv，复用现有 image-generation 的 .env 查找模式。

**Files:**
- Create: `.claude/skills/text-to-speech/scripts/lib/env.ts`

- [ ] **Step 1: 写实现**

创建 `.claude/skills/text-to-speech/scripts/lib/env.ts`：

```typescript
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";

/**
 * 从 cwd 向上递归查找最近的 .venv 目录，返回其中 python 可执行文件的绝对路径。
 * 找不到则返回 null。
 */
export function findVenvPython(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  while (true) {
    const venvPython = join(dir, ".venv", "bin", "python");
    if (existsSync(venvPython)) return venvPython;
    const parent = dirname(dir);
    if (parent === dir) return null; // hit filesystem root
    dir = parent;
  }
}
```

- [ ] **Step 2: 手动验证**

```bash
cd /Users/jianliwei/personal-repos/picture-book
bun -e "console.log(require('./.claude/skills/text-to-speech/scripts/lib/env.ts').findVenvPython())"
```

Expected: 输出 `/Users/jianliwei/personal-repos/picture-book/.venv/bin/python`。

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/text-to-speech/scripts/lib/env.ts
git commit -m "feat(text-to-speech): add venv python locator

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: edge_tts_helper.py

Python 子进程：mp3 二进制流到 stdout，WordBoundary 事件每行 JSON 到 stderr。

**Files:**
- Create: `.claude/skills/text-to-speech/scripts/edge_tts_helper.py`

- [ ] **Step 1: 写实现**

创建 `.claude/skills/text-to-speech/scripts/edge_tts_helper.py`：

```python
#!/usr/bin/env python3
"""
edge-tts helper: 把一段文本合成为 mp3 + WordBoundary 序列。

调用方约定（与 generate-audio.ts 配套）：
  - 文本从 stdin 读
  - 参数从 argv 解析: --voice / --rate / --volume / --pitch
  - mp3 二进制 chunks → stdout
  - WordBoundary 事件 → stderr，每行一个 JSON：
      {"offset_us": 1230000, "duration_us": 320000, "text": "毛毛"}
  - 完成后 stderr 末行：{"type":"done"}
  - 出错：stderr 单行 {"type":"error","message":"..."}，exit 1
"""
import asyncio
import json
import sys
import argparse

import edge_tts


async def synth(text: str, voice: str, rate: str, volume: str, pitch: str) -> int:
    try:
        communicate = edge_tts.Communicate(
            text, voice, rate=rate, volume=volume, pitch=pitch
        )
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"参数非法: {e}"}), file=sys.stderr)
        return 1

    try:
        async for chunk in communicate.stream():
            t = chunk.get("type")
            if t == "audio":
                sys.stdout.buffer.write(chunk["data"])
            elif t == "WordBoundary":
                # offset / duration are in 100ns ticks (微软标准)
                # 转换为微秒：ticks / 10
                event = {
                    "offset_us": chunk["offset"] // 10,
                    "duration_us": chunk["duration"] // 10,
                    "text": chunk["text"],
                }
                print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)
    except edge_tts.exceptions.NoAudioReceived:
        print(json.dumps({"type": "error", "message": "合成失败：服务未返回音频，可能是文本含未支持字符"}), file=sys.stderr)
        return 1
    except Exception as e:
        msg = str(e)
        if "429" in msg:
            print(json.dumps({"type": "error", "message": "edge-tts 限流"}), file=sys.stderr)
        elif "ConnectError" in type(e).__name__ or "Timeout" in type(e).__name__:
            print(json.dumps({"type": "error", "message": "网络错误"}), file=sys.stderr)
        else:
            print(json.dumps({"type": "error", "message": f"合成失败：{msg}"}), file=sys.stderr)
        return 1

    sys.stdout.buffer.flush()
    print(json.dumps({"type": "done"}), file=sys.stderr, flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural")
    parser.add_argument("--rate", default="-10%")
    parser.add_argument("--volume", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        print(json.dumps({"type": "error", "message": "text 为空"}), file=sys.stderr)
        return 1

    return asyncio.run(synth(text, args.voice, args.rate, args.volume, args.pitch))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 手动验证 stdin → stdout/stderr**

```bash
cd /Users/jianliwei/personal-repos/picture-book
echo "你好世界。今天天气真好。" | \
  .venv/bin/python .claude/skills/text-to-speech/scripts/edge_tts_helper.py \
    --voice zh-CN-XiaoyiNeural \
    > /tmp/test.mp3 2> /tmp/test.events
echo "exit=$?  mp3 size=$(wc -c < /tmp/test.mp3)  events:"
cat /tmp/test.events
```

Expected:
- exit=0
- mp3 size > 5000
- events 文件包含若干 `{"offset_us": ..., "duration_us": ..., "text": "..."}` 行 + 最后 `{"type":"done"}`

- [ ] **Step 3: 验证 mp3 可播放（可选）**

```bash
file /tmp/test.mp3
# Expected: ".../test.mp3: Audio file with ID3 ..."  或 "MPEG ADTS, layer III"
```

- [ ] **Step 4: 验证空 stdin 报错**

```bash
echo "" | .venv/bin/python .claude/skills/text-to-speech/scripts/edge_tts_helper.py
echo "exit=$?"
```

Expected: stderr 输出 `{"type":"error","message":"text 为空"}`，exit=1。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/text-to-speech/scripts/edge_tts_helper.py
git commit -m "feat(text-to-speech): add Python edge-tts helper streaming mp3+wordboundary

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: generate-audio.ts 主入口

CLI 入口：解析参数 → 启动 Python 子进程 → 收集 mp3+events → 拆句聚合 → 写 mp3+json。

**Files:**
- Create: `.claude/skills/text-to-speech/scripts/generate-audio.ts`

- [ ] **Step 1: 写实现**

创建 `.claude/skills/text-to-speech/scripts/generate-audio.ts`：

```typescript
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
 *   - 启动 <repo>/.venv/bin/python edge_tts_helper.py 子进程
 *   - 文本经 stdin 喂入 helper
 *   - helper stdout (mp3 二进制) → 写到 <output>
 *   - helper stderr (NDJSON WordBoundary 事件) → 收集后转换为 words[]
 *   - 调用 splitSentences + aggregateToSentences + sanityCheck
 *   - 写 <output>.json（同名不同扩展名）
 *   - 任何步骤失败：stderr 单行错误 + exit 1
 */
import { parseArgs } from "util";
import { spawn } from "child_process";
import { writeFile, readFile } from "fs/promises";
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
    "edge-tts 未安装。请在项目根运行：\n" +
      "  python3 -m venv .venv\n" +
      "  .venv/bin/pip install edge-tts"
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
  "edge_tts_helper.py"
);
if (!existsSync(helperPath)) {
  console.error(`edge_tts_helper.py 缺失: ${helperPath}`);
  process.exit(1);
}

const proc = spawn(
  python,
  [
    helperPath,
    "--voice",
    values.voice!,
    "--rate",
    values.rate!,
    "--volume",
    values.volume!,
    "--pitch",
    values.pitch!,
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
```

- [ ] **Step 2: 手动 smoke 测试（短文本）**

```bash
cd /Users/jianliwei/personal-repos/picture-book
bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --text "你好。今天真开心。" \
  --output /tmp/tts-smoke.mp3
echo "exit=$?"
ls -la /tmp/tts-smoke.mp3 /tmp/tts-smoke.json
cat /tmp/tts-smoke.json | head -40
```

Expected:
- exit=0
- mp3 文件 > 5KB
- json 包含 sentences=2, voice=zh-CN-XiaoyiNeural, rate=-10%
- words 数组非空

- [ ] **Step 3: 手动 stdin 模式测试**

```bash
echo "毛毛在外婆家过暑假。每天有讲不完的故事。" | \
  bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
    --output /tmp/tts-stdin.mp3
echo "exit=$?"
```

Expected: exit=0，两文件生成。

- [ ] **Step 4: 错误路径测试 — 缺 venv（临时改名验证）**

```bash
mv .venv .venv-bak
bun run .claude/skills/text-to-speech/scripts/generate-audio.ts --text "x" --output /tmp/x.mp3
echo "exit=$?"
mv .venv-bak .venv
```

Expected: stderr 包含 "edge-tts 未安装"，exit=1。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/text-to-speech/scripts/generate-audio.ts
git commit -m "feat(text-to-speech): add Bun entry orchestrating Python helper

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: package.json 增加 audio scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 读现有 package.json**

```bash
cat package.json
```

- [ ] **Step 2: 增加两个 scripts**

把 `package.json` 的 `scripts` 段从：

```json
"scripts": {
  "image": "bun run .claude/skills/image-generation/scripts/generate-image.ts",
  "epub": "bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts"
}
```

改为：

```json
"scripts": {
  "image": "bun run .claude/skills/image-generation/scripts/generate-image.ts",
  "epub": "bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts",
  "audio": "bun run .claude/skills/text-to-speech/scripts/generate-audio.ts",
  "audio-epub": "bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts",
  "test": "bun test .claude/skills/"
}
```

- [ ] **Step 3: 验证 test script 工作**

```bash
bun run test
```

Expected: 跑出 sentence-split + timestamp-aggregator 的所有测试，全部 pass。

- [ ] **Step 4: 验证 audio script alias**

```bash
echo "你好" | bun run audio --output /tmp/alias-test.mp3
ls /tmp/alias-test.mp3 /tmp/alias-test.json
```

Expected: 两文件生成。

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add audio + audio-epub + test bun scripts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: audio-picture-book-creator SKILL.md 与 references

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/SKILL.md`
- Create: `.claude/skills/audio-picture-book-creator/references/media-overlays-spec.md`

- [ ] **Step 1: 写 SKILL.md**

创建 `.claude/skills/audio-picture-book-creator/SKILL.md`：

```markdown
---
name: audio-picture-book-creator
description: |
  把已有的静态绘本 output/<topic>/ 升级为有声绘本 EPUB3
  （带 Media Overlays，朗读时自动高亮文字、翻页）。
  当用户说"加声音 / 给绘本配音 / 做有声版 / 朗读 / read-aloud /
  audio book / 有声书"时使用此 skill。
  补声型：在已有 picture-book-creator 产出之上追加，不重新生成图。
---

# Audio Picture Book Creator

把 `output/<topic>/` 中的静态绘本（图 + script.md）升级为带朗读高亮的 EPUB3 Media Overlays 电子书。

## 核心原则

- **补声型**：消费已有的 `script.md` + `<n>.png`，只生成音频与有声 EPUB
- **零侵入**：不动 picture-book-creator 产物（原 `<书名>.epub` 保留）
- **同级输出**：有声 EPUB 与原静态 EPUB 同级并存，文件名加 `-audio` 后缀

## 阶段 A：定位与清单

1. 列出 `output/` 下所有可补声的目录（含 `script.md` + 至少 1 张 `<n>.png`）
2. 用户选定 `<topic>`（若初始 prompt 已包含名字则跳过）
3. 解析 `script.md`，提取每页的 `text` 字段，生成 manifest（页号 → 朗读文本）
4. 封面页（page 0）默认朗读 `text` 字段（即书名）；若 `text` 为空字符串则跳过封面音频

## 阶段 B：声音参数确认

默认：`voice=zh-CN-XiaoyiNeural`（晰晰童声）、`rate=-10%`、`volume=+0%`、`pitch=+0Hz`

候选音色：
- `zh-CN-XiaoyiNeural` 晰晰（童声女孩，默认）
- `zh-CN-XiaoxiaoNeural` 晓晓（成年女声，故事感强）
- `zh-CN-YunxiNeural` 云希（成年男声，温暖）

询问用户是否调整；若初始 prompt 已指定则跳过。

## 阶段 C：并行生成音频

为 page 0 ~ N 每页调用 `text-to-speech` skill。skill 声明 `context: fork`，系统自动派发。

调用方式：每个 fork 收到形如 `text: <page text> | output: <path>` 的指令，应当：
1. 把 `<text>` 通过 stdin 喂给 generate-audio.ts（heredoc 最稳）
2. 把 `<path>` 作为 `--output` 传入
3. 默认补 `--voice zh-CN-XiaoyiNeural --rate -10%`

并发限制：每批 4 页，与图像生成节奏一致。

输出：`output/<topic>/audio/{0..N}.mp3` + `{0..N}.json`

验证：每页 mp3 > 5KB 且 json 存在；失败页报告并提供重试 / 跳过 / 中止选项。

## 阶段 D：重打包 EPUB3 Media Overlays

调用：

\`\`\`bash
bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
  --topic-dir output/<topic> \
  --title "<书名>" \
  --author "<作者>" \
  --lang zh \
  --voice zh-CN-XiaoyiNeural
\`\`\`

输出：`output/<topic>/<书名>-audio.epub`（与原 `<书名>.epub` 同级并存）

## 阶段间流转

| 流转 | 触发 |
|---|---|
| A → B | 自动（找到 topic 后立即询问声音） |
| B → C | 用户确认声音参数 |
| C → D | 音频验证全部通过则自动 |
| 任何失败 | 报错退出，不破坏现有 output/ |

## 智能跳过

- prompt 含 topic 名字 → 跳过 A
- prompt 含声音偏好 → 跳过 B

## 阅读器建议

- ✅ Apple Books（iOS / macOS）：完整支持
- ✅ Thorium Reader：完整支持
- ⚠️ Kindle / 微信读书：不支持 Media Overlays，仅显示静态 EPUB
```

- [ ] **Step 2: 写 references/media-overlays-spec.md**

创建 `.claude/skills/audio-picture-book-creator/references/media-overlays-spec.md`：

```markdown
# EPUB3 Media Overlays 速查

## 文件结构（OEBPS/ 内）

\`\`\`
OEBPS/
├── content.opf
├── nav.xhtml
├── page-0.xhtml ~ page-N.xhtml
├── images/0.png ~ N.png
├── audio/0.mp3 ~ N.mp3
└── smil/page-0.smil ~ page-N.smil
\`\`\`

## SMIL 文件示例

\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"
      xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq1" epub:textref="../page-1.xhtml" epub:type="bodymatter chapter">
      <par id="par1-1">
        <text src="../page-1.xhtml#p1-s1"/>
        <audio src="../audio/1.mp3" clipBegin="0ms" clipEnd="1880ms"/>
      </par>
    </seq>
  </body>
</smil>
\`\`\`

## content.opf 关键字段

\`\`\`xml
<metadata>
  <meta property="media:duration" refines="#smil-1">PT4.820S</meta>
  <meta property="media:duration">PT58.300S</meta>
  <meta property="media:active-class">-epub-media-overlay-active</meta>
  <meta property="media:narrator">zh-CN-XiaoyiNeural</meta>
</metadata>

<manifest>
  <item id="page-1"  href="page-1.xhtml"     media-type="application/xhtml+xml"
        media-overlay="smil-1"/>
  <item id="audio-1" href="audio/1.mp3"      media-type="audio/mpeg"/>
  <item id="smil-1"  href="smil/page-1.smil" media-type="application/smil+xml"/>
</manifest>
\`\`\`

## ISO 8601 PT 时长格式

毫秒转换：`5230 ms` → `PT5.230S`，`62500 ms` → `PT62.500S`

## XHTML 高亮锚点

每个可朗读句包成可寻址 span：

\`\`\`html
<p class="caption">
  <span id="p1-s1">毛毛在外婆家过暑假。</span>
  <span id="p1-s2">每天有讲不完的故事。</span>
</p>
\`\`\`

CSS 中 `-epub-media-overlay-active` 类会在朗读到对应句时自动激活。
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/SKILL.md \
        .claude/skills/audio-picture-book-creator/references/media-overlays-spec.md
git commit -m "feat(audio-picture-book-creator): add SKILL.md and SMIL spec reference

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: parse-script lib + 测试

读 script.md 提取每页 text 字段。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/lib/parse-script.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/parse-script.test.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-script.md`

- [ ] **Step 1: 写 fixture**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-script.md`：

```markdown
# 《测试绘本》分页脚本

---

## 第 0 页（封面）

**text**：测试绘本
**scene**：略
**composition**：略

---

## 第 1 页

**text**：毛毛跑啊跑。前面有花。
**scene**：略
**emotion**：开心

---

## 第 2 页

**text**：小猫笑了。
**scene**：略
```

- [ ] **Step 2: 写测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/parse-script.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { parseScript } from "../lib/parse-script";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures/mini-script.md");

describe("parseScript", () => {
  test("提取每页的 text 字段", async () => {
    const pages = await parseScript(fixture);
    expect(pages).toEqual([
      { pageNum: 0, text: "测试绘本" },
      { pageNum: 1, text: "毛毛跑啊跑。前面有花。" },
      { pageNum: 2, text: "小猫笑了。" },
    ]);
  });

  test("缺失文件抛错", async () => {
    await expect(parseScript("/nonexistent.md")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/parse-script.test.ts
```

Expected: FAIL with module not found。

- [ ] **Step 4: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/lib/parse-script.ts`：

```typescript
import { readFile } from "fs/promises";

export interface PageText {
  pageNum: number;
  text: string;
}

/**
 * 解析 picture-book-creator 产出的 script.md，提取每页的 text 字段。
 *
 * 复用现有 generate-epub.ts 中的正则模式（见 picture-book-creator/scripts/generate-epub.ts:57）。
 */
export async function parseScript(scriptPath: string): Promise<PageText[]> {
  const content = await readFile(scriptPath, "utf-8");
  const pattern = /## 第 (\d+) 页[\s\S]*?\*\*text\*\*[：:]\s*(.+)/g;
  const result: PageText[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    result.push({
      pageNum: parseInt(match[1]!, 10),
      text: match[2]!.trim(),
    });
  }
  return result.sort((a, b) => a.pageNum - b.pageNum);
}
```

- [ ] **Step 5: 运行确认通过**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/parse-script.test.ts
```

Expected: 2 pass, 0 fail。

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/lib/parse-script.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/parse-script.test.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-script.md
git commit -m "feat(audio-picture-book-creator): add script.md parser

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: duration lib（毫秒 → ISO 8601 PT 格式）

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/lib/duration.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/duration.test.ts`

- [ ] **Step 1: 写测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/duration.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { msToISO8601, msToClipMs } from "../lib/duration";

describe("msToISO8601", () => {
  test("常规毫秒转 PT 格式", () => {
    expect(msToISO8601(4820)).toBe("PT4.820S");
    expect(msToISO8601(0)).toBe("PT0.000S");
    expect(msToISO8601(62500)).toBe("PT62.500S");
  });

  test("整秒补三位小数", () => {
    expect(msToISO8601(5000)).toBe("PT5.000S");
  });
});

describe("msToClipMs", () => {
  test("毫秒转 SMIL clipBegin 格式", () => {
    expect(msToClipMs(0)).toBe("0ms");
    expect(msToClipMs(1880)).toBe("1880ms");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/duration.test.ts
```

- [ ] **Step 3: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/lib/duration.ts`：

```typescript
/**
 * 毫秒 → EPUB3 media:duration 的 ISO 8601 PT 格式。
 * 例：4820 → "PT4.820S"
 */
export function msToISO8601(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const millis = ms % 1000;
  return `PT${seconds}.${String(millis).padStart(3, "0")}S`;
}

/**
 * 毫秒 → SMIL clipBegin/clipEnd 的 "Nms" 格式。
 */
export function msToClipMs(ms: number): string {
  return `${ms}ms`;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/duration.test.ts
```

Expected: 3 pass。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/lib/duration.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/duration.test.ts
git commit -m "feat(audio-picture-book-creator): add duration formatters

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: smil-builder + 测试

把句级时间戳转成单页 SMIL XML。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/lib/smil-builder.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/smil-builder.test.ts`

- [ ] **Step 1: 写测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/smil-builder.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { buildSmil } from "../lib/smil-builder";

describe("buildSmil", () => {
  test("生成包含 par 元素的 well-formed SMIL", () => {
    const smil = buildSmil({
      pageNum: 1,
      sentences: [
        { text: "啊。", start_ms: 0, end_ms: 1000 },
        { text: "哈。", start_ms: 1000, end_ms: 2000 },
      ],
    });

    expect(smil).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(smil).toContain('xmlns="http://www.w3.org/ns/SMIL"');
    expect(smil).toContain('epub:textref="../page-1.xhtml"');
    expect(smil).toContain('id="seq1"');
    expect(smil).toContain('<text src="../page-1.xhtml#p1-s1"/>');
    expect(smil).toContain('<text src="../page-1.xhtml#p1-s2"/>');
    expect(smil).toContain('clipBegin="0ms"');
    expect(smil).toContain('clipEnd="1000ms"');
    expect(smil).toContain('clipBegin="1000ms"');
    expect(smil).toContain('clipEnd="2000ms"');
    expect(smil).toContain('src="../audio/1.mp3"');
  });

  test("封面页 page 0 同样工作", () => {
    const smil = buildSmil({
      pageNum: 0,
      sentences: [{ text: "标题", start_ms: 0, end_ms: 1500 }],
    });
    expect(smil).toContain('id="seq0"');
    expect(smil).toContain('epub:textref="../page-0.xhtml"');
    expect(smil).toContain('src="../audio/0.mp3"');
    expect(smil).toContain('id="par0-1"');
  });

  test("空 sentences 生成空 seq", () => {
    const smil = buildSmil({ pageNum: 1, sentences: [] });
    expect(smil).toContain("<seq");
    expect(smil).not.toContain("<par");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/smil-builder.test.ts
```

- [ ] **Step 3: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/lib/smil-builder.ts`：

```typescript
import { msToClipMs } from "./duration";

export interface Sentence {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface BuildSmilInput {
  pageNum: number;
  sentences: Sentence[];
}

/**
 * 生成单页 SMIL 文件内容。
 * 输出位置约定：OEBPS/smil/page-N.smil
 * 引用约定：xhtml 在 ../page-N.xhtml，audio 在 ../audio/N.mp3
 */
export function buildSmil(input: BuildSmilInput): string {
  const { pageNum, sentences } = input;
  const pars = sentences
    .map((_, i) => {
      const sIdx = i + 1;
      return `      <par id="par${pageNum}-${sIdx}">
        <text src="../page-${pageNum}.xhtml#p${pageNum}-s${sIdx}"/>
        <audio src="../audio/${pageNum}.mp3" clipBegin="${msToClipMs(
        sentences[i]!.start_ms
      )}" clipEnd="${msToClipMs(sentences[i]!.end_ms)}"/>
      </par>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"
      xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq${pageNum}" epub:textref="../page-${pageNum}.xhtml" epub:type="bodymatter chapter">
${pars}
    </seq>
  </body>
</smil>`;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/smil-builder.test.ts
```

Expected: 3 pass。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/lib/smil-builder.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/smil-builder.test.ts
git commit -m "feat(audio-picture-book-creator): add SMIL builder

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 13: xhtml-builder + 测试

生成每页 XHTML（图 + caption span）。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/lib/xhtml-builder.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/xhtml-builder.test.ts`

- [ ] **Step 1: 写测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/xhtml-builder.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { buildPageXhtml } from "../lib/xhtml-builder";

describe("buildPageXhtml", () => {
  test("生成包含 img 与可朗读 span 的 XHTML", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: ["毛毛跑了。", "前面有花。"],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });

    expect(xhtml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xhtml).toContain("<!DOCTYPE html>");
    expect(xhtml).toContain('<meta name="viewport" content="width=2048, height=2048"/>');
    expect(xhtml).toContain('src="images/1.png"');
    expect(xhtml).toContain('<span id="p1-s1">毛毛跑了。</span>');
    expect(xhtml).toContain('<span id="p1-s2">前面有花。</span>');
    expect(xhtml).toContain(".-epub-media-overlay-active");
  });

  test("封面页 page 0 同样工作", () => {
    const xhtml = buildPageXhtml({
      pageNum: 0,
      imageFile: "0.png",
      sentences: ["测试绘本"],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain('src="images/0.png"');
    expect(xhtml).toContain('<span id="p0-s1">测试绘本</span>');
  });

  test("XML 特殊字符被转义", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: ['他说"你好"。'],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain("&quot;你好&quot;");
  });

  test("空 sentences 生成无 caption 内容的页", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: [],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain('src="images/1.png"');
    expect(xhtml).not.toContain("<span");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/xhtml-builder.test.ts
```

- [ ] **Step 3: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/lib/xhtml-builder.ts`：

```typescript
export interface BuildPageXhtmlInput {
  pageNum: number;
  imageFile: string;        // 如 "1.png"
  sentences: string[];      // 已拆好的句子（直接来自 tts 产出 json 的 sentences[].text）
  viewportWidth: number;
  viewportHeight: number;
}

export function buildPageXhtml(input: BuildPageXhtmlInput): string {
  const { pageNum, imageFile, sentences, viewportWidth, viewportHeight } = input;

  const spans = sentences
    .map(
      (s, i) =>
        `    <span id="p${pageNum}-s${i + 1}">${escapeXml(s)}</span>`
    )
    .join("\n");

  const captionBlock =
    sentences.length > 0
      ? `\n  <p class="caption">\n${spans}\n  </p>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${viewportWidth}, height=${viewportHeight}"/>
  <title>第 ${pageNum} 页</title>
  <style>
    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
    img { display:block; width:100%; height:100%; object-fit:contain; }
    .caption { position:absolute; bottom:2%; left:5%; right:5%;
               text-align:center; font-size:2.5em; color:#333;
               font-family:serif; line-height:1.6; margin:0; }
    .caption .-epub-media-overlay-active { background:#fff5b3; }
  </style>
</head>
<body>
  <img src="images/${imageFile}" alt="第${pageNum}页"/>${captionBlock}
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
```

- [ ] **Step 4: 运行确认通过**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/xhtml-builder.test.ts
```

Expected: 4 pass。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/lib/xhtml-builder.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/xhtml-builder.test.ts
git commit -m "feat(audio-picture-book-creator): add XHTML page builder

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 14: opf-builder + 测试

生成 EPUB3 content.opf（带 Media Overlays metadata）。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/lib/opf-builder.ts`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/opf-builder.test.ts`

- [ ] **Step 1: 写测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/opf-builder.test.ts`：

```typescript
import { describe, expect, test } from "bun:test";
import { buildOpf } from "../lib/opf-builder";

describe("buildOpf", () => {
  test("含 media-overlay 引用的 manifest", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-1",
      title: "测试绘本",
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [
        { pageNum: 0, durationMs: 2000 },
        { pageNum: 1, durationMs: 4820 },
        { pageNum: 2, durationMs: 3500 },
      ],
    });

    expect(opf).toContain("<dc:title>测试绘本</dc:title>");
    expect(opf).toContain("<dc:creator>AI</dc:creator>");
    expect(opf).toContain("<dc:language>zh</dc:language>");
    expect(opf).toContain('<meta property="media:duration">PT10.320S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-0">PT2.000S</meta>');
    expect(opf).toContain('<meta property="media:duration" refines="#smil-1">PT4.820S</meta>');
    expect(opf).toContain('<meta property="media:active-class">-epub-media-overlay-active</meta>');
    expect(opf).toContain('<meta property="media:narrator">zh-CN-XiaoyiNeural</meta>');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');

    // 封面
    expect(opf).toContain('href="images/0.png"');
    expect(opf).toContain('properties="cover-image"');

    // 每页 page xhtml + media-overlay
    expect(opf).toContain('id="page-1" href="page-1.xhtml" media-type="application/xhtml+xml" media-overlay="smil-1"');
    expect(opf).toContain('id="audio-1" href="audio/1.mp3" media-type="audio/mpeg"');
    expect(opf).toContain('id="smil-1" href="smil/page-1.smil" media-type="application/smil+xml"');
    expect(opf).toContain('id="img-1" href="images/1.png" media-type="image/png"');

    // spine 含每页
    expect(opf).toContain('<itemref idref="cover"/>');
    expect(opf).toContain('<itemref idref="page-1"/>');
    expect(opf).toContain('<itemref idref="page-2"/>');

    // nav
    expect(opf).toContain('properties="nav"');
  });

  test("page 0 text 为空时仍出现在 manifest 但无 media-overlay", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-2",
      title: "无封面音频",
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [
        { pageNum: 0, durationMs: 0 },  // 0 表示无音频
        { pageNum: 1, durationMs: 3000 },
      ],
    });

    expect(opf).toContain('id="cover" href="page-0.xhtml" media-type="application/xhtml+xml"');
    expect(opf).not.toContain('id="cover" href="page-0.xhtml" media-type="application/xhtml+xml" media-overlay');
    expect(opf).toContain('media-overlay="smil-1"');
  });

  test("XML 特殊字符被转义", () => {
    const opf = buildOpf({
      bookId: "urn:uuid:test-3",
      title: '<script>"邪恶"&',
      author: "AI",
      lang: "zh",
      voice: "zh-CN-XiaoyiNeural",
      modifiedISO: "2026-05-12T00:00:00Z",
      pages: [{ pageNum: 0, durationMs: 1000 }],
    });
    expect(opf).toContain("&lt;script&gt;&quot;邪恶&quot;&amp;");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/opf-builder.test.ts
```

- [ ] **Step 3: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/lib/opf-builder.ts`：

```typescript
import { msToISO8601 } from "./duration";

export interface PageMeta {
  pageNum: number;
  durationMs: number;       // 0 表示该页无音频（封面 text 为空）
}

export interface BuildOpfInput {
  bookId: string;
  title: string;
  author: string;
  lang: string;
  voice: string;
  modifiedISO: string;
  pages: PageMeta[];        // 必须按 pageNum 升序，page 0 为封面
}

/**
 * 生成 EPUB3 content.opf。
 * 约定：page 0 是封面，其他页是正文。
 * 路径全部相对 OEBPS/ 根。
 */
export function buildOpf(input: BuildOpfInput): string {
  const { bookId, title, author, lang, voice, modifiedISO, pages } = input;

  const totalDurationMs = pages.reduce((acc, p) => acc + p.durationMs, 0);

  // metadata: media:duration refines per smil
  const durationRefines = pages
    .filter((p) => p.durationMs > 0)
    .map(
      (p) =>
        `    <meta property="media:duration" refines="#smil-${p.pageNum}">${msToISO8601(
          p.durationMs
        )}</meta>`
    )
    .join("\n");

  // manifest items
  const manifestItems: string[] = [];

  for (const p of pages) {
    const isCover = p.pageNum === 0;
    const xhtmlId = isCover ? "cover" : `page-${p.pageNum}`;
    const xhtmlHref = `page-${p.pageNum}.xhtml`;
    const overlayAttr =
      p.durationMs > 0 ? ` media-overlay="smil-${p.pageNum}"` : "";

    manifestItems.push(
      `    <item id="${xhtmlId}" href="${xhtmlHref}" media-type="application/xhtml+xml"${overlayAttr}/>`
    );

    // image
    const imgProp = isCover ? ` properties="cover-image"` : "";
    manifestItems.push(
      `    <item id="img-${p.pageNum}" href="images/${p.pageNum}.png" media-type="image/png"${imgProp}/>`
    );

    // audio + smil（仅当有音频）
    if (p.durationMs > 0) {
      manifestItems.push(
        `    <item id="audio-${p.pageNum}" href="audio/${p.pageNum}.mp3" media-type="audio/mpeg"/>`
      );
      manifestItems.push(
        `    <item id="smil-${p.pageNum}" href="smil/page-${p.pageNum}.smil" media-type="application/smil+xml"/>`
      );
    }
  }

  manifestItems.push(
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
  );

  // spine
  const spineItems = pages
    .map((p) => {
      const idref = p.pageNum === 0 ? "cover" : `page-${p.pageNum}`;
      return `    <itemref idref="${idref}"/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(lang)}</dc:language>
    <dc:date>${modifiedISO}</dc:date>
    <meta property="dcterms:modified">${modifiedISO}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="media:duration">${msToISO8601(totalDurationMs)}</meta>
${durationRefines}
    <meta property="media:active-class">-epub-media-overlay-active</meta>
    <meta property="media:narrator">${escapeXml(voice)}</meta>
    <meta name="cover" content="img-0"/>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: 运行确认通过**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/opf-builder.test.ts
```

Expected: 3 pass。

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/lib/opf-builder.ts \
        .claude/skills/audio-picture-book-creator/scripts/test/opf-builder.test.ts
git commit -m "feat(audio-picture-book-creator): add content.opf builder with media overlays

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 15: generate-audio-epub.ts 主入口

整合所有 builders，从 `output/<topic>/` 重打包成 EPUB3 Media Overlays。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts`

- [ ] **Step 1: 写实现**

创建 `.claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts`：

```typescript
/**
 * 把已有静态绘本 output/<topic>/ + audio/ 子目录重打包成 EPUB3 Media Overlays。
 *
 * 用法：
 *   bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
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
const epubcheck = spawnSync("which", ["epubcheck"], { encoding: "utf-8" });
if (epubcheck.status === 0) {
  console.log("\n=== epubcheck ===");
  const result = spawnSync("epubcheck", [outputPath], { stdio: "inherit" });
  if (result.status !== 0) {
    console.warn("epubcheck 报告问题，请检查上方输出");
  }
} else {
  console.log("\n未检测到 epubcheck，跳过结构校验。");
  console.log("建议安装：brew install epubcheck");
}
```

- [ ] **Step 2: Commit（实现单独提交，集成测试在 Task 16）**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts
git commit -m "feat(audio-picture-book-creator): add EPUB3 Media Overlays packager

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 16: 集成测试 — fixture 端到端打包

不依赖外部 API：用预录的极小 mp3 + 手写 json 跑完整打包，断言生成的 EPUB 结构正确。

**Files:**
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/0.png`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/1.png`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/script.md`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/0.mp3`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/0.json`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/1.mp3`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/1.json`
- Create: `.claude/skills/audio-picture-book-creator/scripts/test/integration.test.ts`

- [ ] **Step 1: 创建 mini png fixtures（1×1 红色 PNG）**

```bash
mkdir -p .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio

# 写一个 1x1 红色 PNG（67 字节）作为最小有效 png
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\xa3\xc1\x10\xb1\x00\x00\x00\x00IEND\xaeB`\x82' \
  > .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/0.png

cp .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/0.png \
   .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/1.png

# 验证大小约 67 字节
ls -la .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/*.png
```

Expected: 两个 png 文件 ~67 字节。

- [ ] **Step 2: 创建 mini script.md**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/script.md`：

```markdown
# 《迷你测试》分页脚本

---

## 第 0 页（封面）

**text**：迷你测试
**scene**：测试封面

---

## 第 1 页

**text**：你好。再见。
**scene**：测试正文
```

- [ ] **Step 3: 用真实 tts 生成 fixture 音频（一次性，纳入 git）**

```bash
echo "迷你测试" | bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --output .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/0.mp3
echo "你好。再见。" | bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --output .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/1.mp3

ls -la .claude/skills/audio-picture-book-creator/scripts/test/fixtures/mini-book/audio/
```

Expected: 4 个文件（0/1.mp3 + 0/1.json），mp3 各 ~10-20KB。

> 注：fixture 一次生成后纳入 git 作为离线测试资源；CI 不再调 edge-tts，避免依赖网络。

- [ ] **Step 4: 写集成测试**

创建 `.claude/skills/audio-picture-book-creator/scripts/test/integration.test.ts`：

```typescript
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { spawnSync } from "child_process";
import { existsSync, statSync, rmSync, readFileSync } from "fs";
import JSZip from "jszip";

const fixtureDir = join(import.meta.dir, "fixtures/mini-book");
const epubPath = join(fixtureDir, "迷你测试-audio.epub");

describe("integration: generate-audio-epub", () => {
  beforeAll(() => {
    if (existsSync(epubPath)) rmSync(epubPath);
  });

  afterAll(() => {
    if (existsSync(epubPath)) rmSync(epubPath);
  });

  test("从 fixture 打包出有效 EPUB3 Media Overlays", async () => {
    const result = spawnSync(
      "bun",
      [
        "run",
        ".claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts",
        "--topic-dir",
        fixtureDir,
        "--title",
        "迷你测试",
        "--author",
        "Tester",
        "--lang",
        "zh",
        "--voice",
        "zh-CN-XiaoyiNeural",
      ],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);
    expect(existsSync(epubPath)).toBe(true);
    expect(statSync(epubPath).size).toBeGreaterThan(10000);

    // 校验 epub 内部结构
    const buf = readFileSync(epubPath);
    const zip = await JSZip.loadAsync(buf);

    // 必备文件存在
    expect(zip.file("mimetype")).not.toBeNull();
    expect(zip.file("META-INF/container.xml")).not.toBeNull();
    expect(zip.file("OEBPS/content.opf")).not.toBeNull();
    expect(zip.file("OEBPS/nav.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/page-0.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/page-1.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/images/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/1.png")).not.toBeNull();
    expect(zip.file("OEBPS/audio/0.mp3")).not.toBeNull();
    expect(zip.file("OEBPS/audio/1.mp3")).not.toBeNull();
    expect(zip.file("OEBPS/smil/page-0.smil")).not.toBeNull();
    expect(zip.file("OEBPS/smil/page-1.smil")).not.toBeNull();

    // mimetype 必须无压缩且内容固定
    const mimetype = await zip.file("mimetype")!.async("string");
    expect(mimetype).toBe("application/epub+zip");

    // opf 必备字段
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("media:active-class");
    expect(opf).toContain("media:narrator");
    expect(opf).toContain('media-overlay="smil-0"');
    expect(opf).toContain('media-overlay="smil-1"');

    // smil 引用正确
    const smil1 = await zip.file("OEBPS/smil/page-1.smil")!.async("string");
    expect(smil1).toContain('src="../audio/1.mp3"');
    expect(smil1).toContain('src="../page-1.xhtml#p1-s');

    // xhtml 含 span 锚点
    const xhtml1 = await zip.file("OEBPS/page-1.xhtml")!.async("string");
    expect(xhtml1).toContain('id="p1-s1"');
  }, 30000); // 30s timeout for bun spawn
});
```

- [ ] **Step 5: 运行集成测试**

```bash
bun test .claude/skills/audio-picture-book-creator/scripts/test/integration.test.ts
```

Expected: 1 pass, 0 fail。如失败查看 stderr 输出，常见问题：jszip 路径写错、buildOpf 输出与断言不匹配。

- [ ] **Step 6: 跑全部测试确认无回归**

```bash
bun run test
```

Expected: 所有测试 pass（sentence-split 8 + timestamp-aggregator 6 + parse-script 2 + duration 3 + smil-builder 3 + xhtml-builder 4 + opf-builder 3 + integration 1 = 30 个）。

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/audio-picture-book-creator/scripts/test/
git commit -m "test(audio-picture-book-creator): add fixture-based integration test

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 17: 真实绘本 smoke 测试与最终验收

在现有样书 `output/zhouwu-yuehao/` 上跑完整流程，人工验证 Apple Books 体验。

**Files:** 无新文件；执行验收清单。

- [ ] **Step 1: 为样书生成所有页音频**

```bash
cd /Users/jianliwei/personal-repos/picture-book

# 创建 audio 目录
mkdir -p output/zhouwu-yuehao/audio

# 解析 script.md 拿到每页 text，逐页调 generate-audio
# （正式使用时由 audio-picture-book-creator skill 编排，这里手动跑作为 smoke）
bun -e "
const { parseScript } = await import('./.claude/skills/audio-picture-book-creator/scripts/lib/parse-script.ts');
const pages = await parseScript('output/zhouwu-yuehao/script.md');
console.log(JSON.stringify(pages, null, 2));
" > /tmp/pages.json
cat /tmp/pages.json
```

Expected: 输出 12 页（0-11）的 JSON manifest。

- [ ] **Step 2: 逐页生成音频（4 并发模拟）**

```bash
# 用 xargs -P 4 模拟 4 并发
node -e "
const pages = require('/tmp/pages.json');
console.log(pages.map(p => p.pageNum + '\t' + p.text.replace(/\n/g, ' ')).join('\n'));
" > /tmp/manifest.tsv

while IFS=$'\t' read -r pageNum text; do
  echo \"=== Page $pageNum ===\"
  echo \"$text\" | bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
    --output \"output/zhouwu-yuehao/audio/${pageNum}.mp3\" || echo \"FAIL page $pageNum\"
done < /tmp/manifest.tsv

ls -la output/zhouwu-yuehao/audio/
```

Expected: 12 对 mp3 + json 文件，每个 mp3 > 5KB。

- [ ] **Step 3: 打包有声 EPUB**

```bash
bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
  --topic-dir output/zhouwu-yuehao \
  --title "周五的胡萝卜蛋糕" \
  --author "AI Picture Book Creator" \
  --lang zh \
  --voice zh-CN-XiaoyiNeural

ls -la output/zhouwu-yuehao/*.epub
```

Expected: 同时存在 `周五的胡萝卜蛋糕.epub`（原静态版）+ `周五的胡萝卜蛋糕-audio.epub`（新有声版），原文件 mtime/size 未变。

- [ ] **Step 4: 用 Apple Books 打开有声版**

```bash
open -a "Books" output/zhouwu-yuehao/周五的胡萝卜蛋糕-audio.epub
```

人工验收（写下结果）：
- [ ] 封面正确显示，标题字样可读
- [ ] 点击播放按钮（Books 右上角扬声器图标），开始朗读
- [ ] 朗读时当前句有黄色背景高亮
- [ ] 一页朗读完毕自动翻到下一页
- [ ] 全 12 页连续播放完成
- [ ] 总时长合理（应在 1-3 分钟）

- [ ] **Step 5: 跑 epubcheck（若已装）**

```bash
which epubcheck && epubcheck output/zhouwu-yuehao/周五的胡萝卜蛋糕-audio.epub || echo "epubcheck 未装，跳过"
```

Expected: 无 ERROR；可能有少量 WARNING（如 cover-image 重复声明等，不影响阅读）。

- [ ] **Step 6: 验证原静态 EPUB 完好**

```bash
# 与原 commit 比较 size
git log --oneline -1 output/zhouwu-yuehao/周五的胡萝卜蛋糕.epub 2>/dev/null || echo "EPUB 在 .gitignore 中，跳过"
```

确认（手动）：原静态 EPUB 文件未被覆盖、size 未变。

- [ ] **Step 7: Commit smoke 测试结果文档（可选）**

如需把验证过程写入 README 的"输出示例"段落：

```bash
# 修改 README.md，在"输出示例"段落补充：
#   - 周五的胡萝卜蛋糕-audio.epub  （有声版，配晰晰童声朗读）
git add README.md
git commit -m "docs: README 输出示例增补有声版条目

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec 覆盖检查

逐节比对 `docs/superpowers/specs/2026-05-12-audio-picture-book-design.md`：

| Spec 节 | 实现 task |
|---|---|
| §1 目标与范围 | 整体计划覆盖 |
| §2 关键决策 | Task 1（venv）、Task 2（SKILL.md 默认音色）、Task 9（编排默认） |
| §3 整体架构 | Task 2/9（两 skill 划分）、Task 7/15（脚本入口） |
| §4 text-to-speech 契约 | Task 2-7 全覆盖（SKILL.md / lib / helper / 主入口）|
| §5 audio-picture-book-creator 流程 | Task 9（SKILL.md 阶段 A-D）|
| §6.1 句子拆分 | Task 3（sentence-split 含 8 测试）|
| §6.2 词→句聚合 | Task 4（aggregator 含 3 测试） |
| §6.3 时间戳健全性 | Task 4（sanityCheck 含 3 测试）|
| §6.4 EPUB 内部目录约定 | Task 12/13/14/15（路径在 builder 中固化） |
| §6.5 页面 XHTML | Task 13（xhtml-builder 含 4 测试） |
| §6.6 SMIL | Task 12（smil-builder 含 3 测试）|
| §6.7 content.opf | Task 14（opf-builder 含 3 测试）|
| §6.8 输出目录 | Task 15（输出路径默认 `<topic-dir>/<title>-audio.epub`）|
| §6.9 阅读器兼容性 | Task 1（README）+ Task 9（SKILL.md）|
| §7 错误处理三层 | Task 6/7（Layer 1 helper+主入口）、Task 9（Layer 2 编排在 skill 流程）、Task 4（Layer 3 sanityCheck）|
| §8 测试策略 | Task 3/4/10/11/12/13/14（单元）+ Task 16（集成 fixture）+ Task 17（真实 smoke）|
| §9 setup 与依赖 | Task 1（venv + .gitignore + README）|
| §10 YAGNI | 无任务（明确不做）|
| §11 未来扩展 | 无任务（明确不做）|
| §12 验收标准 | Task 17 逐项核对 |

无遗漏。

### 类型一致性

- `Word { text, start_ms, end_ms }` 在 timestamp-aggregator.ts 定义，generate-audio.ts 中通过 `import type { Word }` 复用
- `Sentence { text, start_ms, end_ms }` 同上
- `PageMeta { pageNum, durationMs }` 在 opf-builder.ts 定义，generate-audio-epub.ts 通过 `import type { PageMeta }` 复用
- `BuildSmilInput` / `BuildPageXhtmlInput` / `BuildOpfInput` 在各自 builder 内定义并 export

### 占位符扫描

无 TBD/TODO/FIXME。所有 step 含完整代码或可执行命令。

---

## 验收清单（Task 17 落地后整体复核）

- [ ] `output/zhouwu-yuehao/周五的胡萝卜蛋糕-audio.epub` 存在
- [ ] Apple Books 打开后能朗读 + 高亮 + 自动翻页
- [ ] 总时长 > 30s，每页时长 ≥ 1s
- [ ] 原 `周五的胡萝卜蛋糕.epub` 完好无改动
- [ ] `bun run test` 全 pass（30 测试）
- [ ] epubcheck 无 ERROR（若装）
