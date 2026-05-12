# 有声绘本生成系统设计

- **状态**：Draft
- **作者**：Claude + jianliwei
- **日期**：2026-05-12
- **背景项目**：[picture-book](../../../README.md)

---

## 1. 目标与范围

把现有的"静态绘本生成系统"升级为"有声绘本生成系统"，让用户在已生成的 `output/<topic>/` 上**追加**一份可朗读、文字可高亮、可自动翻页的 EPUB3 电子书。

### 在范围

- 新增 `text-to-speech` skill：1 段文本 → 1 个 mp3 + 1 份词/句级时间戳 JSON
- 新增 `audio-picture-book-creator` skill：编排现有 `output/<topic>/` 补声并重打包成 EPUB3 Media Overlays
- 中文朗读，使用 [edge-tts](https://github.com/rany2/edge-tts) 调微软 Edge 在线神经语音
- 保留原有静态绘本流程与产出，零侵入

### 不在范围

- 多语言混读、音色训练/克隆、背景音乐与音效、实时朗读 streaming、自动断句 NLP、时间戳 GUI 编辑器
- 修改现有 `picture-book-creator`、`image-generation` skill 行为
- 商业出版级 TTS（CosyVoice 2 / Index-TTS）——预留 engine 切换余地，本次不实现

---

## 2. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 交付形式 | EPUB3 Media Overlays | 出版业标准，Apple Books / Thorium 原生支持朗读+高亮+翻页 |
| TTS 引擎 | edge-tts | 免费、零 API key、原生提供 WordBoundary 词级时间戳，中文 Xiaoyi 童声适合儿童 |
| 默认音色 | `zh-CN-XiaoyiNeural`（晰晰，中文童声女孩） | 最贴近"小朋友听到的声音" |
| 默认参数 | rate=`-10%`、volume=`+0%`、pitch=`+0Hz` | 略慢更适合儿童听感 |
| skill 边界 | 拆 2 个新 skill：`text-to-speech` + `audio-picture-book-creator` | 单一职责，与现有 image-generation/picture-book-creator 对称 |
| 入口模式 | 补声型 | 在已有 `output/<topic>/` 上追加，不强制重新生成图 |
| 音频粒度 | 整页一个 mp3，SMIL 用 clipBegin/clipEnd 切句 | 朗读连贯有气口，包大小小，依赖 WordBoundary 聚合时间戳 |
| Python 依赖 | 项目内 venv（`.venv/`，gitignore） | 与全局环境隔离 |

---

## 3. 整体架构

```
┌────────────────────────────────────┐
│ picture-book-creator (不动)        │   现有产出: output/<topic>/
│   阶段 1-7：脚本→图→静态 EPUB      │     ├ script.md, characters.md, style.md
└────────────────────────────────────┘     ├ 0.png ~ N.png
                  │                        └ <书名>.epub  ← 静态版（保留）
                  ↓ 用户说"加声音"
┌────────────────────────────────────┐
│ audio-picture-book-creator (新)    │   补声编排 skill
│   读 script.md → 调 tts skill      │
│   收齐音频 → 重打包 EPUB3 MO       │
└────────────────────────────────────┘
                  │ 每页一次调用 (context: fork, 并发 4)
                  ↓
┌────────────────────────────────────┐
│ text-to-speech (新, edge-tts)      │   原子 skill
│   text → mp3 + timestamps.json     │
└────────────────────────────────────┘
                  ↓
output/<topic>/
├ <书名>.epub                ← 原静态版（保留）
├ <书名>-audio.epub           ← 新有声版（与静态版同级并存）
└ audio/                      ← 中间产物
   ├ 0.mp3 ~ N.mp3
   └ 0.json ~ N.json          (词/句级时间戳)
```

### 三个原则

1. **职责单一**：`text-to-speech` 只做"1 段文字 → 1 个 mp3 + 1 份时间戳"，与 `image-generation` 镜像对称
2. **零侵入**：`picture-book-creator` 完全不动，老用户体验保持
3. **可追加**：用户对任何已有 `output/<topic>/` 都能补声音；不强制重新生成图

---

## 4. text-to-speech skill 契约

### 4.1 文件布局

```
.claude/skills/text-to-speech/
├── SKILL.md
└── scripts/
    ├── generate-audio.ts       ← Bun 入口
    └── edge_tts_helper.py      ← Python helper，吐音频流到 stdout，时间戳 NDJSON 到 stderr
```

### 4.2 SKILL.md 描述

```
Use when needing to synthesize one MP3 from one piece of text via edge-tts
(Microsoft Edge online voices). Triggered by audio-picture-book-creator
(one call per page) or any task that says "生成音频/朗读/TTS/text to speech".
One invocation = one MP3 + one timestamps JSON. Concurrency, batching and
retries are caller's responsibility. Requires the project venv at <repo>/.venv
with edge-tts installed.
```

### 4.3 调用接口

```bash
bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --output <mp3 路径>              # 必填，会同时写 <output>.json 在同目录同名
  [--text "<text>"]               # 不传则从 stdin（推荐：长文本 / 含引号）
  [--voice zh-CN-XiaoyiNeural]    # 默认晰晰童声
  [--rate -10%]                   # 默认 -10%
  [--volume +0%]                  # 默认 +0%
  [--pitch +0Hz]                  # 默认 +0Hz
```

### 4.4 输出格式

**`<output>.mp3`**：标准 MP3 音频。

**`<output>.json`**：

```json
{
  "voice": "zh-CN-XiaoyiNeural",
  "rate": "-10%",
  "volume": "+0%",
  "pitch": "+0Hz",
  "duration_ms": 4820,
  "text": "毛毛在外婆家过暑假。每天有讲不完的故事，吃不完的胡萝卜。",
  "sentences": [
    {"text": "毛毛在外婆家过暑假。", "start_ms": 0,    "end_ms": 1880},
    {"text": "每天有讲不完的故事，", "start_ms": 1920, "end_ms": 3340},
    {"text": "吃不完的胡萝卜。",     "start_ms": 3380, "end_ms": 4820}
  ],
  "words": [
    {"text": "毛毛", "start_ms": 0,   "end_ms": 320},
    {"text": "在",   "start_ms": 320, "end_ms": 480}
  ],
  "timestamps_adjusted": false
}
```

### 4.5 退出码

| 退出码 | 含义 | 调用方应当 |
|---|---|---|
| 0 | mp3 + json 都已写盘 | 继续 |
| 1 | 任意失败（venv 缺失 / 网络 / edge-tts 报错 / 写盘失败），stderr 单行错误 | 读 stderr 判断是否重试 |

### 4.6 错误形态

| stderr 关键字 | 触发条件 | 调用方处置建议 |
|---|---|---|
| `edge-tts 未安装` | venv 不存在或包未装 | 提示用户运行 setup 命令，不重试 |
| `网络错误` | DNS / 连接超时 | 退避 2-5s 重试 |
| `edge-tts 限流` | 服务返回 HTTP 429 | 退避 5-10s 重试 |
| `合成失败：<原文>` | 文本含未支持字符 | 修剪后重试或跳过 |
| `Prompt 为空` / `text 为空` | 调用方没传 text | 修复调用代码，不要重试 |
| `写盘失败` | 磁盘问题 | 检查路径权限 |

### 4.7 实现要点

- **入口** `generate-audio.ts`（Bun + TS）解析 CLI，启动 Python 子进程
- **子进程** `<repo>/.venv/bin/python <skill>/scripts/edge_tts_helper.py --voice ... --rate ...`
- helper 用 edge-tts `Communicate` API：
  - `audio` chunks → stdout（二进制流）
  - `WordBoundary` 事件 → stderr（每行一个 JSON：`{"offset_us": ..., "duration_us": ..., "text": "..."}`）
- TS 端：
  - 收齐 stdout 写入 `<output>.mp3`
  - 收齐 stderr NDJSON 解析为 words[]
  - 调用句子拆分函数（见 §6.1）拆 sentences[]
  - 对齐 words → sentences（见 §6.2）
  - 时间戳健全性校验（见 §6.3）
  - 写出 `<output>.json`

### 4.8 与 image-generation 的对称性

| | image-generation | text-to-speech |
|---|---|---|
| 输入 | prompt | text |
| 输出主文件 | `<output>.png` | `<output>.mp3` |
| 输出元数据 | 无 | `<output>.json`（时间戳） |
| 并发控制 | 调用方 | 调用方 |
| 失败处置 | 调用方 | 调用方 |
| 长输入支持 | stdin | stdin |

---

## 5. audio-picture-book-creator skill 流程

### 5.1 文件布局

```
.claude/skills/audio-picture-book-creator/
├── SKILL.md
├── references/
│   └── media-overlays-spec.md      ← EPUB3 SMIL 格式速查
└── scripts/
    └── generate-audio-epub.ts      ← 重打包成 EPUB3 + Media Overlays
```

### 5.2 SKILL.md 触发关键词

```
把已有的静态绘本 output/<topic>/ 升级为有声绘本 EPUB3
（带 Media Overlays，朗读时自动高亮文字、翻页）。
当用户说"加声音 / 给绘本配音 / 做有声版 / 朗读 / read-aloud /
audio book / 有声书"时使用此 skill。
```

### 5.3 四阶段流程

#### 阶段 A：定位与清单

1. 列出 `output/` 下所有可补声的目录（含 `script.md` + 至少 1 张 `<n>.png`）
2. 用户选定 `<topic>`（若初始 prompt 已包含名字则跳过）
3. 解析 `script.md`，提取每页的 `text` 字段，生成 manifest（页号 → 朗读文本）
4. 封面页（page 0）默认朗读 `text` 字段（picture-book-creator 约定为书名）；若 `text` 为空字符串则跳过封面音频，封面页仍出现在 EPUB 中但无 SMIL 关联

#### 阶段 B：声音参数确认

1. 默认：`voice=zh-CN-XiaoyiNeural`、`rate=-10%`、`volume=+0%`、`pitch=+0Hz`
2. 展示候选音色：
   - `zh-CN-XiaoyiNeural` 晰晰（童声女孩，默认）
   - `zh-CN-XiaoxiaoNeural` 晓晓（成年女声，故事感强）
   - `zh-CN-YunxiNeural` 云希（成年男声，温暖）
3. 询问用户是否调整；若初始 prompt 已指定则跳过
4. 输出确认摘要进入阶段 C

#### 阶段 C：并行生成音频（自动执行）

1. 对 page 0 ~ N，每页调用 `text-to-speech` skill（`context: fork`，由本 skill 派发）
2. 并发 4，与图像生成节奏一致
3. 验证：每页 `<n>.mp3` 大小 > 5KB 且对应 `<n>.json` 存在
4. 失败页报告并提供"重试 / 跳过 / 中止"选项；用户确认后继续

输出：`output/<topic>/audio/{0..N}.mp3` + `{0..N}.json`

#### 阶段 D：重打包 EPUB3 Media Overlays（自动执行）

1. 调用 `generate-audio-epub.ts`：

```bash
bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
  --topic-dir output/<topic> \
  --title "<书名>" \
  --author "<作者>" \
  --lang zh \
  --voice zh-CN-XiaoyiNeural \
  [--output output/<topic>/<书名>-audio.epub]
```

2. 脚本内部行为见 §6
3. 输出：`output/<topic>/<书名>-audio.epub`
4. 与现有 `output/<topic>/<书名>.epub` **同级并存，不覆盖**

### 5.4 阶段间流转

| 流转 | 触发 |
|---|---|
| A → B | 自动（找到 topic 后立即询问声音） |
| B → C | 用户确认声音参数 |
| C → D | 音频验证全部通过则自动 |
| 任何失败 | 报错退出，不破坏现有 output/ |

### 5.5 智能跳过规则

- 用户初始 prompt 包含 `<topic>` 名字 → 跳过阶段 A
- 包含声音偏好（如"用童声"）→ 跳过阶段 B
- 完整指令（如"给周五的胡萝卜蛋糕做有声版用晰晰童声"）→ A、B 都跳过

---

## 6. EPUB3 Media Overlays 数据流

### 6.1 中文句子拆分规则

输入 `script.md` 第 N 页的 `text` 字段，输出 `sentences: string[]`。

- **主分隔符**：`。！？` 切句并保留标点
- **次分隔符**（仅当某段 > 25 字时）：`，；` 进一步切短
- **引号保护**：`""` `「」` 包裹的对话作为整体不拆
- 拆出空字符串自动过滤
- 边界 case：纯标点行 → 不拆；句末无标点 → 整段作为一个句子

实现位于 `scripts/sentence-split.ts`，由 `generate-audio-epub.ts` 与 `text-to-speech` 共用。

### 6.2 词时间戳 → 句时间戳聚合

输入：edge-tts WordBoundary 序列 `words: {text, start_ms, end_ms}[]` + 拆好的 `sentences: string[]`

算法：
1. 对每个句子，按字符在原文中的位置区间，找出落在该区间内的 word
2. 句子 `start_ms` = 第一个 word 的 `start_ms`
3. 句子 `end_ms` = 最后一个 word 的 `end_ms`
4. 若某句找不到匹配 word（罕见）：取前句 `end_ms` 作为 start，后句 `start_ms` 作为 end

### 6.3 时间戳健全性校验

- 若整页 word boundary 总时长与 mp3 实际时长偏差 > 10%（罕见，但 edge-tts 偶发）：
  - 按比例线性重整时间戳
  - JSON 写入 `"timestamps_adjusted": true`
  - `generate-audio-epub.ts` 读到此字段会 console.warn
- 若 sentence 边界落不到 word boundary 上：
  - 取最近的 word boundary 作为 sentence end
  - 若找不到，把整段当作一个 par（高亮粒度退化为整段）
- WordBoundary 全空（极端兜底）：
  - mp3 仍写出
  - json 用 `sentences=[整段, 0~duration]` 兜底
  - 警告但不 exit 1

### 6.4 EPUB 内部目录约定

打包到 EPUB zip 内的路径（**所有路径相对 OEBPS/ 根**）：

```
OEBPS/
├── content.opf
├── nav.xhtml
├── page-0.xhtml ~ page-N.xhtml
├── images/
│   └── 0.png ~ N.png
├── audio/
│   └── 0.mp3 ~ N.mp3
└── smil/
    └── page-0.smil ~ page-N.smil
```

XHTML / SMIL 中的相对引用因此约定为：
- XHTML 引用图：`<img src="images/N.png"/>`
- SMIL 引用 XHTML：`epub:textref="../page-N.xhtml"` + `<text src="../page-N.xhtml#pN-s1"/>`
- SMIL 引用音频：`<audio src="../audio/N.mp3"/>`
- opf manifest 的 href 全部相对 OEBPS/ 根，如 `page-N.xhtml`、`audio/N.mp3`、`smil/page-N.smil`、`images/N.png`

### 6.5 页面 XHTML 模板

每页（含封面）变成：

```html
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=2048, height=2048"/>
  <title>第 N 页</title>
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
  <img src="images/N.png" alt="第N页"/>
  <p class="caption">
    <span id="pN-s1">毛毛在外婆家过暑假。</span>
    <span id="pN-s2">每天有讲不完的故事，</span>
    <span id="pN-s3">吃不完的胡萝卜。</span>
  </p>
</body>
</html>
```

注：图像本身已渲染了文字（来自 picture-book-creator 的设计），caption 在大多数 fixed-layout 阅读器中会绝对定位在图底部 2%~5% 区域，作为 Media Overlays 高亮锚点 + 跟读用文字。可通过 CSS `display:none` 隐藏 —— **本设计选择保留可见**，便于读者跟读。可作为后续可选项。

### 6.6 SMIL 文件 `smil/page-N.smil`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"
      xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seqN" epub:textref="../page-N.xhtml" epub:type="bodymatter chapter">
      <par id="parN-1">
        <text src="../page-N.xhtml#pN-s1"/>
        <audio src="../audio/N.mp3" clipBegin="0ms" clipEnd="1880ms"/>
      </par>
      <par id="parN-2">
        <text src="../page-N.xhtml#pN-s2"/>
        <audio src="../audio/N.mp3" clipBegin="1920ms" clipEnd="3340ms"/>
      </par>
      <par id="parN-3">
        <text src="../page-N.xhtml#pN-s3"/>
        <audio src="../audio/N.mp3" clipBegin="3380ms" clipEnd="4820ms"/>
      </par>
    </seq>
  </body>
</smil>
```

### 6.7 content.opf 关键字段

```xml
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  ...
  <meta property="media:duration" refines="#smil-1">PT4.820S</meta>
  <meta property="media:duration" refines="#smil-2">PT5.300S</meta>
  ...
  <meta property="media:duration">PT58.300S</meta>          <!-- 全书总时长 -->
  <meta property="media:active-class">-epub-media-overlay-active</meta>
  <meta property="media:narrator">zh-CN-XiaoyiNeural</meta>
  <meta property="rendition:layout">pre-paginated</meta>
  <meta property="rendition:spread">auto</meta>
</metadata>

<manifest>
  <item id="page-1"  href="page-1.xhtml"        media-type="application/xhtml+xml"
        media-overlay="smil-1"/>
  <item id="audio-1" href="audio/1.mp3"         media-type="audio/mpeg"/>
  <item id="smil-1"  href="smil/page-1.smil"    media-type="application/smil+xml"/>
  <item id="img-1"   href="images/1.png"        media-type="image/png"/>
  ...
</manifest>
```

### 6.8 输出目录布局

```
output/<topic>/
├── characters.md
├── style.md
├── script.md
├── 0.png ~ N.png
├── 周五的胡萝卜蛋糕.epub          ← 原静态版（保留，picture-book-creator 产出）
├── 周五的胡萝卜蛋糕.pdf
├── 周五的胡萝卜蛋糕-audio.epub    ← 有声版（generate-audio-epub.ts 产出）
└── audio/                          ← 中间产物（重新生成时可被覆盖）
    ├── 0.mp3 ~ N.mp3              ← text-to-speech 产出
    └── 0.json ~ N.json
```

### 6.9 阅读器兼容性

| 阅读器 | Media Overlays 支持 | 表现 |
|---|---|---|
| Apple Books (iOS / macOS) | ✅ 一类支持 | 自动朗读 + 句级高亮 + 翻页 |
| Thorium Reader (跨平台) | ✅ 一类支持 | 自动朗读 + 句级高亮 + 翻页 |
| Kindle Previewer | ⚠️ 不支持 MO | 文字 + 图正常显示，无音频 |
| Calibre 阅读器 | ⚠️ 部分支持 | 可朗读，高亮可能异常 |
| 微信读书 | ❌ 不支持 | 当作普通 EPUB |

skill SKILL.md 中明确说明"建议用 Apple Books 或 Thorium 体验完整效果"。

---

## 7. 错误处理总览

### 7.1 Layer 1：text-to-speech 单页失败

详见 §4.6。原则：失败即 exit 1 + stderr 单行；从不静默或半成功。

### 7.2 Layer 2：audio-picture-book-creator 编排级

- 阶段 C 验证：每页 mp3 > 5KB 且 json 存在；失败页列出，用户选"重试 / 跳过 / 中止"
- 阶段 D 验证：调 JSZip 简单读回 EPUB 检查 mimetype + container.xml + opf 解析成功
- 整体行为：**任何失败都不删除已有静态 EPUB**，确保用户原有产出不丢

### 7.3 Layer 3：时间戳异常兜底

详见 §6.3。原则：能修就修并标记 `timestamps_adjusted: true`，无法修则降级到段级高亮。

---

## 8. 测试策略

### 8.1 单元测试

| 文件 | 覆盖 |
|---|---|
| `test/sentence-split.test.ts` | 中文拆句规则、引号保护、长句二次拆 |
| `test/timestamp-aggregator.test.ts` | word boundary → sentence 聚合算法 |
| `test/smil-builder.test.ts` | SMIL XML 生成 well-formed，par 数量 = sentence 数量 |
| `test/opf-builder.test.ts` | content.opf 正确包含 media:duration / media-overlay 引用 |

### 8.2 集成测试

**fixture-based（进 CI）：**

`test/fixtures/mini-book/` 一个 3 页极简绘本（1 张 png + 3 句话），不依赖外部 API：
- mock `text-to-speech` skill 返回预录的 mp3 + 时间戳
- 跑完整 `generate-audio-epub.ts`
- 断言生成的 epub 通过 `epubcheck`（如可用）+ 结构正确

**真实 smoke（不进 CI，文档说明）：**

```bash
bun run .claude/skills/audio-picture-book-creator/test/smoke.ts \
  --topic zhouwu-yuehao
```

产出 `周五的胡萝卜蛋糕-audio.epub`，人工用 Apple Books 打开验证朗读 + 高亮 + 翻页。

### 8.3 EPUB 结构校验

`generate-audio-epub.ts` 末尾自动调用 `epubcheck`（若 PATH 中存在）；不存在时 console.log 提示安装：

```
未检测到 epubcheck，跳过结构校验。
建议安装：brew install epubcheck
```

---

## 9. Setup 与依赖

### 9.1 一次性 setup（README 增加章节）

```bash
# 创建项目内 venv 并装 edge-tts
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install edge-tts

# (可选) 安装 epubcheck
brew install epubcheck
```

`.gitignore` 增加 `.venv/`。

### 9.2 运行时探测

`text-to-speech/scripts/generate-audio.ts` 启动时检查：

1. `<repo>/.venv/bin/python` 存在 → 否则 stderr `edge-tts 未安装` + setup 命令提示
2. `<repo>/.venv/bin/python -c "import edge_tts"` 成功 → 否则同上

### 9.3 依赖一览

| 依赖 | 来源 | 用途 |
|---|---|---|
| edge-tts (Python) | venv | TTS 合成 + WordBoundary |
| jszip (npm) | 已有 | EPUB 打包 |
| Bun | 已有 | TS 运行时 |
| epubcheck | 可选，brew | EPUB 结构校验 |

---

## 10. 不做（YAGNI）

| 功能 | 不做的原因 |
|---|---|
| 多语言混读（一句中英混合） | edge-tts 自动处理基本够用，绘本场景罕见复杂混读 |
| 音色训练 / 克隆 | edge-tts 不支持，强需求时换 CosyVoice 2 |
| 背景音乐 / 音效 | 第二期需求，不在当前 scope |
| 实时朗读 streaming | EPUB 是离线文件，无意义 |
| 自动断句优化（NLP） | 标点拆句覆盖 90% 场景，复杂情况由用户调 script.md |
| 时间戳 GUI 编辑器 | 用户极少需要手工微调 |
| 多 engine 适配层 | YAGNI；未来确需切 Azure OpenAI / CosyVoice 时再抽象 |

---

## 11. 未来扩展点（不在本次实现）

- TTS engine 适配层：抽 `tts-engine` 接口，支持 edge-tts / Azure OpenAI gpt-audio-1.5 / CosyVoice 2 切换（商用出版时启用）
- 多角色配音：根据 `characters.md` 给不同角色对话用不同 voice
- 背景音乐与音效：每页可选 BGM / sound-effect 轨道
- 朗读节奏自定义：每页或每段独立 rate / pitch
- 输出 MP4 视频版（图 + 字幕 + 音频，社交平台友好）

---

## 12. 验收标准

- [ ] 在 `output/zhouwu-yuehao/`（现有样书）上运行 audio-picture-book-creator，产出 `output/zhouwu-yuehao/周五的胡萝卜蛋糕-audio.epub`
- [ ] 用 Apple Books 打开，从封面开始播放，每页自动朗读、当前句高亮、自动翻页直到结尾
- [ ] 总时长 > 30s，每页时长 ≥ 1s
- [ ] 原 `周五的胡萝卜蛋糕.epub` 完好无改动
- [ ] `epubcheck` 通过（若已安装）
- [ ] 所有单元测试 + fixture 集成测试通过
