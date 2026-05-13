# Tier Presets

3 档参数表。LLM 在 Stage 0 按本表派生 chapter_count / target_words。
插图密度遵循"网漫范式"——每 800–1000 字 1 张图（章首装饰图不算）。

| tier | chapter_count | words/chapter | total_words | beat_structure | est. illustrations | est. duration (TTS, ~250 字/分钟) |
|---|---|---|---|---|---|---|
| short | 5 | 2000 | 10,000 | 5-act | 10–15 | 40 min |
| medium | 12 | 2500 | 30,000 | 9-beat | 30–45 | 2 h |
| long | 24 | 3000 | 72,000 | save-the-cat-15 | 80–120 | 5 h |

## 派生规则

- `target_words = chapter_count × words/chapter`
- `est. illustrations` 由各章 outline 的 `scene_count_hint` 加总（参考表中的范围）
- `est. duration` 仅做用户预期管理，不参与执行流程

## 用户可覆盖

- 用户在 Stage 1 GATE-1 之前可以修改 chapter_count / words/chapter
- 修改后 LLM 必须重新派生 target_words 并写入 state.json，下游一切以 state.json 为准
- 不要在 Stage 2 之后改 tier（会让 outline / portraits / 已写章节失配）

## tier 与 Opus review

- short / medium：仅自动 mechanical + LLM judge revise
- long：额外 Opus review 循环（最多 3 轮，每轮修 top 3 章）

## 与子 skill 的对应

| 子 skill | 接收的 tier 字段 |
|---|---|
| novel-foundation-builder | tier（决定 outline.beat_structure）+ target_words + chapter_count |
| novel-chapter-workshop | 不直接看 tier，但 word_count 校验依赖 outline 的 scene_count_hint × 600 |
| scene-illustrator | 不依赖 tier；仅按 SCENE 标记数生成 |
| audio-novel-packager | 不依赖 tier；按已存在的章节列表打包 |
