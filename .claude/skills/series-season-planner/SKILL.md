---
name: series-season-planner
description: |
  连载绘本"季"的规划 skill。基于已冻结的 Series Bible，为某一季产出
  季弧线（season-arc.md）和分册大纲（volumes-outline.md）。
  当用户说"规划第 N 季"、"plan season 2"、"列出本季要做的几册"、
  "design this season's arc" 时，触发此 skill。
  本 skill 不生成单册——单册由 series-volume-creator 负责。
---

# Series Season Planner

为某一季产出可被 volume-creator 直接消费的"季蓝图"。

## When to Use

- Bible 已冻结（`state.json` 中 `bible.frozen_at != null`），用户要规划某一季
- 用户已经做了若干游离册（standalone-N），想"把它们整理成一季"——可读取已存在的 standalone metadata 作为参考

## When NOT to Use

- Bible 未冻结 → 报错并提示先跑 series-bible-creator
- 用户只想做一本游离册（不属于任何季）→ 直接调 series-volume-creator --no-season

## Output Layout

```
series-output/<slug>/
├── state.json                           ← 更新 seasons[<id>]
└── seasons/<id>/
    ├── season-arc.md                    ← spec §4.4
    └── volumes-outline.md               ← spec §4.5
```

## Flow (5 steps)

### Step 0 — 上下文加载

读 `state.json`（用 `series-bible-creator/scripts/lib/state.ts` 的 `loadState`）。
- 报告：当前 Bible 版本、已存在的 season 列表（含 arc_locked 状态）、各册 phase 计数。
- 若用户给的 season-id 已存在且 `arc_locked=true` → 询问是覆盖（生成 revision +1）还是退出。

### Step 1 — 本季定位收集

需收集：
- season-id（默认 `s<下一序号>`）
- 季标题
- volumes_planned（参考 series-meta.typical_pages_per_volume × 本季册数）
- 是否承接上季伏笔：若上季 `season-arc.md` 存在，调用 `parseSeasonArc` 提取
  `foreshadowing_for_next_season` 列出来让用户勾选哪些回收。

### Step 2 — 生成 season-arc.md

按 spec §4.4 的 schema 写出，包含：
- 季弧线散文（成长主线）
- `# 给下一季的伏笔` 段（即使是末季也写——可后续被 omnibus 包装时省略）

→ **暂停 / 用户审阅**

### Step 3 — 生成 volumes-outline.md

按 spec §4.5 的 schema 为每册写一段：
```
## <vid> <册名>

- beat: 开篇/递进/转折/高潮/落幕
- pov: ...
- summary: 1-2 句
- characters: [...]
- planned_pages: <int>
- mood: ...
```

使用 `outline-parse.ts` 的 `serializeOutline()` 写出，保证后续 `parseOutline` 可读。

→ **暂停 / 用户审阅**

### Step 4 — 可制作性自检

自动检查（在 SKILL.md 内逐项执行 + 报告）：
- 标题去重：每册标题不重复
- 弧线递进：beat 序列符合"开篇 → 递进 ×N → 转折 → 高潮 → 落幕"模式
- 角色覆盖：所有 `key_turn_points[*].volume` 在 outline 中存在
- 新角色提示：`new_characters` 中提到的角色，若不在 Bible characters.md，提示
  "需先回 series-bible-creator 追加角色卡"
- 字数：每册 summary 不超过 100 字

不通过项 → **直接修改** outline，重新检查；全部通过 → 报告。

### Step 5 — Season Arc Lock

调 `updateState` 写入：
```jsonc
{
  "seasons": {
    "<id>": {
      "title": "...",
      "volumes_planned": <n>,
      "arc_locked": true,
      "started_at": "<now ISO>",
      "outline_revision": 1
    }
  }
}
```

输出指引：
```
✅ 第 <N> 季弧线锁定 (revision 1)
📂 series-output/<slug>/seasons/<id>/
下一步：召唤 series-volume-creator 做第一册
```

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `seasons/<id>/season-arc.md` | volume-creator | opening/ending state, key_turn_points, new_characters |
| `seasons/<id>/volumes-outline.md` | volume-creator (按册取); season-planner 自身（回写 planned_pages 与 revision） | 每册 beat/pov/summary/characters/planned_pages/mood |

volume-creator 在生成单册结束时若实际页数偏离 `planned_pages`，**必须**用
`outline-parse.ts` 的 `parseOutline + serializeOutline` 回写并 `outline_revision++`，
本 skill 在下次执行时会读取最新 revision。

## Common Mistakes

- **跳过 Step 4 自检**：弧线缺角色或重复标题 → 后续 volume-creator 卡死
- **手写 outline 而不调 serializeOutline**：会导致解析失败，下游报错
- **跨季强行加新角色而不回 bible-creator**：当前期不支持 Bible 修订；新角色应作为
  "Season-Local Character" 注释写在 outline 里，但 prompt_anchor 仍需走 bible 流程

## Implementation

- season-arc 解析：`scripts/season-arc-parse.ts`（含单测）
- outline 解析+序列化：复用 `series-season-planner/scripts/outline-parse.ts`（Task 2）
- state 更新：复用 `series-bible-creator/scripts/lib/state.ts`（Task 1）
