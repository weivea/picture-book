# Picture Book

AI 驱动的儿童绘本创作工具。基于 Codex Desktop App skills，把一句模糊的故事想法逐步转化为分页脚本、角色/风格设定、图像 prompt，再调用 Azure `gpt-image-2` 自动生成所有插图，最终打包成 Fixed-Layout EPUB。

## 特性

- **全流程引导**：从需求收集 → 分页脚本 → 角色与风格设定 → 图像 prompt → 批量生图 → 电子书打包，全部由 Codex skill 串起来
- **图像生成**：Azure 部署的 `gpt-image-2`，1024×1024 PNG，落盘前自动高保真压缩
- **并行高效**：每页一张图，批量脚本最多 2 并发生成
- **可出版输出**：正方形 210×210mm 国际主流绘本开本，导出 Fixed-Layout EPUB
- **有声绘本**：基于 edge-tts 生成朗读音频和时间戳，打包 EPUB3 Media Overlays

## 项目结构

```
.
├── .claude/skills/
│   └── ...                     # 旧 Claude Code skill，保留作迁移参考
├── .codex/skills/
│   ├── picture-book-creator/   # 绘本全流程 skill
│   ├── image-generation/       # 单张图生成 skill（Azure gpt-image-2 + PNG 压缩）
│   ├── text-to-speech/         # 单页朗读 MP3 + 时间戳生成 skill
│   └── audio-picture-book-creator/ # 有声 EPUB3 Media Overlays 打包 skill
├── output/                     # 生成的绘本（图片 / EPUB），已 gitignore
├── package.json
├── tsconfig.json
└── azure-image-2-api.md        # Azure gpt-image-2 接口参考
```

## 环境要求

- [Bun](https://bun.sh/) ≥ 1.0
- Codex Desktop App
- Azure OpenAI 资源，已部署 `gpt-image-2` 模型
- Python 3（仅有声绘本 / TTS 需要）

## 快速开始

### 1. 安装依赖

```bash
bun install
# 如果需要有声绘本能力，再运行：
bun run setup:venv
```

`setup:venv` 默认使用清华 PyPI 镜像。需要指定其他源时，可在运行前设置 `PIP_INDEX_URL` 或 `PYPI_INDEX_URL`。

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

### 3. 在 Codex Desktop App 中创作绘本

在 Codex Desktop App 中打开本仓库，然后显式调用项目 skill，例如：

> Use $picture-book-creator to 帮我给 4 岁的孩子做一本讲分享的绘本，主角是一只小兔子。

`picture-book-creator` skill 会按阶段引导你确认主题、角色、风格，生成每页 prompt 后通过本项目的批量脚本调用 `image-generation` 渲染所有页面，输出到 `output/<book-slug>/`。

如果桌面 app 没有自动发现项目内的 `.codex/skills`，把 `.codex/skills/` 下的 4 个 skill 目录复制到 `%USERPROFILE%\.codex\skills\` 后重启 Codex Desktop App。

### 4. 手动调用脚本（可选）

```bash
# 单张图生成（参数见 image-generation skill）
bun run image -- --prompt "..." --output path/to/file.png

# 批量生图：读取 output/<book-slug>/prompts/0.txt ~ N.txt
bun run images -- --prompts output/<book-slug>/prompts --output output/<book-slug> --concurrency 2

# 把一个目录下的页面图打包成 EPUB
bun run epub -- --input output/<book-slug> --title "<书名标题>"

# 为已有绘本批量生成朗读音频
bun run audio-pages -- --topic-dir output/<book-slug> --concurrency 2

# 把已有绘本和 audio/ 目录打包成有声 EPUB
bun run audio-epub -- --topic-dir output/<book-slug> --title "<书名标题>"
```

## 输出示例

`output/zhouwu-yuehao/` 下是一本完整生成的样书《周五的胡萝卜蛋糕》，包含：

- `0.png` ~ `11.png`：封面 + 11 页正文
- `script.md`、`characters.md`、`style.md`：分页脚本、角色设定、风格设定
- `周五的胡萝卜蛋糕.epub` / `.pdf`：成品电子书
- `周五的胡萝卜蛋糕-audio.epub`：有声版（晰晰童声朗读 + 句级高亮 + 自动翻页，需 Apple Books / Thorium）

## 相关文档

- `azure-image-2-api.md` — Azure gpt-image-2 接口与鉴权说明
- `.codex/skills/picture-book-creator/SKILL.md` — 绘本生成完整流程与阶段说明
- `.codex/skills/image-generation/SKILL.md` — 单张图生成 skill 的契约
- `.codex/skills/text-to-speech/SKILL.md` — 文本朗读音频与时间戳生成
- `.codex/skills/audio-picture-book-creator/SKILL.md` — 有声 EPUB3 Media Overlays 打包

## 有声绘本（实验功能）

把已生成的静态绘本升级为带朗读、文字高亮、自动翻页的 EPUB3 电子书。

### 一次性 setup

```bash
bun run setup:venv
# 可选：安装 epubcheck 并确保它在 PATH 中，用于结构校验
```

默认使用 `https://pypi.tuna.tsinghua.edu.cn/simple` 安装 `edge-tts`。如需切换源：

```bash
$env:PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
bun run setup:venv
```

### 使用

在 Codex Desktop App 中直接说："Use $audio-picture-book-creator to 给 zhouwu-yuehao 做有声版"，audio-picture-book-creator skill 会自动触发。

### 阅读器建议

- Apple Books（iOS / macOS）：完整支持朗读 + 高亮 + 翻页
- Thorium Reader（跨平台）：完整支持
- Kindle / 微信读书：不支持 Media Overlays，仅作为静态 EPUB 显示
