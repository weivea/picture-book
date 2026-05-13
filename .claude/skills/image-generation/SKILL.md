---
name: image-generation
description: |
  Use when needing to generate one PNG image from a text prompt via the Azure
  gpt-image-2 deployment. Triggered by picture-book-creator (one call per page)
  or any task that says "generate image", "make a picture", "render this prompt
  to PNG". One invocation = exactly one image; the skill enforces a global
  rate limit (default 2 RPM = one request per ~35 s, override via
  `IMAGE_GEN_MIN_INTERVAL_MS`) and retries 429/5xx up to 3 times with
  Retry-After-aware backoff. Requires AZURE_API_KEY env var.
---

# Image Generation

通过 Azure 部署的 `gpt-image-2` 模型，把一段 prompt 渲染成单张 1024×1024 PNG，
落盘前会经过 `pngquant + oxipng` 高保真压缩，目标单图 ≤800 KB（典型 400-700 KB），
肉眼无差别。压缩失败时静默回退到原图（exit 0，stderr 一行 WARN）。

## When to Use

- picture-book-creator 阶段 6.2 派发的逐页生图（每页一次调用）
- 任何"prompt → 1 张 PNG"的需求

## When NOT to Use

- **掩码 inpainting**：本 skill `/edits` 端点支持参考图（`--ref`），但不支持 `--mask` 区域编辑
- **绕过速率上限**：本 skill 强制全局速率门（默认 2 RPM = 35s 间隔，跨进程信号量），见下面"速率上限"
- **无限重试**：429/5xx 内置 3 次退避重试；其他 4xx 立即 exit 1，调用方决定是否再试

## 速率上限（自动）

无论从几个 shell / subagent / skill 同时调本脚本，**全局两次请求最少间隔 35 秒**（对应 Azure 2 RPM 硬上限），且默认**全局并发 = 1**。多余的实例会**等待**前面的请求达到 35s 后再继续，不会失败。

429 / 5xx 由脚本内部退避重试（最多 3 次），优先读 `Retry-After` 响应头，否则按 30 / 60 / 120 秒指数退避。重试期间持续持有 rate-gate 槽位，不会让后续请求挤进 60s 窗口。

机制：`/tmp/image-gen-sema/` 下的 `slot-N.lock` 目录基于 `mkdir` 的原子性做并发信号量；同目录的 `last-start.txt` 记录最近一次请求时刻，新请求拿到 slot 后必须等到 `now - last ≥ MIN_INTERVAL_MS`。进程崩溃留下的 lock 由下一次 acquire 自动回收（`kill -0` 判活 + 10 min mtime 兜底）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `IMAGE_GEN_MIN_INTERVAL_MS` | `35000` | 两次请求最小间隔，毫秒。Azure 2 RPM ⇒ 30s 边界 + 5s buffer。`0` = 禁用速率门。范围 `0..600000` |
| `IMAGE_GEN_MAX_CONCURRENCY` | `1` | 并发上限。整数 `1..16`。**Azure 2 RPM 下设 >1 没有收益**（仍受 35s 间隔约束）；只有当部署 RPM 提升后才有意义 |
| `IMAGE_GEN_SEMA_DIR` | `/tmp/image-gen-sema` | 信号量根目录（一般不用改；测试时会指向临时目录） |

## Prerequisites

`AZURE_API_KEY` 必须可被脚本读取，加载顺序：

1. 当前 shell 已 `export` 的环境变量（最高优先级）
2. 从脚本 cwd **向上递归**查找的第一个 `.env` 文件（适合放在项目根目录）

| 变量 | 必需 | 说明 |
|---|---|---|
| `AZURE_API_KEY` | ✓ | Azure 部署 key |
| `AZURE_IMAGE_ENDPOINT` | 推荐 | 完整 `/generations` 端点 URL；不设走 die |
| `AZURE_IMAGE_EDITS_ENDPOINT` | ✗ | 完整 `/edits` 端点；不设则从 `AZURE_IMAGE_ENDPOINT` 把 `/generations` 替换为 `/edits` 自动推导。仅 `--ref` 模式需要 |
| `IMAGE_GEN_MIN_INTERVAL_MS` | ✗ | 速率门最小间隔，毫秒。默认 `35000`（2 RPM 安全值），范围 `0..600000` |
| `IMAGE_GEN_MAX_CONCURRENCY` | ✗ | 并发上限。默认 `1`，范围 `1..16` |
| `IMAGE_GEN_SEMA_DIR` | ✗ | 信号量目录。默认 `/tmp/image-gen-sema` |
| `SKIP_PNG_COMPRESS` | ✗ | `1` = 跳过 pngquant + oxipng 压缩，直接落盘原图。调试 / 对照用 |
| `IMAGE_GEN_INPUT_FIDELITY` | ✗ | `high`（默认）\| `low` \| `auto` \| `off`。控制 `/edits` 请求里的 `input_fidelity` 字段；`off` = 完全不发送该字段（用于不识别该字段的部署） |

