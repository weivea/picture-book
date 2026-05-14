# Picture Book

AI 驱动的儿童绘本创作工具。基于 [Claude Code](https://claude.com/claude-code) skills，把一句模糊的故事想法逐步转化为分页脚本、角色/风格设定、图像 prompt，再调用 Azure `gpt-image-2` 自动生成所有插图，最终打包成 EPUB / PDF。

## 特性

- **全流程引导**：从需求收集 → 分页脚本 → 角色与风格设定 → 图像 prompt → 并行生图 → 电子书打包，全部由 skill 串起来
- **图像生成**：Azure 部署的 `gpt-image-2`，1024×1024 PNG，文字直接渲染在画面中
- **并行高效**：每页一张图，最多 4 并发派发
- **可出版输出**：正方形 210×210mm 国际主流绘本开本，导出 EPUB 与 PDF

## 项目结构

```
.
├── .claude/skills/
│   ├── picture-book-creator/   # 绘本全流程 skill（脚本 + 角色 + 风格 + EPUB 打包脚本）
│   └── image-generation/       # 单张图生成 skill（封装 Azure gpt-image-2）
├── output/                     # 生成的绘本（图片 / EPUB / PDF），已 gitignore
├── package.json
├── tsconfig.json
└── azure-image-2-api.md        # Azure gpt-image-2 接口参考
```

## 环境要求

- [Bun](https://bun.sh/) ≥ 1.0
- Claude Code CLI
- Azure OpenAI 资源，已部署 `gpt-image-2` 模型

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入真实的 Azure key 与 endpoint
```

需要的变量：

| 变量 | 说明 |
| --- | --- |
| `AZURE_API_KEY` | Azure gpt-image-2 部署的 API key |
| `AZURE_IMAGE_ENDPOINT` | 形如 `https://<resource>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01` |

### 3. 在 Claude Code 中创作绘本

在仓库目录启动 Claude Code，然后用自然语言描述你想做的绘本，例如：

> 帮我给 4 岁的孩子做一本讲分享的绘本，主角是一只小兔子。

`picture-book-creator` skill 会自动触发，按阶段引导你确认主题、角色、风格，并最终调度 `image-generation` skill 并行渲染所有页面，输出到 `output/<book-slug>/`。

### 4. 手动调用脚本（可选）

```bash
# 单张图生成（参数见 image-generation skill）
bun run image -- --prompt "..." --out path/to/file.png

# 把一个目录下的页面图打包成 EPUB
bun run epub -- --dir output/<book-slug>
```

## 输出示例

`output/zhouwu-yuehao/` 下是一本完整生成的样书《周五的胡萝卜蛋糕》，包含：

- `0.png` ~ `11.png`：封面 + 11 页正文
- `script.md`、`characters.md`、`style.md`：分页脚本、角色设定、风格设定
- `周五的胡萝卜蛋糕.epub` / `.pdf`：成品电子书
- `周五的胡萝卜蛋糕-audio.epub`：有声版（晰晰童声朗读 + 句级高亮 + 自动翻页，需 Apple Books / Thorium）

## 相关文档

- `azure-image-2-api.md` — Azure gpt-image-2 接口与鉴权说明
- `.claude/skills/picture-book-creator/SKILL.md` — 绘本生成完整流程与阶段说明
- `.claude/skills/image-generation/SKILL.md` — 单张图生成 skill 的契约

## 有声绘本（实验功能）

把已生成的静态绘本升级为带朗读、文字高亮、自动翻页的 EPUB3 电子书。

### 一次性 setup

```bash
python3 -m venv .venv
.venv/bin/pip install edge-tts
# 可选：装 epubcheck 做结构校验
brew install epubcheck
```

### 使用

在 Claude Code 中直接说："给 zhouwu-yuehao 做有声版"，audio-picture-book-creator skill 会自动触发。

### 阅读器建议

- ✅ Apple Books（iOS / macOS）：完整支持朗读 + 高亮 + 翻页
- ✅ Thorium Reader（跨平台）：完整支持
- ⚠️ Kindle / 微信读书：不支持 Media Overlays，仅作为静态 EPUB 显示

## 连载绘本（多册系列）

把单本工作流升级为**多册同一世界**的连载绘本系列。每册独立可读，全系列共享世界观、角色和画风。

### 三层结构

```
建系列（一次）
  └─ Series Bible: world.md / characters.md / style.md / portraits/
     └─ 规划本季弧线（每季一次）
        └─ Season Arc + volumes-outline
           └─ 生成单册（每册一次,可隔天/隔周/隔月）
              └─ script + 图 + 静态 EPUB + 自动有声 EPUB
              └─ 出合订本（按需）
                 └─ omnibus EPUB
```

### 4 个 skill

| Skill | 触发关键词 | 何时用 |
|---|---|---|
| `series-bible-creator` | "建一个绘本系列"、"create series" | 一个系列只跑一次 |
| `series-season-planner` | "规划第 N 季"、"plan season 2" | 每季跑一次 |
| `series-volume-creator` | "做下一册"、"build volume 3" | 每册跑一次 |
| `series-omnibus-packager` | "出第一季合订本"、"merge volumes" | 按需 |

### 输出目录

```
series-output/<series-slug>/
├── state.json                      ← 跨会话进度
├── bible/                          ← 冻结资产
│   ├── series-meta.md
│   ├── world.md
│   ├── characters.md               ← 含 voice_profile + prompt_anchor
│   ├── style.md
│   └── portraits/
├── seasons/<id>/
│   ├── season-arc.md
│   └── volumes-outline.md
├── volumes/<id>/
│   ├── script.md
│   ├── 0.png ~ N.png               ← 1024×1024
│   ├── <册名>.epub
│   └── <册名>-audio.epub
└── omnibus/<series>-<range>.epub
```

`series-output/` 已被 .gitignore，不会进仓库。

### 跨册一致性

- **角色**：Bible 里的 `prompt_anchor`（英文短语）每册原样复制；可加 per-volume 补丁但 Bible 锚定永远在前
- **画风**：Bible 的 `style.md` 提供全系列 prompt 前缀
- **声音**：Bible 角色卡里的 `voice_profile` 全系列锁定，第一册定声后永不更换

### 跨会话恢复

每次启动任一 series-* skill，都会先读 `state.json` 报告进度（已冻结的 bible 版本、已锁的 season、各册 phase 计数），用户可从中断处继续。

### 手动调用合订脚本

```bash
bun run epub-omnibus -- \
  --series-root series-output/<slug> \
  --volumes "s1v1,s1v2,s1v3" \
  --title "第一季合集" \
  --lang zh
```

### 设计与实现文档

- 设计 spec: `docs/superpowers/specs/2026-05-14-serial-picture-book-design.md`
- 实施 plan: `docs/superpowers/plans/2026-05-14-serial-picture-book.md`
