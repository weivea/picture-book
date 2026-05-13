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
