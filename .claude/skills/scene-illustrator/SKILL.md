---
name: scene-illustrator
description: Use to generate consistent character illustrations for all SCENE blocks in a chapter (or a single scene). Reads style.md / characters.md / chapter Markdown; produces PNG files plus a per-scene metadata JSON. Always invoked by `illustrated-audio-novel-creator` after chapter-workshop finishes a chapter; can also be used standalone to retry one scene.
---

# Scene Illustrator

## When to invoke

- 章节文件已存在且 mechanical_pass=true
- 角色立绘（portraits）已存在；若不存在，本 skill 会先生成
- 不要在 SCENE 标记不齐的章节上跑（请先回 chapter-workshop 修订）

## Inputs

| 字段 | 来源 |
|---|---|
| `output_dir` | 项目目录 |
| `chapter_n` | 章节号 |
| `mode` | `all` \| `scene <i>` \| `portraits-only` |

## Outputs

```
<output_dir>/
├── portraits/
│   ├── <name>.png            # 立绘（每角色 1 张，1024×1024）
│   └── <name>.meta.json      # 该立绘的 prompt + anchor
├── illustrations/ch_<NN>/
│   ├── scene_01.png          # 场景图（默认 1024×1024）
│   ├── scene_01.meta.json    # { sceneIndex, prompt, refsUsed, recheck }
│   └── ...
└── state.json                # 更新 chapters[N].illustrations = <count>
```

## Process

### Phase A：portraits（每项目仅一次）

如果 `<output_dir>/portraits/` 不存在或角色未齐，对每个 character.appearance：

1. 读 `style.md` 的 `promptPrefix` + `negative` + `palette`
2. 读 `characters.md` 该角色的 `appearance` 字段（英文锚定短语）
3. 拼 prompt = `promptPrefix` + `, character portrait, ` + `appearance` + `, neutral background`
4. 调 image-generation：
   ```bash
   bun run .claude/skills/image-generation/scripts/generate-image.ts \
     --prompt "<prompt>" \
     --output <output_dir>/portraits/<name>.png \
     --ratio 1:1 \
     --size 1024x1024 \
     --quality high
   ```
5. 写 `<name>.meta.json`：`{ prompt, anchor: <appearance>, generatedAt }`

完成后**人工检查环节**（见主编排器 stage-flow.md）：用户确认立绘可用，再进入 Phase B。

### Phase B：scenes（每章一次，按 mode）

#### Step 1：解析章节 SCENE 块

```bash
bun run .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts \
  --output-dir <output_dir> --chapter <N> --mode all
```

脚本内部：
1. 调 `scene-marker-parser.parseScenes(ch.md)`
2. 对每个 scene，按 mode 过滤
3. 对每个待出图 scene（**Promise.all 并行派发**，由 image-generation 的速率门统一节流到 Azure RPM 上限）：
   - 拼 prompt（见 scene-prompt-builder.ts）
   - 收集 refs：`scene.participants` 中每人的 portrait 路径
   - 文件不存在的 portrait 自动 skip（让模型靠 prompt 描述兜底）
   - 调 image-generation，**所有存在 portrait 的 participants 都作为 `--ref` 多次传入**
     （image-to-image 多角色锚定，最多 6 张 — image-generation 内部上限）
   - 落盘 PNG + meta.json（`refsUsed` 为本张图实际使用的 ref 路径数组）

> 任意一张失败 → `Promise.all` 立即抛错，章节生成中断（fail-fast）。失败 scene 用 `--mode scene --scene-index <i>` 单独重试。

#### Step 2：一致性 recheck（Tier 1.5）

每张 scene 图生成后：
1. 读 `references/recheck-prompt.md`
2. 调 LLM（vision），输入：scene 图 + 该 scene 中每个 participant 的 portrait
3. 让 LLM 返回 `{ consistent: true|false, drift: ["头发颜色变了", ...] }`
4. 若 `consistent=false` 且 drift 涉及"颜色/发型/服饰主色"等强锚定特征 → 自动重生（最多 1 次）
5. 把 recheck 结果写入 `scene_NN.meta.json.recheck`

#### Step 3：更新 state

成功生成的张数写入 `state.json` 的 `chapters[N].illustrations`。  
若有 scene 重试一次仍 inconsistent → 写入 `state.debts`，但**不阻塞**主流程。

## Quality bar

- [ ] portraits 每个角色 1 张，且 prompt 中包含 appearance 锚定
- [ ] 每张 scene 图：refsUsed.length = 存在 portrait 的 participants 数量（0 表示 participants=空 或 portraits 全缺失）
- [ ] recheck 通过率 ≥ 80%
- [ ] illustrations 总数 ≈ Σ scene_count（允许 ±10%）

## References

- `references/character-anchor-spec.md`
- `references/recheck-prompt.md`
- `../novel-foundation-builder/references/style-presets-novel.md`
- `../novel-chapter-workshop/references/scene-marker-spec.md`
