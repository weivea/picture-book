---
name: text-to-speech
description: |
  Use when needing to synthesize one MP3 from one piece of text via Azure Speech
  (azure-cognitiveservices-speech, Microsoft neural voices). Triggered by
  audio-picture-book-creator (one call per page) or any task that says
  "生成音频/朗读/TTS/text to speech". One invocation = exactly one MP3 + one
  timestamps JSON. Concurrency, batching and retries are caller's responsibility.
  Requires the project venv at <repo>/.venv with azure-cognitiveservices-speech
  installed, plus AZURE_SPEECH_KEY / AZURE_SPEECH_ENDPOINT in .env.
---

# Text To Speech

通过 Azure Speech（`azure-cognitiveservices-speech`）调用微软神经语音，把一段文本合成一份 mp3 + 一份词/句级时间戳 JSON。

## When to Use

- audio-picture-book-creator 阶段 C 派发的逐页朗读（每页一次调用）
- 任何"text → 1 个 mp3 + 时间戳"的需求

## When NOT to Use

- **音色克隆 / 训练**：Azure 标准/HD 语音不支持，强需求时换 CosyVoice 2
- **批量并发**：本 skill 单次只生成一段。并发由调用方控制（audio-picture-book-creator 限 4 并发）
- **失败自动重试**：本 skill 失败即 `exit 1`。调用方决定是否重试

## Prerequisites

1. `<repo>/.venv/bin/python` 必须存在且可 `import azure.cognitiveservices.speech`：

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

2. `.env`（项目根，已 gitignore）配置 Azure Speech 资源凭据，参考 `.env.example`：

   ```bash
   AZURE_SPEECH_KEY=<your-azure-speech-key>
   AZURE_SPEECH_ENDPOINT=https://<resource>.cognitiveservices.azure.com/
   ```

   helper 会从本脚本所在 venv 推导 repo root 加载 `.env`，也兜底从 cwd 向上查找。

## Quick Reference

```bash
bun run .claude/skills/text-to-speech/scripts/generate-audio.ts \
  --output <mp3 路径>              # 必填，会同时写 <output>.json 在同目录同名
  [--text "<text>"]               # 不传则从 stdin（推荐：长文本 / 含引号）
  [--voice zh-CN-XiaoyiNeural]    # 默认晰晰童声
  [--rate -10%]                   # 默认 -10%（适合儿童）
  [--volume +0%]                  # 默认 +0%
  [--pitch +0Hz]                  # 默认 +0Hz
```

退出码：

| 退出码 | 含义 | 调用方应当 |
|---|---|---|
| 0 | mp3 + json 都已写盘 | 继续 |
| 1 | 任意失败 | 读 stderr 判断是否重试 |

## 输出 JSON 格式

```json
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
```

> 注：当前 `duration_ms` 取自最后一个 WordBoundary 的 `end_ms`，与 sanityCheck 输入同源，因此 `timestamps_adjusted` 在生产中始终为 `false`。后续若引入 ffprobe 获取真实 mp3 时长，sanityCheck 才会真正生效。

## Behavior on Error

| stderr 关键字 | 触发条件 | 调用方处置建议 |
|---|---|---|
| `azure-cognitiveservices-speech 未安装` | venv 不存在或包未装 | 提示用户跑 setup，不重试 |
| `鉴权失败` | key/endpoint 错误或过期 | 检查 `.env`，不重试 |
| `网络错误` | DNS / 连接超时 | 退避 2-5s 重试 |
| `限流：Azure Speech 429` | 服务返回 HTTP 429 | 退避 5-10s 重试 |
| `合成失败：<原因>` | 文本含未支持字符或服务取消 | 修剪后重试或跳过 |
| `text 为空` | 调用方没传 text | 修复调用代码 |
| `写盘失败` | 磁盘问题 | 检查路径权限 |

## 音色选择

- **默认 `zh-CN-XiaoyiNeural`**（晰晰童声，标准神经语音）：绘本默认，配 `--rate -10%` 适合儿童。
- **HD 语音（DragonHD，情绪语义自适应，音质更高）**：适合小说/成人内容，按需 opt-in。中文仅两款：
  - `zh-CN-Xiaochen:DragonHDLatestNeural`（女声）
  - `zh-CN-Yunfan:DragonHDLatestNeural`（男声）
- 其余标准中文神经语音（如 `zh-CN-XiaoxiaoNeural`、`zh-CN-YunxiNeural`）均可用。

> **语气标签限制**：`[laughter]` / `[whispering]` / `[sighing]` 这类 styles/paralinguistics 标签对**中文无效**（会被逐字念出），中文一律送纯净文本，情绪由 HD 语音的语义自适应处理。切勿向中文文本注入此类标签。
