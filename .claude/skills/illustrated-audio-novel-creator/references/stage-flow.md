# Stage Flow（详细执行说明）

每个 stage 必做的动作、写入文件、退出条件、人工 GATE 触发时机。

## Stage 0：初始化

1. 由 seed 派生 slug：取前 12 个非标点中文字符 + 拼音首字母 →（如算法复杂直接让用户给）
2. 读 tier-presets.md，根据 tier 决定 `target_words` / `chapter_count`
3. `mkdir -p novel-output/<YYYY-MM-DD>-<slug>/`
4. 写 state.json（phase="init"，包含 seed/tier/target_words/chapter_count/created_at）

## Stage 1：方向草案

1. LLM 自己读 seed + craft-zh.md 的 Wound-Want-Need-Lie 框架
2. **在对话上下文里**草拟：(a) 故事核 200 字 (b) 主角四要素 (c) 中央冲突 (d) 主题
3. 不写文件
4. **GATE-1**：把 (a)–(d) 用 < 25 行报告给用户，等 "OK" 或修改指令

## Stage 2：foundation

1. 让 LLM 按 novel-foundation-builder/SKILL.md 写出 5 个 .md
2. 落盘到 output_dir
3. 调 init-foundation.ts CLI 校验 + 分配 voice + 写 state.json
4. **GATE-2**：把 outline.md 全文 + characters.md 全文 + style.md preset 报告给用户
5. state.phase = "foundation_done"

## Stage 3：drafting

按 outline 顺序，循环 1..N：
1. 调 novel-chapter-workshop mode=draft（让 LLM 按 SKILL.md 写章节 + 跑 evaluate-chapter.ts）
2. 若 mechanical_pass=false 或 LLM judge < 6.0 → mode=revise（最多 3 轮）
3. 3 轮后仍不达标 → 写入 state.debts 类型 `chapter_low_score`，仍标 status=needs_human，但**不阻塞**——继续下一章
4. 每章完成后更新 state.json.chapters[N]={ drafted: true, score: X }
5. 全部完成后 state.phase = "drafted"

## Stage 3.5：Opus review（仅 tier=long）

详见 SKILL.md "Opus review 循环"。最多 3 轮，每轮调 1 次 Opus，每次只修 top 3 章。
完成后 state.phase = "revised"。
short / medium：跳过本 stage，直接 revised = drafted。

## Stage 4：illustration

1. 调 illustrate-chapter.ts --mode portraits-only
2. **GATE-3**：列出 portraits/*.png + 缩略报告（角色名 + 锚定短语 + 文件路径），等用户确认
3. 若用户拒绝某张 → 删除 → 调整 anchor → 重生
4. 用户 OK → 按章循环调 illustrate-chapter.ts --mode all
5. 每章完成后：让 LLM 按 recheck-prompt.md 对每张 scene 图做 vision recheck，写回 scene_NN.meta.json.recheck；needs_regen → 重生 1 次
6. 全部完成 state.phase = "illustrated"

## Stage 5：抽查（自动）

1. 抽 3 章正文（首章 + 中段章 + 末章）+ 3 张插图（首章首图 + 中段中图 + 末章末图）
2. 用 < 30 行汇报给用户：每章 word_count / score / debt 状态；每图 prompt + recheck 结果
3. **GATE-4**：等 OK；若用户挑出问题 → 回到对应 sub-skill 修复后回到 Stage 5 复核

## Stage 6：packaging

1. 调 package-novel.ts --stage all
2. 完成后 state.phase = "packaged"

## Stage 7：交付报告

回放：
- output_dir 路径
- dist/*.epub / *.md 路径
- 每章 word_count / score
- portraits + illustrations 计数
- debt 列表（按类型分组）
- "下一步建议"：epub 用 Thorium 打开测试；mp3 用任意播放器