**推荐做法**：复制项目根目录的 `.env.example` 为 `.env`，填入真实 key。
`.env` 已被 `.gitignore` 屏蔽，不会泄漏。

> 此 skill 依赖两个 npm 包提供的预编译二进制（`pngquant-bin`、`oxipng-bin`）。
> 首次使用前在仓库根目录执行 `bun install` 即可。

> ⚠️ skill 内置的 `.env` 解析器只支持最常见的 `KEY=value` 格式（含 `#` 注释、两侧引号），
> 不支持多行值、变量插值或转义符。需要这些功能请改用 `dotenv` 包。

## Reference-image Mode（image-to-image）

传入 `--ref <path>` 时切到 Azure 的 `/edits` 端点，把每张参考图作为
**`image[]` multipart 字段**（数组语法；同一个名字 `image[]` 重复 N 次）。
用于"角色立绘 + prompt 描述场景"实现跨场景视觉一致性（scene-illustrator 调用范式）。

> 字段名为什么是 `image[]` 而不是 `image`：Microsoft Learn 文档（针对 `gpt-image-1` 系列）
> 描述的是重复 `image` 字段，但 Azure 的 `gpt-image-2` 部署对此返回
> `duplicate_parameter` 400，错误消息明确指引使用 `image[]`。本 skill 按 Azure 实际行为走，
> 单 ref 时也用 `image[]`，对单 ref 无害。

`AZURE_IMAGE_EDITS_ENDPOINT` 见上面 Prerequisites 表。

**限制：**
- 接受 0..6 张 `--ref`，传 ≥ 7 张直接 `exit 1`
- 每张 ref 必须是 PNG 或 JPEG（按 magic 字节判定），单文件 ≤ 50 MB
- 不支持 `--mask`（区域编辑场景目前不需要）
- `input_fidelity` 默认 `high`，由 `IMAGE_GEN_INPUT_FIDELITY` env 控制；
  设为 `off` 完全不发送该字段（用于不识别该字段的部署）

## Quick Reference

```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --output <png 路径> \
  [--prompt "<text>"]   # 不传则从 stdin 读取，长度 ≤ 4000 字符
  [--ratio 1:1]         # 仅支持 1:1，传其他值会 exit 1
  [--size 1024x1024]    # MVP 内部固定 1024x1024，传其他值会 stderr 警告但继续
  [--quality high]      # low | medium | high，默认 high
  [--ref <path>]        # 可重复 0..6 次。传入则走 /edits 端点（image-to-image）
```

退出码语义：

| 退出码 | 含义 | 调用方应当 |
|---|---|---|
| 0 | 成功，PNG 已写入 `--output` | 继续 |
| 1 | 任意错误（缺 key / 参数非法 / 重试 3 次后仍 429-5xx / 4xx 拒绝 / 写盘失败） | 读 stderr 判断是否上层重试或跳过 |

## Invocation Patterns

### 模式 1：短 prompt 用 `--prompt`

```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "A photograph of a red fox in an autumn forest" \
  --output /tmp/fox.png
```

### 模式 2：长 prompt 用 stdin（推荐用于绘本场景）

绘本每页 prompt 通常超过 1KB（风格前缀 + 角色锚定短语 + 场景描述 + 文字渲染指令 + 负面提示词），
用 stdin 喂入避免 shell 转义和 argv 长度问题：

```bash
cat <<'PROMPT' | bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --output output/<topic>/0.png
<完整页面 prompt 多行内容...>
PROMPT
```

### 模式 3：picture-book-creator 调用范式

