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
