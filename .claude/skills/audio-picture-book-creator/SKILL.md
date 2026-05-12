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

```bash
bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts \
  --topic-dir output/<topic> \
  --title "<书名>" \
  --author "<作者>" \
  --lang zh \
  --voice zh-CN-XiaoyiNeural
```

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
