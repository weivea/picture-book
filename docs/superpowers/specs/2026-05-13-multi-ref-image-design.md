# 多参考图（multi-ref）支持 — 设计文档

- 日期：2026-05-13
- 范围：`.claude/skills/image-generation`、`.claude/skills/scene-illustrator`
- 缘起：当前 image-generation 在 `/edits` 端点上硬限制 `--ref` ≤ 1，
  scene-illustrator 因此只能用首位 participant 的立绘做角色锚定，多人同框场景一致性差。
  Microsoft 文档（[Azure OpenAI Image Edit API][doc]）已经支持 multipart 中重复 `image`
  字段提交多张参考图，并新增 `input_fidelity` 控制角色还原度，本设计放开这一限制。

[doc]: https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview?tabs=rest#image-generations---edit

## 决策

| 维度 | 决定 |
|---|---|
| 单 scene 最多参考图张数 | **6** |
| scene-illustrator 默认 ref 选取 | **所有 participants 的 portrait（存在文件的）** |
| `input_fidelity` 默认 | **`high`** |
| `input_fidelity` 暴露方式 | **不出现在 CLI**；通过环境变量 `IMAGE_GEN_INPUT_FIDELITY` 调整或关闭 |
| Azure REST API 版本 | DEFAULT_ENDPOINT 占位升级到 **`2025-04-01-preview`**；用户自有 endpoint 不动 |
| 向后兼容 | **完全兼容**：单 ref 是多 ref 的退化情形，picture-book-creator 等只传 1 张 ref 的调用方零改动 |
| 部署模型差异 | 当前部署是 `gpt-image-2`，Microsoft 文档把多 image / `input_fidelity` 标注为 "only gpt-image-1 series"；用 `IMAGE_GEN_INPUT_FIDELITY=off` 作为逃生阀 |

## 1. 架构

两个 skill 的边界保持不变：

- **image-generation（底层）**：`prompt + N 张参考图（0..6）→ 1 张 PNG`。负责
  multipart 拼装、API 选路（`/generations` vs `/edits`）、速率门、退避重试、压缩落盘。
  `input_fidelity` 在脚本内部决定（默认 `high`），不出现在 CLI 表面。
- **scene-illustrator（上层）**：决定"哪些 portrait 进 ref"的语义；调用 image-generation 时
  把 0..N 个 portrait 路径作为多次 `--ref` 传入。

## 2. 数据流

### 2.1 调用方视角（CLI 不变）

```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --output <path> [--prompt "..."] \
  [--ref a.png] [--ref b.png] ... [--ref f.png]   # 0..6
```

### 2.2 image-generation 内部分支

- `refPaths.length === 0` → 走 `/generations`，body 与今天一致
- `refPaths.length >= 1` → 走 `/edits`，multipart body：
  - 对每个 ref：`form.append("image", new Blob(buf, {type: mime}), basename)`
    （**字段名都是 `image`，重复 N 次**，与 Microsoft 文档完全一致；不是 `image[]`，
    不是 `image[0]/image[1]`，不是 JSON 数组）
  - `prompt`、`size`、`quality`、`output_format=png`、`n=1` 不变
  - 若 `IMAGE_GEN_INPUT_FIDELITY ∉ {"off"}`，append `input_fidelity = <值>`（默认 `"high"`）
- 文件类型探测：仅读首字节 magic
  （PNG = `89 50 4E 47`，JPG = `FF D8 FF`），其他格式拒绝；MIME 设为 `image/png` 或 `image/jpeg`
- 单 ref 大小校验：`> 50 MB` → die（与 Azure 服务端约束对齐，避免上传后才被拒）

### 2.3 scene-illustrator 内部分支

- `scene-prompt-builder.ts`：`BuildResult.refPath: string | null` →
  `BuildResult.refPaths: string[]`，内容 = 所有存在 portrait 文件的 participants
- `illustrate-chapter.ts`：把 `--ref refPath` 单次 push 改成
  ```ts
  for (const p of refPaths) args.push("--ref", p);
  ```
- `scene_NN.meta.json`：`refUsed: string | null` → `refsUsed: string[]`
  （命名向 SKILL.md Quality bar 中已存在的 `refsUsed.length ≥ 1` 表述对齐）
- portrait 文件不存在的容错：跳过该 ref（不 die），让模型靠 prompt 描述兜底；
  若结果是 0 ref 则走 `/generations`，与现今行为一致

## 3. 接口契约

### 3.1 image-generation CLI

唯一一个语义变化：`--ref` 上限从 1 提到 6。

| 字段 | 之前 | 之后 |
|---|---|---|
| `--ref <path>` | 0 或 1，> 1 die | 0..6，> 6 die |
| `--input-fidelity` | — | **不暴露**（在 scene-illustrator 内部决定，依赖 env） |
| `IMAGE_GEN_INPUT_FIDELITY` env | — | `high`（默认）\| `low` \| `auto` \| `off`，其它值 die |
| `DEFAULT_ENDPOINT` 占位的 api-version | `2024-02-01` | `2025-04-01-preview`（仅注释/文档；用户自有 endpoint 不动） |

### 3.2 scene-illustrator lib

| 函数 / 字段 | 之前 | 之后 |
|---|---|---|
| `BuildResult.refPath: string \| null` | 单 ref | `BuildResult.refPaths: string[]`，0..N |
| `buildScenePrompt` | 取首位 participant | 取所有 participants 中 portrait 文件存在者，按 participants 顺序 |

### 3.3 元数据 schema

`scene_NN.meta.json`：
- 字段重命名：`refUsed: string | null` → `refsUsed: string[]`
- 不做迁移：旧 meta 文件下次跑会被覆盖；如用户保留旧 meta，仍可读，仅字段名不同

### 3.4 SKILL.md 文档同步

