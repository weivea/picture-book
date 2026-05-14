# Bible Templates

These are copy-pasteable skeletons. The SKILL.md flow tells Claude to copy the
relevant block, fill `<angle-bracket>` placeholders with real content, and write
the result to `series-output/<slug>/bible/<file>.md`.

The four templates correspond to the four bible files:

1. `series-meta.md` — series-level identity card (parsed by `series-meta-parse.ts`)
2. `world.md` — World Bible (frontmatter + free-form sections)
3. `characters.md` — Character Bible (one block per long-running character;
   adds `prompt_anchor` and `voice_profile` on top of the novel-output shape)
4. `style.md` — Style Bible (prompt prefix, palette, character anchor index)

All four are **frozen** after Step 6 of the SKILL flow — never edit in place.

---

### Template: series-meta.md

```markdown
---
slug: <kebab-case-slug>
title: <中文标题>
title_en: <English title>
age_range: <0-2 | 2-4 | 4-6 | 6-8>
language: <zh | en | ...>
genre: <体裁 / 题材，例如 治愈 / 日常生活>
series_scale: <short | medium | long>
typical_pages_per_volume: <整数，默认 12，可在 8-20 间调整>
education_goals:
  - <教育目标 1>
  - <教育目标 2>
taboos:
  - <禁忌 1，例如 不出现现实人类>
created_at: <ISO 8601 时间戳，例如 2026-05-14T08:30:00Z>
---

# 系列概述

<散文式介绍：故事核心、价值主张、面向何种孩子。3-6 段为宜。>
```

---

### Template: world.md

```markdown
---
title: <世界 / 大陆名，例如 轮胎大陆>
genre: <体裁，例如 儿童童话 / 公路冒险>
era: <时空设定，例如 与人类世界平行的"汽车纪元">
---

# 地理

<地理结构：分区、地标、关键路径。1-3 段。>

# 历史

<时间纵深：开拓者、关键事件、代际记忆。1-2 段。>

# 体系

<规则与限制：能做什么 / 不能做什么 / 代价是什么。
 用 bullet 列出"能做什么"、"限制"、"代价"三类。>

- 能做什么：<…>
- 限制：<…>
- 代价：<…>

# 恒定真相（事实表）

<不超过 10 条不可推翻的设定，每条一行 bullet。
 这是后续每一册都必须遵守的硬约束。>

- <事实 1>
- <事实 2>
- <事实 3>
```

---

### Template: characters.md

> 每个长期角色一个 `## <名字>` 块。注意 `prompt_anchor` 必须为**英文**，
> `voice_profile` 一旦在第一册有声化后**全系列锁定**。

```markdown
---
count: <角色总数>
---

## <角色中文名>
- role: <主角 | 父亲/导师 | 母亲/盟友 | 配角/求助者 | 配角/镜像 | 配角/象征导师 | …>
- core: <一句话定义这个角色的内核与本季弧线种子>
- wound: <过去的伤口，驱动当前行为>
- want: <角色自己以为想要的东西>
- need: <角色真正需要学到的东西>
- lie: <角色相信的、阻碍 need 的谎言>
- appearance: <详细外观叙述（中文），含物种 / 体型 / 服装 / 标志性特征>
- prompt_anchor: <英文一段话，长期不变，用于每页生图。例：A small white bear cub, round body, head-to-body 1:1.5, dark beady eyes, pink nose, wearing a cream linen apron with a tiny bear-paw embroidery on the chest pocket.>
- voice_profile: <edge-tts voice 名 [rate=±N%] [pitch=±N%]，例如 zh-CN-YunxiaNeural rate=+0% pitch=+5%>
- negative: <绝不出现的特征，英文。例：no sharp teeth, no modern clothing, no human hands>

## <下一个角色名>
- role: <…>
- core: <…>
- wound: <…>
- want: <…>
- need: <…>
- lie: <…>
- appearance: <…>
- prompt_anchor: <English anchor sentence>
- voice_profile: <edge-tts voice 名 [rate=±N%] [pitch=±N%]，例如 zh-CN-YunxiaNeural rate=+0% pitch=+5%>
- negative: <…>
```

---

### Template: style.md

```markdown
---
preset: <风格预设名，例如 清新水彩 / 柔光油画 / 蜡笔涂鸦>
---

# promptPrefix

<英文 style_prompt：每页生图时拼接到角色 prompt_anchor 之前。
 包含画风、光线、色调、构图、目标年龄段、媒材质感等。
 5-12 行散文式英文。>

# negative

<英文 negative_prompt：列出绝不出现的元素。
 例：no humans, no human hands, no realistic photo, no 3D render,
     no harsh shadows, no horror elements, no watermark, no text overlay>

# palette

- <主色名 (#HEX)>
- <辅色 1 (#HEX)>
- <辅色 2 (#HEX)>
- <强调色 (#HEX)>
- <…根据需要补充>

# 角色锚定短语索引

<character_anchor_index：本系列所有 prompt_anchor 的速查表，
 去重后引用，方便 volume-creator 一次读完。
 一个角色一行表格。>

| name | anchor (English) |
|---|---|
| <角色 1 中文名> | <英文 prompt_anchor，与 characters.md 中保持完全一致> |
| <角色 2 中文名> | <英文 prompt_anchor> |
| <角色 3 中文名> | <英文 prompt_anchor> |
```
