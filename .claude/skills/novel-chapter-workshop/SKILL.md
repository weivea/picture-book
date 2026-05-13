---
name: novel-chapter-workshop
description: Use to draft, evaluate, and revise a single chapter of an illustrated audio novel. Reads world / characters / outline / voice / style produced by novel-foundation-builder. Output is a finalized chapter Markdown with embedded scene markers ready for scene-illustrator. Always invoked by `illustrated-audio-novel-creator` per chapter; can also be used standalone to retry one chapter.
---

# Novel Chapter Workshop

## When to invoke

- foundation 已就绪（`<output_dir>/state.json` 中 `phase` ≥ `foundation_done`）
- 需要写**一章**或修订**一章**
- 不要一次性传"写所有章节"——主编排器会按章循环调用

## Inputs

| 字段 | 来源 |
|---|---|
| `output_dir` | 项目目录 |
| `chapter_n` | 当前章节号（int） |
| `mode` | `draft` \| `revise` \| `evaluate-only` |
| `prev_chapter_path?` | 上一章路径（draft 时用于衔接） |

## Outputs

写入 `<output_dir>/chapters/ch_<NN>.md`：

```markdown
---
chapter: 5
title: "门后之物"
pov: 林晚
beat: Catalyst
word_count: 2840
score: 7.4
status: ready
---

<!-- SCENE: 林晚走进废墟 | location: 北郊废墟 | mood: tense | participants: 林晚 -->
正文…
<!-- /SCENE -->

<!-- SCENE: 沈渊出场 | location: 北郊废墟 | mood: ominous | participants: 林晚, 沈渊 -->
正文…
<!-- /SCENE -->
```

`<output_dir>/chapters/ch_<NN>.eval.json`：评估明细（slop hits / pattern hits / LLM judge 分数）

## Process

### Mode = draft

#### Step 1：读上下文

读取 `world.md` / `characters.md` / `outline.md` / `voice.md` / `style.md` / `state.json`。  
仅取 outline 中"当前章节 + 前后各 1 章"的 summary（防过载）。  
读取 `references/draft-prompt-template.md`、`references/anti-slop-zh.md`（禁用词清单）、`references/anti-patterns.md`（结构禁忌）、`references/scene-marker-spec.md`（行内标记格式）。

#### Step 2：写章节

按 draft-prompt-template.md 的"写作要求"产出正文，必须：
- 句感、人称、时态严格遵循 voice.md
- 对话必须使用角色名而非代词描述（便于 packager 切多 voice）
- **每个明显场景切换处插入 SCENE 标记**（见 scene-marker-spec.md），首章 ≥ 2 段，长章 ≥ 4 段
- 不得出现 anti-slop-zh.md Tier 1 词汇
- 不得违反 anti-patterns.md 的"段首十条"

#### Step 3：自评 + 入库

调用脚本：
```bash
bun run .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts \
  --chapter <output_dir>/chapters/ch_<NN>.md \
  --voice <output_dir>/voice.md
```
输出 `ch_<NN>.eval.json`。若 score < 6.0 → 触发 mode=revise；否则写 frontmatter `status: ready` 并更新 state.json。

### Mode = revise

#### Step 1：读 eval.json + 章节当前内容
列出失败项（slop hits / pattern hits / judge 反馈）。

#### Step 2：定向重写
对每个 hit 走 surgical edit（不重写全章），优先级：anti-pattern > slop > judge 建议。  
保留 SCENE 标记的位置与 id；只能修改标记内的正文。

#### Step 3：重新评估
跑 evaluate-chapter.ts 二次评估，分数 ≥ 6.0 即结束；否则继续，最多 3 轮。3 轮仍不达标 → 写 frontmatter `status: needs_human` 并写入 `state.debts`。

### Mode = evaluate-only

只跑 evaluate-chapter.ts；不修改正文。

## Quality bar

每章交付前必须满足：
- [ ] mechanical slop_score ≤ 5（见 eval-rubric.md 阈值表）
- [ ] anti-pattern hits = 0（结构性禁忌）
- [ ] LLM judge overall ≥ 6.0
- [ ] 至少 2 个合法 SCENE 标记
- [ ] word_count 在 outline 提示的 ±20% 区间

## References

- `references/draft-prompt-template.md`
- `references/eval-rubric.md`
- `references/scene-marker-spec.md`
- `references/anti-slop-zh.md`
- `references/anti-patterns.md`
- `references/craft-zh.md`
