---
name: image-generation
description: |
  Use when needing to generate one PNG image from a text prompt via the Azure
  gpt-image-2 deployment in Codex Desktop App. Triggered by picture-book-creator
  or any task that says "generate image", "make a picture", "render this prompt
  to PNG". One invocation = exactly one image; concurrency, batching and retries
  are the caller's responsibility. Requires AZURE_API_KEY env var.
---

# Image Generation

通过 Azure 部署的 `gpt-image-2` 模型，把一段 prompt 渲染成单张 1024×1024 PNG，
落盘前会经过 `pngquant + oxipng` 高保真压缩，目标单图 ≤800 KB（典型 400-700 KB），
肉眼无差别。压缩失败时静默回退到原图（exit 0，stderr 一行 WARN）。

## When to Use

- picture-book-creator 阶段 6.2 派发的逐页生图（每页一次调用）
- 任何"prompt → 1 张 PNG"的需求

## When NOT to Use

- **图像编辑 / inpainting**：`/openai/.../images/edits` 接口本 skill 未实现
- **批量并发**：本 skill 单次只生成一张图。并发由调用方控制（picture-book-creator 限 2 并发）
- **失败自动重试**：本 skill 失败即 `exit 1`。调用方决定是否重试

## Prerequisites

`AZURE_API_KEY` 必须可被脚本读取，加载顺序：

1. 当前 shell 已 `export` 的环境变量（最高优先级）
2. 从脚本 cwd **向上递归**查找的第一个 `.env` 文件（适合放在项目根目录）

| 变量 | 必需 | 说明 |
|---|---|---|
| `AZURE_API_KEY` | ✓ | Azure 部署 key |
| `AZURE_IMAGE_ENDPOINT` | ✗ | 完整生成端点 URL，覆盖默认值（更换部署/区域时用） |

**推荐做法**：复制项目根目录的 `.env.example` 为 `.env`，填入真实 key。
`.env` 已被 `.gitignore` 屏蔽，不会泄漏。

> 此 skill 依赖两个 npm 包提供的预编译二进制（`pngquant-bin`、`oxipng-bin`）。
> 首次使用前在仓库根目录执行 `bun install` 即可。

> ⚠️ skill 内置的 `.env` 解析器只支持最常见的 `KEY=value` 格式（含 `#` 注释、两侧引号），
> 不支持多行值、变量插值或转义符。需要这些功能请改用 `dotenv` 包。

## Quick Reference

```bash
bun run .codex/skills/image-generation/scripts/generate-image.ts \
  --output <png 路径> \
  [--prompt "<text>"]   # 不传则从 stdin 读取
  [--ratio 1:1]         # 仅支持 1:1，传其他值会 exit 1
  [--size 1024x1024]    # MVP 内部固定 1024x1024，传其他值会 stderr 警告但继续
  [--quality high]      # low | medium | high，默认 high
```

**环境变量（除 `AZURE_API_KEY` / `AZURE_IMAGE_ENDPOINT` 外）：**

| 变量 | 含义 |
|---|---|
| `SKIP_PNG_COMPRESS=1` | 跳过 pngquant + oxipng 压缩，直接落盘原图。调试 / 对照用。 |

退出码语义：

| 退出码 | 含义 | 调用方应当 |
|---|---|---|
| 0 | 成功，PNG 已写入 `--output` | 继续 |
| 1 | 任意错误（缺 key / 参数非法 / API 报错 / 写盘失败） | 读 stderr 判断是否重试 |

## Invocation Patterns

### 模式 1：短 prompt 用 `--prompt`

```bash
bun run .codex/skills/image-generation/scripts/generate-image.ts \
  --prompt "A photograph of a red fox in an autumn forest" \
  --output /tmp/fox.png
```

### 模式 2：长 prompt 用 stdin（推荐用于绘本场景）

绘本每页 prompt 通常超过 1KB（风格前缀 + 角色锚定短语 + 场景描述 + 文字渲染指令 + 负面提示词），
用 stdin 喂入避免 shell 转义和 argv 长度问题：

```bash
cat <<'PROMPT' | bun run .codex/skills/image-generation/scripts/generate-image.ts \
  --output output/<topic>/0.png
<完整页面 prompt 多行内容...>
PROMPT
```

### 模式 3：picture-book-creator 调用范式

picture-book-creator 阶段 6.2 默认把每页 prompt 写入 `output/<topic>/prompts/<page>.txt`，
再通过 `bun run images` 批量调用本脚本。需要手动单页重试时，Codex 应当：

1. 把 `<text>` 通过 stdin 传给本脚本（heredoc 最稳）
2. 把 `<path>` 作为 `--output` 传入
3. 默认补 `--ratio 1:1`
4. 不要拼 `--size 4K`；本 skill 收到非 1024 的 size 会警告并按 1024 处理
5. 退出码非零时，把 stderr 返回给调用方，picture-book-creator 阶段 6.3 会处理失败页

## Behavior on Error

所有错误都走"非零退出 + stderr 单行错误"，**绝不**静默或半成功。常见错误形态：

| stderr 关键字 | 触发条件 | 调用方处置建议 |
|---|---|---|
| `AZURE_API_KEY 未设置` | 环境变量缺失 | 让用户 `export AZURE_API_KEY=...`，不要重试 |
| `API 返回 429` | 限流 | 退避 2-5s 重试 |
| `API 返回 5xx` | 服务端错误 | 退避重试 1-2 次 |
| `API 返回 4xx` (非 429) | prompt 被审核拒绝 / 参数非法 | 调整 prompt 后重试，否则跳过本页 |
| `网络错误` | DNS / 连接超时 | 重试 |
| `Prompt 为空` | 调用方没传 prompt | 修复调用代码，不要重试 |
| `WARN: 压缩失败` | pngquant/oxipng 子进程失败或超时 | 不是错误，exit 0；该图未压缩但可用，可忽略 |

## Common Mistakes

- **忘记 `AZURE_API_KEY`**：脚本会立即报错；推荐在项目根目录 `.env` 中配置，或在启动 Codex Desktop App 前把环境变量导出到父 shell
- **prompt 含未转义的 `'` 或 `"`**：用 stdin / heredoc 而不是 `--prompt "..."` 即可避免
- **传 `--ratio 16:9`**：会 exit 1。本 skill MVP 只支持 1:1
- **期望文件大小验证**：本 skill 只判断 API 是否成功；调用方（如 picture-book-creator 阶段 6.3）
  自行检查 `>100KB`

## Implementation

脚本：`scripts/generate-image.ts`（Bun + TypeScript，使用 Bun 内置 `fetch`），调用 `compress-png.ts`（依赖 `pngquant-bin` + `oxipng-bin`）做高保真压缩。

API 细节固化在脚本里，详见 `scripts/generate-image.ts` 头部注释。