picture-book-creator 阶段 6.2 以 `context: fork` 形式派发本 skill，
每个 fork 收到形如 `prompt: <text> | output: <path>` 的指令。
被 fork 的 Claude 应当：

1. 把 `<text>` 通过 stdin 传给本脚本（heredoc 最稳）
2. 把 `<path>` 作为 `--output` 传入
3. 默认补 `--ratio 1:1`
4. 不要拼 `--size 4K`（picture-book-creator 文档提到该参数；本 skill 收到会警告并按 1024 处理）
5. 退出码非零 → fork 报错返回，picture-book-creator 阶段 6.3 会处理失败页

## Behavior on Error

所有错误都走"非零退出 + stderr 单行错误"，**绝不**静默或半成功。常见错误形态：

| stderr 关键字 | 触发条件 | 调用方处置建议 |
|---|---|---|
| `AZURE_API_KEY 未设置` | 环境变量缺失 | 让用户 `export AZURE_API_KEY=...`，不要重试 |
| `Prompt 长度 ... 超过 4000` | prompt 过长 | 精简 prompt，不要重试 |
| `--ref 当前最多支持 6 张参考图（收到 N 张）` | 传了 ≥ 7 张 `--ref` | 调用方修复参数，不要重试 |
| `--ref ... 不是合法 PNG/JPG（magic 字节失败）` | ref 文件不是 PNG/JPEG | 调用方换文件或转码 |
| `--ref ... 大小 X MB 超过 50 MB 单文件上限` | 单 ref > 50 MB | 调用方压缩或换图 |
| `IMAGE_GEN_INPUT_FIDELITY 必须是 high\|low\|auto\|off` | env 取了非法值 | 修 env |
| `HINT: ... IMAGE_GEN_INPUT_FIDELITY=off` | API 返回 4xx 且 body 含 `input_fidelity` | 在 .env 设置 `IMAGE_GEN_INPUT_FIDELITY=off` 后重试 |
| `API 返回 429`（出现在 stderr 末尾，标记 attempt 4/4） | 内置 3 次退避重试仍被限流 | 等待几分钟再上层重试，或检查是否多个进程绕过 rate-gate |
| `API 返回 5xx`（attempt 4/4） | 服务端持续故障 | 上层退避后重试 1-2 次 |
| `API 返回 4xx`（非 429） | prompt 被审核拒绝 / 参数非法 | 调整 prompt 后重试，否则跳过本页 |
| `网络错误`（attempt 4/4） | DNS / 连接超时持续失败 | 上层重试或检查网络 |
| `Prompt 为空` | 调用方没传 prompt | 修复调用代码，不要重试 |
| `WARN: 压缩失败` | pngquant/oxipng 子进程失败或超时 | 不是错误，exit 0；该图未压缩但可用，可忽略 |
| `WARN: ... 后重试` | 中间一次 429/5xx，正在退避 | 不是错误，会自动重试；只是一行日志 |

## Common Mistakes

- **忘记 `export AZURE_API_KEY`**：脚本会立即报错，但 fork subagent 继承的是父进程环境变量，
  务必在父 shell 里 export 后再启动 Claude Code
- **prompt 含未转义的 `'` 或 `"`**：用 stdin / heredoc 而不是 `--prompt "..."` 即可避免
- **prompt 长度超 4000**：脚本立即 die，不会发请求；上层准备 prompt 时务必检查长度
- **传 `--ratio 16:9`**：会 exit 1。本 skill MVP 只支持 1:1
- **传 ≥ 7 张 `--ref`**：会 exit 1。本 skill 上限 6
- **ref 文件是 WebP / GIF / SVG**：仅 PNG / JPEG 接受，magic 字节失败立即 exit 1
- **依赖跨进程 RPM 时不在同一信号量目录**：所有调用方必须共享 `IMAGE_GEN_SEMA_DIR`，否则速率门各算各的
- **期望文件大小验证**：本 skill 只判断 API 是否成功；调用方（如 picture-book-creator 阶段 6.3）
  自行检查 `>100KB`

## Implementation

脚本：`scripts/generate-image.ts`（Bun + TypeScript，使用 Bun 内置 `fetch`），调用 `compress-png.ts`（依赖 `pngquant-bin` + `oxipng-bin`）做高保真压缩。

API 细节固化在脚本里，详见 `scripts/generate-image.ts` 头部注释。
