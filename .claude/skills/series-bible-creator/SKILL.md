---
name: series-bible-creator
description: |
  连载绘本系列的"圣经"建立 skill。把用户对一个新系列的模糊设想
  转化为可冻结的 World Bible + Character Bible（含 voice_profile + prompt_anchor）
  + Style Bible + 角色 portraits。
  当用户说"我想做一个连载绘本"、"建一个绘本系列"、"create a picture book series"、
  "design world bible"、"做一套世界观一致的多册绘本" 时，触发此 skill。
  本 skill 仅写 bible/，不生成任何单册——单册由 series-volume-creator 负责。
---

# Series Bible Creator

把用户的连载绘本想法 → 一份**冻结的、跨册共享的**资产包，作为后续 Season Planner 与
Volume Creator 的唯一事实来源。

## When to Use

- 用户首次提出做一个**连载/系列绘本**
- 用户想为已有的单本扩展成系列（先把单本的角色/世界提炼为 Bible）

## When NOT to Use

- 已存在 `series-output/<slug>/bible/` 且 `state.json` 中 `bible.frozen_at != null`
  → 跳过本 skill，直接调 series-season-planner
- 单本绘本（无连载意图）→ 用 picture-book-creator

## Output Layout

```
series-output/<slug>/
├── state.json                       ← 创建/更新 bible.frozen_at
└── bible/
    ├── series-meta.md               ← 系列卡片（schema 见 references/bible-templates.md）
    ├── world.md                     ← 复用 novel-output/.../world.md frontmatter
    ├── characters.md                ← 含 voice_profile + prompt_anchor (英文)
    ├── style.md                     ← Prompt 前缀 + 调色板
    └── portraits/
        ├── <角色1>.png              ← 1024×1024 正面参考图
        └── <角色1>.meta.json        ← 生图 prompt + 时间戳
```

## Flow (6 steps)

### Step 1 — 系列定位收集

只在缺信息时问。需收集（参见 references/bible-templates.md）:
- 系列 slug（kebab-case，用于目录名）
- 系列中文/英文标题
- 目标年龄段（0-2/2-4/4-6/6-8）
- 主语言
- 体裁 / 题材
- 规模档位：`short` (≈6 册) / `medium` (≈12 册) / `long` (24+ 册)
- `typical_pages_per_volume`（默认 12，单册可在 8-20 间调整）
- 教育目标列表（可空）
- 禁忌清单（可空）

写出 `series-output/<slug>/bible/series-meta.md`（schema 见 references/bible-templates.md）。

### Step 2 — World Bible

复用 `novel-output/.../world.md` 的 frontmatter 格式（已验证）。
关键字段：时空设定、地理结构、社会结构、关键设定（不超过 3 条）、风格关键词。

写出 `bible/world.md` → **暂停 / 用户审阅**。

### Step 3 — Character Bible

为每个长期角色输出 character card（复用 `novel-output/.../characters.md` 格式）。
**必填字段：**
- 物种 / 体型 / 外貌 / 服装 / 标志性特征
- `prompt_anchor`：英文一段话，长期不变；这是后续每页生图角色一致性的关键。
  例如：`A small white bear cub, round body, head-to-body 1:1.5, dark
  beady eyes, pink nose, wearing a cream linen apron with a tiny bear-paw
  embroidery on the chest pocket.`
- `voice_profile`：edge-tts voice 名 + rate/pitch（全系列锁定，第一册有声后不再换）
- `appearance`：详细外观叙述（中文）
- `negative`：绝不出现的特征（如"不要尖牙、不要现代服装"）

写出 `bible/characters.md` → **暂停 / 用户审阅**。

校验：每个角色的 `prompt_anchor` 字段非空且为英文。

### Step 4 — Style Bible

输出风格设定卡（复用 `novel-output/.../style.md` 格式）：
- `style_prompt`（英文 prompt 前缀，用于每页拼接）
- `color_palette`：主色 + 辅色 + 强调色（含 hex）
- `negative_prompt`（英文负面）
- `character_anchor_index`：本系列所有 `prompt_anchor` 的速查表（去重后的引用，方便 volume-creator 读取）

写出 `bible/style.md` → **暂停 / 用户审阅**。

### Step 5 — Portraits 并行生成

为 `characters.md` 中的每个角色生成一张正面参考图：
- 调用 `image-generation` skill（一次一图）
- Prompt = `bible/style.md` 的 `style_prompt` + 角色 `prompt_anchor` + "neutral pose, neutral expression, plain background, full body view"
- `--ratio 1:1`，`--size 1024x1024`
- 输出到 `bible/portraits/<角色>.png`
- 写 `bible/portraits/<角色>.meta.json`：`{ prompt, model, generated_at, anchor_hash: <prompt_anchor 的 sha256 前 8 位> }`
- 并发上限 4

完成后 → **硬闸门审阅**：用户必须逐个确认每张 portrait。
不通过 → 回 Step 3 改 `prompt_anchor` 重做整张（不允许"用别的图代替")。

### Step 6 — Bible Freeze

更新 `state.json`：
```jsonc
{
  "bible": { "version": 1, "frozen_at": "<now ISO>" }
}
```

使用 `scripts/lib/state.ts` 的 `updateState(seriesRoot, (s) => { s.bible = { version: 1, frozen_at: new Date().toISOString() }; })`（Task 1 提供的原子更新）。

冻结后输出指引：
```
✅ Series Bible 已冻结 (v1)
📂 series-output/<slug>/bible/
下一步：
  • 规划本季弧线 → 召唤 series-season-planner
  • 直接做一本不属于任何季的游离册 → 召唤 series-volume-creator --no-season
```

## Cross-Skill Contract (我产出的文件 schema)

下游 skill 依赖以下文件且**永不修改**它们（除非走未来的 Bible 修订流程）：

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `bible/series-meta.md` | season-planner, volume-creator, omnibus-packager | slug, title, age_range, language, typical_pages_per_volume |
| `bible/world.md` | season-planner, volume-creator | 时空、地理、社会结构、风格关键词 |
| `bible/characters.md` | volume-creator (生图+有声), season-planner (角色清单) | `prompt_anchor` (英文，原样复制), `voice_profile` |
| `bible/style.md` | volume-creator | `style_prompt`, `negative_prompt`, `color_palette` |
| `bible/portraits/<角色名>.png` + `.meta.json` | volume-creator (视觉参考) | `anchor_hash` 用于检测 anchor 漂移 |

## Common Mistakes

- **修改已冻结的 bible/**：禁止；如需修订请走 v2 流程（本期不做）
- **prompt_anchor 写中文**：图像模型对英文锚定语义更稳定，必须英文
- **portraits 用其他角度**：必须正面、中性表情、纯背景，便于 volume-creator 的每页参考
- **跳过 Step 5 用户审阅**：portraits 是跨册一致性的最早 ground truth；漂了就全系列漂

## Implementation

- 解析 `series-meta.md`：`scripts/series-meta-parse.ts`（含单测）
- 模板：`references/bible-templates.md`（拷贝即用的 markdown 骨架）
- state 写入：复用 `series-bible-creator/scripts/lib/state.ts`（Task 1）
- portraits 生图：调用 `image-generation` skill，不写新脚本
