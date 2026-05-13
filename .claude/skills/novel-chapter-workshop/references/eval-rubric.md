# Chapter Eval Rubric

evaluate-chapter.ts 的打分口径。LLM judge 严格按本表打分，不要自由发挥。

## 维度（每项 0–10，整数）

| 维度 | 评分要点 |
|---|---|
| voice_fit | 句感 / 人称 / 时态匹配 voice.md。一处明显违和 -1。 |
| character_distinct | 不同角色的对话/行动是否区分？同质 ≤4，鲜明 ≥7。 |
| beat_coverage | 是否覆盖 outline 指定 beat？缺失=0，浮于表面 ≤4，扎实落地 ≥7。 |
| prose_quality | 句子节奏、动词力度、show-don't-tell 比例。 |
| anti_pattern_residue | 即便正则没抓到，凭直觉还有多少"AI 味"。无 ≥8，明显 ≤3。 |
| scene_clarity | 场景切换是否清晰？SCENE 标记是否落在合理处？ |

`overall = round((voice_fit*1.5 + character_distinct + beat_coverage + prose_quality*1.5 + anti_pattern_residue + scene_clarity) / 7, 1)`

## Mechanical 阈值

| 检测器 | 阈值 | 含义 |
|---|---|---|
| slop_hits Tier 1 | ≤ 0 | Tier 1 是绝对禁用，命中即修 |
| slop_hits Tier 2 | ≤ 3 | 容忍少量惯用表达 |
| pattern_hits | = 0 | 结构禁忌不容忍 |
| dialog_attribution_missing | ≤ 1 | 多于 1 处会让 audio packager 出乱 |

## 通过线

- `mode=draft` 默认通过线：`overall ≥ 6.0` 且 mechanical 三项达标
- `mode=revise` 经 3 轮仍不达标 → 写入 `state.debts`，标记 `status: needs_human`
