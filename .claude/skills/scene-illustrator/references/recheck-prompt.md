# Recheck Prompt（Tier 1.5 一致性回扫）

## 触发

每张 scene 图生成后调一次。**只看强锚定特征**——颜色、发型、服饰主色、显著特征。  
不要打表情或姿势的分（那是场景该决定的）。

## 输入装配

- 主图：`scene_NN.png`
- 参考图：scene 中每个 participant 的 `<name>.png` 立绘
- 文本：每个 participant 的 anchor 短语

## Prompt（送给 vision LLM）

```
你是一位插图编辑。检查一张场景插画里的角色与参考立绘是否在以下"强锚定特征"上一致：
- 发色 / 发型轮廓
- 主要服饰的颜色
- 显著特征（如刀疤、眼罩、瞳色、配饰）

不要评价表情、姿势、镜头、背景、画质。

对每个角色，输出 JSON：
{
  "name": "<角色名>",
  "consistent": true | false,
  "drift": ["发色由银变为金", "..."]   // 仅在 consistent=false 时填
}

最后输出 overall：
{
  "overall_consistent": <true 当且仅当所有角色都 consistent=true>,
  "needs_regen": <true 当 overall_consistent=false 且 drift 涉及主色/主特征>
}
```

## 决策

- `needs_regen=true` → scene-illustrator 自动重生（最多 1 次）。第二次仍失败 → 接受当前图，但写入 state.debts
- `needs_regen=false` 但 `overall_consistent=false` → 接受当前图（仅微调，不重生）
