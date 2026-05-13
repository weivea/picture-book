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
