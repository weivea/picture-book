---
name: series-omnibus-packager
description: |
  把一个连载绘本系列里若干已 packaged 的册合并为一本合订 EPUB。
  接受范围:某季 (s1 / 第一季)、全部 (全部 / all)、显式列表 (s1v1,s1v3)。
  当用户说"出第一季合订本"、"把这几册合订"、"package omnibus"、
  "merge volumes 1-5 into one EPUB" 时,触发此 skill。
  本 skill 不重新生图,只重新打包既有 PNG;不出有声合集本。
---

# Series Omnibus Packager

把一组已 packaged 的单册 → 一个 Fixed-Layout EPUB3 合订本。

## When to Use

- 用户已用 series-volume-creator 完成至少 1 册（实际值得合订需 ≥2 册）
- 用户希望把若干册组合成一个文件分享 / 上架

## When NOT to Use

- 还没有任何 `phase=packaged` 的册 → 报错并提示先做单册
- 用户想出有声合集本 → 当前不支持（合集页数过多，audio 任务过重）；保持单册有声

## Output Layout

```
series-output/<slug>/
├── state.json                                 ← 追加 omnibus 条目
└── omnibus/
    └── <slug>-<range>.epub                    ← 例如 demo-s1.epub / demo-all.epub
```

## Flow (4 steps; only Step 0 stops)

### Step 0 — 上下文加载 + 范围确认（**唯一暂停**）

读 `state.json`，把用户输入的范围（季 id / 全部 / 显式列表）传给
`series-omnibus-packager/scripts/parse-range.ts` 的 `parseRange(input, state)`：
- `ids` → 待合订的有序册列表
- `skipped` → 在范围内但未 packaged 的册（连同 reason 报告）
- `warnings` → 例如"omnibus of a single volume"

报告完整解析结果 → 暂停等用户确认（或调整范围）。

### Step 1 — 元信息

- 合订 title 默认 `"<series-meta.title> · <range 描述>"`，例如
  `"小熊面包房的故事 · 第一季"`、`"小熊面包房的故事 · 全集"`
- author 沿用 `series-meta`
- lang 沿用 `series-meta.language`
- 输出路径默认 `series-output/<slug>/omnibus/<slug>-<range-slug>.epub`
  - range-slug：`s1` → `s1`；`全部` → `all`；显式列表 → `vN1-vN2-...`
    （超过 5 册取首末 + 总数：`s1v1-...-s2v3-9vols`）

### Step 2 — 调 generate-epub.ts --omnibus

```bash
bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts \
  --omnibus \
  --series-root series-output/<slug> \
  --volumes "<id1>,<id2>,..." \
  --title "<合订 title>" \
  --author "<author>" \
  --lang <lang> \
  --output omnibus/<slug>-<range-slug>.epub
```

### Step 3 — 登记 + 输出

调 `updateState`：
```jsonc
{
  "omnibus": [...existing, {
    "range": "<range-spec 原文>",
    "built_at": "<now ISO>",
    "file": "omnibus/<slug>-<range-slug>.epub"
  }]
}
```

输出指引：
```
✅ 合订本已生成
📂 series-output/<slug>/omnibus/<slug>-<range-slug>.epub
   合并了 <N> 册（跳过 <M> 册：<原因>）
```

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `omnibus/<slug>-<range>.epub` | 用户 | Fixed-Layout EPUB3，每册以 divider XHTML 分隔 |
| `state.json` 中的 `omnibus[]` 条目 | 本 skill 自身 / 用户审计 | range, built_at, file |

## Common Mistakes

- **合订一册**：parse-range 已警告，但仍会成功；建议至少 2 册
- **合订未 packaged 的册**：parse-range 自动跳过并报告，**不**触发生图
- **改名 PNG 文件**：volume-creator 写出的 `<n>.png` 命名是约定的合同，omnibus 直接按编号顺序读
- **想出有声合集本**：本期不支持

## Implementation

| 模块 | 路径 | 来源 |
|---|---|---|
| 范围解析 | `series-omnibus-packager/scripts/parse-range.ts` | Task 5 |
| EPUB 合订 | `picture-book-creator/scripts/generate-epub.ts --omnibus` | Task 6 |
| state I/O | `series-bible-creator/scripts/lib/state.ts` | Task 1 |
