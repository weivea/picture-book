# Character Anchor Spec

定义"角色锚定短语"的写法与拼接规则。foundation-builder 写入 characters.md 的 `appearance` 字段必须遵守本规范，scene-illustrator 才能稳定出图。

## 锚定的目标

让同一个角色在不同场景图里**视觉特征不漂移**：发色 / 发型 / 服饰主色 / 显著特征（眼罩、刀疤、瞳色、配饰等）三选二保持稳定。

## 写法（英文短语，便于 image API）

```
<hair color + style>, <主要服饰 + 颜色>, <显著特征>
```

例：
- `long silver hair tied with red ribbon, dark green robe, milky-white blind eyes`
- `short black hair shaved at the sides, navy military coat, vertical scar across left eye`
- `wavy auburn hair, ivory linen dress, golden hairpin shaped like a phoenix`

## 必须

- 全英文（中文 appearance 在不同模型里漂移更剧烈）
- 三选二原则：颜色锚定 + 服饰锚定 + 特征锚定 至少满足两类
- 不超过 25 个 token（过长会稀释强约束词）

## 不要

- 不要写心理特征（"温柔"、"忧郁"）— 模型会改外貌去匹配
- 不要写镜头（"close-up"）— 那是 scene-prompt-builder 的事
- 不要写情绪（"smiling"）— 由场景描述决定

## 拼接规则（scene-prompt-builder 怎么用）

对一个 scene，最终 prompt 顺序：

```
<style.promptPrefix>,
<scene mood/composition descriptor>,
<participant_1 anchor>, <participant_2 anchor>, ...,
<scene body 摘要 → 英文动作描述>,
<style.negative>
```

第一个 participant 的 portrait 作为 `--ref` 传给 image-to-image API（强锚定）。  
其余 participant 仅靠文本锚定（弱锚定）—— 但配合 mood/composition 通常足够。
