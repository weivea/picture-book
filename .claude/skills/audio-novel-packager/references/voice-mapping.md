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
