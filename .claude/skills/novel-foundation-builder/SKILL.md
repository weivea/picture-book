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
2. 读取 characters.md，为每个角色调用 voice-assigner 自动分配 Azure Speech voice
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
- `references/craft-zh.md`（Save the Cat / Wound-Want-Need-Lie / Sanderson 三定律）
- `references/anti-slop-zh.md`（禁用词清单）
- `references/anti-patterns.md`（12 条结构性 AI 失败模式）
- `references/style-presets-novel.md`（5 套插画风格）
- `references/edge-tts-voice-catalog.md`（voice-assigner 用的目录）
