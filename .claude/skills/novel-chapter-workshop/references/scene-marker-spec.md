# Scene Marker Spec

章节 Markdown 内嵌的"场景块"语法。供 scene-illustrator 直接切片生成插图。

## 格式

```markdown
<!-- SCENE: <一句中文场景标题> | location: <地点> | mood: <情绪标签> | participants: <角色名 1>, <角色名 2> -->
正文段落（一段或多段）...
<!-- /SCENE -->
```

## 字段

- `SCENE`（必填）：3–15 字中文标题，将作为插图 caption
- `location`（必填）：来自 world.md 的地名，或自洽的新地点
- `mood`（必填）：从这 12 选 1 — `calm` / `tense` / `ominous` / `melancholy` / `joyful` / `fearful` / `awe` / `defiant` / `tender` / `furious` / `lonely` / `mysterious`
- `participants`（必填）：当前镜头里**可见**的角色名（characters.md 中已定义），逗号分隔；无人时写 `none`

## 触发何时切 SCENE

按"网漫范式"约 800–1000 字 1 张图的密度，但**触发优先于密度**：

1. 物理地点变更
2. 时间显著跳跃（"三日后"、"次日清晨"）
3. POV 角色心理状态反转
4. 关键道具首次出现
5. 新角色登场（即便地点未变）

## 嵌套与重叠

- 不允许嵌套（`<!-- SCENE -->` 内不能再开 `<!-- SCENE -->`）
- 不允许重叠（必须先 `</SCENE -->` 才能开新的）

## 解析约束

- 标题 / location / mood / participants 之间用 ` | ` 分隔（空格 + 管道 + 空格）
- 不允许换行写 frontmatter
- 注释符号必须是 HTML 注释 `<!--` / `-->`，前后空格不省

## 示例（完整一章片段）

```markdown
## Chapter 5: 门后之物

<!-- SCENE: 林晚走入废墟 | location: 北郊废墟 | mood: tense | participants: 林晚 -->
她的手指掠过墙面，灰尘像旧雪一般落下。林晚听见自己的呼吸……
<!-- /SCENE -->

<!-- SCENE: 沈渊的低语 | location: 北郊废墟 | mood: ominous | participants: 林晚, 沈渊 -->
"你不该来这里。"沈渊的声音从黑暗里钻出来……
<!-- /SCENE -->
```
