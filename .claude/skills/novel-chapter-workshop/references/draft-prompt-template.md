# Draft Prompt Template

LLM 在 mode=draft 时**自我对照**的 prompt 模板。不要直接把本文复制给用户；它是给执行者读的"我应该怎么写一章"checklist。

## 输入信息（从主流程组装）

```
<world_excerpt>      # 截取与本章相关的 1–2 段 world.md
<characters_block>   # 仅本章 POV + 出场角色
<outline_block>      # 当前 + 前后 1 章 summary
<voice_full>         # voice.md 全文
<style_anchors>      # 当前出场角色的 appearance 锚定短语
<prev_chapter_tail>  # 上一章最后 200 字（衔接用，draft only）
```

## 写作要求（顺序即优先级）

1. **节拍**：本章必须落在 outline 指定的 beat 上（如 "Catalyst" / "Midpoint"）。开篇 200 字必须出现"催化事件"或对其的张力。
2. **人称 / 时态 / 句感**：100% 跟随 voice.md。第一段就要"听起来对"。
3. **对话归属**：每段对话**必须**带说话人名字（"林晚说" / "沈渊低声"）。不要靠代词或描写代替。这是 audio packager 切声的硬约束。
4. **场景切换 → 加标记**：物理位置变化、时间跳跃、视角转移、关键情绪反转 → 都要切 SCENE 块。格式见 scene-marker-spec.md。
5. **show vs tell**：感情用动作/感觉显，不用形容词命名。"她生气了" → ✗；"她把杯子扣在桌上，瓷裂" → ✓。
6. **禁用词**：开始写之前先看 anti-slop-zh.md Tier 1 列表，写完后自查。
7. **结构禁忌**：开篇不能用 anti-patterns.md "段首十条"中任何一条。
8. **字数**：贴近 outline 的 scene_count_hint × 600（每场景约 600 字）。

## 推荐写作流程

1. 写一段"开场镜头"草稿（200 字），自问：是否落在 beat？是否合 voice？
2. 不合 → 重写第 1 段；合 → 继续。
3. 按场景切块写，每个 SCENE 写完检查"对话归属是否完整"。
4. 全章写完 → 自查禁用词 → 自查结构禁忌 → 调 evaluate-chapter.ts。
