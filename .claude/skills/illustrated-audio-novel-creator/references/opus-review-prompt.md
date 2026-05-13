# Opus Review Prompt

仅 tier=long 使用。在每轮调用前由主编排器把全 manuscript（chapters/ch_*.md 拼接，去 SCENE 标记）作为输入，套用本 prompt。

## Prompt（送给 Claude Opus）

```
你将分别以两个身份审阅一部下面给出的中文小说：
1. 文学评论家（关注主题深度、人物纵深、节奏、文体）
2. 小说写作教授（关注技法、结构、可读性、情节漏洞）

请按下列格式输出：

## 评论家视角
- [严重 | 中等 | 微小]：<具体问题，引用章节号 + 段落特征>
- ...
（不必凑数；如无显著问题请说明"无显著问题"）

## 教授视角
- [严重 | 中等 | 微小]：<具体问题 + 建议改法>
- ...

## 综合 actionable 列表
按优先级 1..K 给出"如果只能改 3 处，应该改哪 3 处"，每条含：
- chapter: <N>
- issue: <一句话>
- suggested_fix: <一句话>

## 停止判据
- 如果"严重"项 = 0 且"中等"项 ≤ 2，请在末尾输出：`STOP_CONDITION_MET`
```

## 解析

主编排器负责：
1. 抓 `STOP_CONDITION_MET` → 若存在则结束循环
2. 否则解析"综合 actionable 列表"，提取 top 3 items 写入 brief：
   ```
   <output_dir>/briefs/round_<R>_top_<I>.md
   ```
3. 对每个 brief 调 chapter-workshop mode=revise，把 brief 内容塞进对话
4. 完成 → 重跑 Opus

## 边界

- 单轮 Opus 输入大约不能超过 200K tokens；long tier 72K 字 ≈ 110K tokens（中文每字约 1.5 token），安全
- 输出超 5000 字的 review 视为异常 → 让 LLM 重提
