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

## 有声图文小说（Illustrated Audio Novel）

从一个 seed 概念产出 Reflowable EPUB3（句级高亮） + 多 voice MP3 + 网漫范式插图的端到端流水线。

```text
用户对话 → /illustrated-audio-novel-creator
        → seed + tier(short|medium|long)
        → Stage 1..7（4 个人工 GATE）
        → novel-output/<date>-<slug>/dist/*.epub + *.md + audio/*.mp3
```

设计与实现：

- Spec：`docs/superpowers/specs/2026-05-13-illustrated-audio-novel-design.md`
- Plan：`docs/superpowers/plans/2026-05-13-illustrated-audio-novel-plan.md`

参与的 skill：

| Skill | 责任 |
|---|---|
| `illustrated-audio-novel-creator` | 主编排器（用户入口） |
| `novel-foundation-builder` | world / characters / outline / voice / style 5 层文档 |
| `novel-chapter-workshop` | 单章 draft / evaluate / revise |
| `scene-illustrator` | 角色立绘 + 场景插图（image-to-image 锚定） |
| `audio-novel-packager` | 多 voice TTS + Reflowable EPUB3 + Media Overlays |
| `image-generation`（已扩展 `--ref`） | 通用出图，Azure gpt-image-2 /generations + /edits |
| `text-to-speech` | 通用 TTS，edge-tts |

第一次使用：按 plan 段顺序实现各 phase，跑 `bun test .claude/skills/` 验证全绿。
