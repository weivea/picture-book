# 网漫小说风格预设

> 类比 `picture-book-creator/references/style-presets.md`，但面向**网漫范式**：偏向二次元、动漫、写实场景，不走"幼儿绘本"路线。
> 由 `novel-foundation-builder` 在阶段 1 写 `style.md` 时引用，由 `scene-illustrator` 在生成 prompt 时拼接。

## Schema

每个 preset 包含：
- `name`：中文名
- `bestFor`：适配题材
- `promptPrefix`：英文 prompt 前缀（拼到每张图最前）
- `negative`：负面提示词

## Preset 1：清新水彩（默认）

- **bestFor**：青春、校园、治愈、轻奇幻
- **promptPrefix**：
  ```
  Soft watercolor illustration, gentle pastel palette, clean linework with watercolor wash background,
  cinematic but warm composition, anime-influenced character design, slight bloom highlights,
  paper texture barely visible, 2D, clean, expressive faces
  ```
- **negative**：
  ```
  no photorealism, no 3D render, no harsh shadows, no oil painting texture, no manga screentones,
  no watermark, no signature, no text overlay
  ```

## Preset 2：厚涂二次元

- **bestFor**：战斗、奇幻冒险、热血番风格
- **promptPrefix**：
  ```
  Detailed anime illustration with thick painterly brushwork, dynamic composition, dramatic lighting,
  rich color palette with strong contrast, expressive cinematic poses, semi-realistic anatomy,
  detailed background, key visual quality
  ```
- **negative**：
  ```
  no flat color fill, no chibi proportions, no photorealism, no 3D, no watermark, no text overlay
  ```

## Preset 3：写实素描

- **bestFor**：悬疑、推理、年代、严肃题材
- **promptPrefix**：
  ```
  High-detail pencil sketch with selective ink wash, monochrome with single accent color,
  realistic anatomy and clothing, atmospheric perspective, film noir lighting, hatching shading,
  graphic novel quality
  ```
- **negative**：
  ```
  no full color, no anime style, no cartoonish exaggeration, no 3D, no watermark
  ```

## Preset 4：国风工笔

- **bestFor**：仙侠、古言、东方奇幻
- **promptPrefix**：
  ```
  Chinese gongbi-style illustration, fine ink linework, traditional silk-painting palette
  (jade green, vermilion, indigo, gold), graceful flowing fabrics, intricate hair ornaments,
  cloud and ink-wash background, painted on rice paper aesthetic, semi-realistic anime hybrid
  ```
- **negative**：
  ```
  no western fantasy elements, no plate armor, no sci-fi, no photorealism, no 3D, no watermark
  ```

## Preset 5：赛博朋克

- **bestFor**：科幻、近未来、反乌托邦
- **promptPrefix**：
  ```
  Cyberpunk anime illustration, neon-lit night cityscape, holographic UI elements, rain-slick streets,
  high-saturation magenta and cyan accents, hard-edged character design with cyberware details,
  cinematic wide-angle composition, blade-runner influence
  ```
- **negative**：
  ```
  no medieval fantasy, no pastoral, no daylight scene unless specified, no watermark
  ```

## 自由组合规则

- `style.md` 默认引用 1 个 preset 作为基线
- 用户可在 voice.md 之外覆写 `promptPrefix` / `negative`，但不要删除 preset 的"质量约束"部分（"no watermark"等）
- scene-illustrator 拼 prompt 顺序：`promptPrefix` → 角色锚定短语 → 场景描述 → `negative`