- `image-generation/SKILL.md`：
  - 删 "When NOT to Use" 中"`--ref` 不支持多张"
  - "Reference-image Mode" 节改成"接受 0..6 张 `--ref`"
  - 新增 `IMAGE_GEN_INPUT_FIDELITY` 进环境变量表
  - 错误表新增几行（详见 §4）
  - DEFAULT_ENDPOINT 占位串里 api-version 同步
- `scene-illustrator/SKILL.md`：
  - "并行派发" 段改成"所有 participants 的 portrait 都进 ref（最多 6 张）"
  - meta.json schema 注释 `refUsed` → `refsUsed`

## 4. 错误处理

沿用现有"非零退出 + stderr 单行"风格。

| stderr 关键字 | 触发条件 | 调用方处置 |
|---|---|---|
| `--ref 当前最多支持 6 张参考图（收到 N 张）` | N > 6 | 修参数 |
| `--ref 文件不存在：<path>` | 已有，不变 | 同前 |
| `--ref <path> 不是合法 PNG/JPG（magic 字节失败）` | 文件不是 PNG/JPG | 修参数 |
| `--ref <path> 大小 X MB 超过 50 MB 单文件上限` | 单 ref > 50MB | 压缩或换图 |
| `IMAGE_GEN_INPUT_FIDELITY 必须是 high\|low\|auto\|off，收到 "X"` | env 非法 | 修 env |
| `API 返回 400 ...` + 自动追加 HINT 行（见下） | gpt-image-2 不识别 input_fidelity | 在 .env 设 `IMAGE_GEN_INPUT_FIDELITY=off` 重试 |

**HINT 增强**：4xx 响应 body 包含子串 `input_fidelity` 时，stderr 末尾自动追加：

```
[generate-image] HINT: 当前部署可能不识别 input_fidelity。在 .env 设置 IMAGE_GEN_INPUT_FIDELITY=off 重试。
```

**保留行为**：速率门 / 并发上限 / 退避重试 / 压缩落盘 完全不变；网络错误、429、5xx、
4xx 走原有路径；scene-illustrator 的 fail-fast 语义不变。

## 5. 测试

### 5.1 image-generation（不依赖真实 Azure，全部 unit）

| 文件 | 变化 |
|---|---|
| `test/ref-mode.test.ts` | 删 "rejects more than 1 --ref"；新增 "accepts up to 6 --ref" + "rejects 7 --ref" |
| 新增 `test/multi-ref-form.test.ts` | mock `fetch`，断言 multipart body 包含 N 个 `name="image"` 字段，且 binary 顺序 = 传入路径顺序 |
| 新增 `test/input-fidelity.test.ts` | 默认 `input_fidelity=high` 出现在 form；`IMAGE_GEN_INPUT_FIDELITY=off` 完全不含；`=low/auto` 各自正确；非法值 die |
| 新增 `test/ref-magic.test.ts` | 给非 PNG/JPG 的二进制文件，断言 die |

### 5.2 scene-illustrator

| 文件 | 变化 |
|---|---|
| `test/scene-prompt-builder.test.ts` | 把 `refPath` 断言改成 `refPaths: string[]`；加一个 "缺 portrait 文件被自动跳过" case |
| 新增 `test/illustrate-chapter.refs.test.ts`（轻量集成） | fixture chapter + portrait 目录，stub `runImageGen`，断言传入 `--ref` 出现次数 = scene.participants 中存在 portrait 的数量 |

### 5.3 真实 Azure smoke check（手测，不进 CI）

- 1 张 ref → `/edits` 成功（基线）
- 3 张 ref → `/edits` 成功（验证 multi-image 在 gpt-image-2 上是否实际可用）
- 3 张 ref + `IMAGE_GEN_INPUT_FIDELITY=off` 成功（验证 fallback 路径）

### 5.4 通过门槛

- 所有 unit test 绿
- 至少一次真实 3-ref smoke 成功 + meta.json 写入 `refsUsed.length === 3`
- `bun test` 输出贴回会话（verification-before-completion）

## 6. 非目标 / YAGNI

- 不引入 mask（区域编辑）
- 不引入 streaming / partial_images
- 不引入 `n > 1`（生成多候选）
- 不为 picture-book-creator 自动改造 ref 选取逻辑（picture-book-creator 当前不用 ref，
  即便未来需要也可单独传，不影响本次设计）
- 不抽 image-generation-v2 新 skill；本次直接原地升级
- 不引入 feature flag 双轨；单 ref 是多 ref 的退化情形

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `gpt-image-2` 部署不识别 `input_fidelity` 字段，返回 400 | 自动 HINT 行 + `IMAGE_GEN_INPUT_FIDELITY=off` 逃生阀 |
| `gpt-image-2` 部署不接受多 `image` 字段，返回 400 | smoke check §5.3 第二项暴露问题；若失败，调用方降级到只传 1 张 ref（CLI 兼容），并在 SKILL.md 标注此限制 |
| 旧 meta.json 文件字段名不匹配新代码 | meta 是写出物，下次跑覆盖；不读旧字段 → 无破坏 |
| 多 ref 大幅增加 multipart body 体积 → 上传超时 | 单 ref 50 MB 校验 + 现有重试机制兜底；portrait 通常 < 1 MB，6 张 < 6 MB 远低于阈值 |

## 8. 实施顺序提示（供后续 writing-plans 参考）

1. image-generation：放开上限 + multipart 多 image + input_fidelity + magic 校验 + HINT
2. image-generation：unit test 全绿
3. scene-illustrator lib：`refPaths` 重构 + 测试
4. scene-illustrator script：`--ref` 多次传 + meta schema + 测试
5. SKILL.md 双方文档同步
6. 真实 Azure smoke check（用户配合）