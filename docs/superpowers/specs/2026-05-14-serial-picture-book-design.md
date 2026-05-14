# 连载绘本生成系统设计

- **状态**：Draft
- **作者**：Claude + jianliwei
- **日期**：2026-05-14
- **背景项目**：[picture-book](../../../README.md)
- **依赖前置**：picture-book-creator、image-generation、audio-picture-book-creator、text-to-speech 已上线

---

## 1. 目标与范围

把现有"单本绘本生成系统"升级为"**多册同一世界（Series）连载绘本生成系统**"，让用户可以**分阶段**逐步搭建一个共享世界观、共享角色、共享画风的绘本系列：

```
建系列（一次）→ 规划本季弧线（每季一次）→ 生成单册（每册一次，可隔天/隔周/隔月）→ 出合订本（按需）
```

### 在范围

- 新增 4 个阶段化 skill：
  - `series-bible-creator`：建立 Series Bible（世界观 + 角色 bible + 画风 + portraits）
  - `series-season-planner`：规划本季弧线 + 分册大纲
  - `series-volume-creator`：生成单册全流程（脚本 → 生图 → 静态 EPUB → 自动衔接有声 EPUB）
  - `series-omnibus-packager`：把若干已生成的册合并为合集本 EPUB
- 新增输出目录根：`series-output/<series-slug>/{bible,seasons,volumes,omnibus}`
- 新增 `state.json` 跨会话进度快照
- 扩展现有 `picture-book-creator/scripts/generate-epub.ts` 增加 `--omnibus` 模式
- 在 README 增加"连载绘本"章节

### 不在范围

- 修改现有 `picture-book-creator`、`image-generation`、`audio-picture-book-creator`、`text-to-speech` 行为（仅作为被调用的底层）
- 跨季画风重设（本期跨册一致性策略为"主锚定冻结，可加补丁"）
- Bible 修订模式（v1 冻结后修订流程留待后续；本期仅支持创建）
- 合集本有声版（合集只静态打包；单册有声仍按现有流程）
- LLM 输出质量自动评分（沿用 picture-book-creator 现有 references/age-standards.md 校验）

---

## 2. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 体裁 | 多册同一世界（Series），每册独立可读 | 主流连载形态，跨册门槛最低 |
| 阶段层数 | 三层：Series Bible → Season Arc → 单册 | 对应电视剧"季"概念，兼顾长期规划与单册可独立性 |
| skill 组织 | 拆为 4 个对等阶段化 skill | 与现有 skill 文化（每 skill 一个生命周期）一致；用户可单独召唤任一阶段 |
| 单册形态 | 绘本（页数可变 8-20） + 自动升级有声 + 可生成合集本 | 用户多选所得 |
| 跨册一致性 | 主锚定冻结，可加补丁（per-volume `characters-patch.md`） | 平衡长期一致性与单册灵活性，影响域严格限定 |
| 输出目录 | `series-output/<series-slug>/{bible,seasons,volumes,omnibus}` | 与单本 `output/` 隔离；按阶段分层易管理 |
| 进度恢复 | 必须有 `state.json`，启动时读取并报告进度；目录存在性作为兜底 | 跨会话续作的硬需求 |
| 单册生图分辨率 | 1024×1024（写死） | 与现有产物一致；连载多册 4K 成本翻倍不必要 |
| 自动衔接 | 单册 packaged → 自动调 audio-picture-book-creator 出有声版 | 连载体裁专属优化（单本仍保留用户主动触发） |
| voice_profile | 在 Bible 角色卡里定义，全系列锁定 | 第一册定声，后续册免重复决策 |
| 复用策略 | 复用 picture-book-creator/generate-epub.ts、references/age-standards.md；调用 image-generation 与 audio-picture-book-creator skill | 不重写底层能力 |

---

## 3. 总体架构

```
                    ┌─────────────────────────────────────────┐
                    │  series-output/<series-slug>/           │
                    │    state.json   ←─── 所有 skill 读写    │
                    │    bible/       ← skill A 写            │
                    │    seasons/<id>/← skill B 写            │
                    │    volumes/<id>/← skill C 写            │
                    │    omnibus/     ← skill D 写            │
                    └─────────────────────────────────────────┘
                          ▲       ▲       ▲       ▲
                          │       │       │       │
       ┌──────────────────┘       │       │       └────────────────┐
       │                          │       │                        │
┌──────┴──────────┐    ┌──────────┴───┐   │   ┌────────────────────┴──┐
│ series-bible-   │    │ series-      │   │   │ series-omnibus-       │
│   creator       │    │ season-      │   │   │   packager            │
│ (阶段 A)        │    │ planner      │   │   │ (阶段 D)              │
│                 │    │ (阶段 B)     │   │   │                       │
└─────────────────┘    └──────────────┘   │   └───────────────────────┘
                                          │
                              ┌───────────┴────────────┐
                              │ series-volume-creator   │
                              │ (阶段 C)                │
                              │                         │
                              │ 内部 invoke：           │
                              │   image-generation      │
                              │   audio-picture-book-   │
                              │     creator (自动)      │
                              │   generate-epub.ts      │
                              └─────────────────────────┘
```

### 4 个 skill 的职责契约

| Skill | 触发关键词示例 | 输入 | 输出 | 依赖 |
|---|---|---|---|---|
| **series-bible-creator** | 建系列 / 创建绘本系列 / 建 world bible | 一段模糊描述 | bible/world.md, characters.md, style.md, portraits/ | 无 |
| **series-season-planner** | 规划第 N 季 / 设计本季弧线 / 列出本季要做的几册 | series-slug + season 主题/数量 | seasons/<id>/season-arc.md, volumes-outline.md | bible 已冻结 |
| **series-volume-creator** | 做这个系列的下一册 / 出第 X 册 / 把 outline 第 3 册做出来 | series-slug + volume-id（或"下一册待做"） | volumes/<id>/{script.md, *.png, *.epub, *-audio.epub, *.pdf, ...} | bible 已冻结；若属某季则该季 outline 存在 |
| **series-omnibus-packager** | 把第一季合订 / 出合集本 / 合并 EPUB | series-slug + 范围 | omnibus/<series>-<range>.epub | ≥1 册在指定范围内已 packaged（合订 1 册技术上可行但无意义,会警告） |

---

## 4. 数据契约

跨 skill 的协作完全靠"约定文件 schema"。本节锁死全部跨 skill 文件的 owner / reader / 格式来源。

### 4.1 文件 owner / reader 表

| 文件 | 写入者 | 读取者 | 格式来源 |
|---|---|---|---|
| `state.json` | 全部 4 个（追加更新） | 全部 4 个（启动必读） | 见 §4.2 |
| `bible/series-meta.md` | bible-creator | season-planner, volume-creator, omnibus-packager | 见 §4.3 |
| `bible/world.md` | bible-creator | season-planner, volume-creator | 复用 `novel-output/.../world.md` 现有 frontmatter |
| `bible/characters.md` | bible-creator | volume-creator（生图与有声）, season-planner（角色清单） | 复用 `novel-output/.../characters.md` 现有 frontmatter（含 voice_profile, prompt_anchor） |
| `bible/style.md` | bible-creator | volume-creator（Prompt 拼接） | 复用 `novel-output/.../style.md` 现有 frontmatter |
| `bible/portraits/<name>.png` + `<name>.meta.json` | bible-creator | volume-creator（视觉参考） | 由 image-generation skill 产出 |
| `seasons/<id>/season-arc.md` | season-planner | volume-creator | 见 §4.4 |
| `seasons/<id>/volumes-outline.md` | season-planner（首次）, volume-creator（回写页数） | volume-creator | 见 §4.5 |
| `volumes/<id>/script.md` | volume-creator | omnibus-packager（仅做目录页用） | 复用 picture-book-creator 阶段 3 格式 |
| `volumes/<id>/characters-patch.md` | volume-creator | 仅 volume-creator 自身 | 见 §4.6 |
| `volumes/<id>/prompts/<n>.txt` | volume-creator | 仅 volume-creator（重试用） | 自由文本 |
| `volumes/<id>/<n>.png` | volume-creator | omnibus-packager | image-generation 产出 |
| `volumes/<id>/meta.json` | volume-creator | omnibus-packager（取标题/页数/season） | 见 §4.7 |
| `volumes/<id>/<title>.epub` / `.pdf` / `<title>-audio.epub` | volume-creator | 用户 / 阅读器 | generate-epub.ts / audio-picture-book-creator |
| `omnibus/<series>-<range>.epub` | omnibus-packager | 用户 / 阅读器 | generate-epub.ts `--omnibus` 模式 |

### 4.2 `state.json` schema

```json
{
  "version": 1,
  "series_slug": "xiaoxiong-mianbaofang",
  "title": "小熊面包房的故事",
  "created_at": "2026-05-14T08:30:00Z",
  "bible": {
    "version": 1,
    "frozen_at": "2026-05-14T10:15:00Z"
  },
  "seasons": {
    "s1": {
      "title": "第一季：开张啦",
      "volumes_planned": 6,
      "arc_locked": true,
      "started_at": "2026-05-15T...",
      "outline_revision": 1
    }
  },
  "volumes": {
    "s1v1": {
      "season": "s1",
      "phase": "packaged",
      "audio": true,
      "pages": 12,
      "score": 8.2,
      "built_at": "2026-05-16T..."
    },
    "s1v2": {
      "season": "s1",
      "phase": "drafting"
    },
    "standalone-001": {
      "season": null,
      "phase": "packaged",
      "audio": true,
      "pages": 10
    }
  },
  "omnibus": [
    { "range": "s1", "built_at": "2026-06-01T...", "file": "omnibus/xiaoxiong-mianbaofang-s1.epub" }
  ]
}
```

`phase` 枚举与登记点：`drafting`（Step 0 启动后）→ `scripted`（Step 3 通过后）→ `imaged`（Step 6 全页生图通过后）→ `packaged`（Step 7 EPUB 完成后）。`audio: true` 由 Step 8 完成时登记;与 `phase: packaged` 同时为真才表示该册彻底完成。

`state.json` 必须**事务性更新**：写临时文件 `state.json.tmp` → `fs.rename` 原子替换，避免半写崩坏。

### 4.3 `bible/series-meta.md`

```markdown
---
slug: xiaoxiong-mianbaofang
title: 小熊面包房的故事
title_en: The Bear's Bakery
age_range: 4-6
language: zh
genre: 治愈 / 日常生活
series_scale: medium    # short=6 | medium=12 | long=24+
typical_pages_per_volume: 12  # 默认页数,单册可在 8-20 间调整
education_goals:
  - 学会等待
  - 认识团队合作
taboos:
  - 不出现现实人类
created_at: 2026-05-14T08:30:00Z
---

# 系列概述

（一段散文形式的整体介绍，用于合集本扉页和 README）
```

### 4.4 `seasons/<id>/season-arc.md`

```markdown
---
season_id: s1
title: 第一季：开张啦
volumes_planned: 6
opening_state: 主角小熊刚搬进新城,面包房还没招牌
ending_state: 小熊学会让顾客等待中的小欢喜,面包房开张三个月名声渐起
key_turn_points:
  - volume: s1v3
    event: 第一次面包烤糊但顾客反而喜欢
  - volume: s1v5
    event: 邻居老猫给小熊送来祖传食谱
new_characters:
  - 老猫先生（s1v5 出现,需在 Bible v1 末尾追加角色卡）
arc_locked: true
---

# 季弧线叙述

（散文形式,叙述本季成长主线）

# 给下一季的伏笔

- 老猫先生临别提到"北边的小狐狸面包师"——可在 s2 回收
- 小熊还没学会做生日蛋糕——可作 s2 主线之一
```

### 4.5 `seasons/<id>/volumes-outline.md`

```markdown
---
season_id: s1
revision: 1
---

## s1v1 招牌还没挂上

- beat: 开篇 / 季初状态
- pov: 小熊
- summary: 小熊搬进新城,在小巷尽头租下旧屋打算开面包房,第一夜在烤面包香气中失眠。
- characters: [小熊, 邻居老鼠]
- planned_pages: 12
- mood: 温暖 / 期待

## s1v2 第一位顾客

- beat: 递进
- pov: 小熊
...
```

### 4.6 `volumes/<id>/characters-patch.md`（可选）

```markdown
---
volume_id: s1v3
applies_to: 本册全部页
---

## 小熊
- 追加锚定: wearing a small flour-dusted white apron with a pink bear paw print on the chest
- 触发原因: 本册首次出现"穿围裙"细节,与 Bible 主锚定不冲突,仅追加
```

生图 Prompt 拼接时角色短语为 `<bible_anchor> + ", " + <patch_anchor>`，**bible 主锚定永远在前且原样不变**。

### 4.7 `volumes/<id>/meta.json`

```json
{
  "volume_id": "s1v1",
  "season": "s1",
  "title": "招牌还没挂上",
  "pages": 12,
  "score": 8.2,
  "built_at": "2026-05-16T...",
  "outputs": {
    "epub": "招牌还没挂上.epub",
    "pdf": "招牌还没挂上.pdf",
    "audio_epub": "招牌还没挂上-audio.epub"
  }
}
```

---

## 5. 各 skill 详细流程

### 5.1 series-bible-creator（阶段 A）

```
Step 1 系列定位收集 → Step 2 World Bible → 用户审阅
→ Step 3 Character Bible（含 voice_profile + prompt_anchor）→ 用户审阅
→ Step 4 Style Bible（prompt_prefix + 调色板 + 角色锚定索引）→ 用户审阅
→ Step 5 Portraits 并行生成（每角色 1 张正面参考图,分辨率 1024×1024）→ 用户硬闸门审阅
→ Step 6 Bible Freeze（state.json 登记 bible.version=1, frozen_at=now）
```

设计要点：
- 复用 `novel-output/` 已有的 `world.md / characters.md / style.md` markdown 格式（已被验证）
- Bible 是"冻结资产"：v1 完成后只读不写；将来修订需走"修订模式"，本期不做
- Step 5 portraits 是硬审阅闸门——不通过则回 Step 3 改 prompt_anchor 重做
- 复用 `picture-book-creator/references/{age-standards,style-presets}.md` 作为知识库

### 5.2 series-season-planner（阶段 B）

```
Step 0 读 state.json + Bible → Step 1 本季定位收集
→ Step 2 生成 season-arc.md → 用户审阅
→ Step 3 生成 volumes-outline.md（每册 1 段:beat/pov/summary/characters/planned_pages/mood）→ 用户审阅
→ Step 4 可制作性自检（自动检查标题重复 / 弧线递进 / 角色覆盖）→ 自动修 → 报告残留问题
→ Step 5 Season Arc Lock（state.json 登记 seasons[<id>].arc_locked=true）
```

设计要点：
- Step 1 主动询问"是否承接上季伏笔"——读取上季 `season-arc.md` 末尾 `# 给下一季的伏笔` 段
- Season **不是必须**——`series-volume-creator` 接受 `--no-season` 做游离册（id 形如 `standalone-001`,目录 `volumes/standalone-001/`,与季内册扁平共存; state.json 里 `season: null`）
- volumes-outline 是"软计划"：单册做的时候若实际页数偏离计划，回写到 outline 并 `outline_revision++`

### 5.3 series-volume-creator（阶段 C）

```
Step 0 上下文加载 + 目标确认（仅这一处暂停）
→ Step 1 本册微定位（仅游离册或 outline 不够细时出现）
→ Step 2 分页脚本（复用 picture-book-creator 阶段 3 格式）
→ Step 3 可读性测试（自动,复用 picture-book-creator 阶段 4） → 用户确认
→ Step 4 角色补丁（默认跳过,仅勾选或关键词触发时出现）
→ Step 5 图像 Prompt 生成（每页 prompt 写到 prompts/<n>.txt 便于复现/重试）
→ Step 6 并行生图（image-generation skill,4 并发,1024×1024,1:1）
→ Step 7 静态 EPUB+PDF 打包（调用现有 generate-epub.ts）
→ Step 8 自动衔接有声 EPUB（调用 audio-picture-book-creator skill,使用 Bible 里的 voice_profile）
→ Step 9 登记 + outline 回写
```

设计要点：
- **启动只暂停一次**（Step 0），其余仅 Step 1（罕见）、Step 3（必须）暂停
- **新代码量 ≈ 0**：仅 Prompt 拼接 + 编排逻辑；底层全调既有 skill / 脚本
- **失败页一键重试**：Step 6 失败时不全部重做,列出失败页 + 失败原因 + 该页 prompts/<n>.txt 路径,用户可"重试 5、9 页"或"改 5 页 prompt 后重试"
- 单册结束时若该册是季内最后一册,提示用户"可调用 series-omnibus-packager 出合订本"

#### 与 picture-book-creator 阶段对照

| picture-book-creator 阶段 | series-volume-creator 对应 | 关键差异 |
|---|---|---|
| 阶段 1 需求收集 | Step 0 + 可选 Step 1 | 大量字段从 Bible/outline 继承,不重复问 |
| 阶段 2 故事方案（3 选 1） | **删除** | outline 已定梗概 |
| 阶段 3 分页脚本 | Step 2 | 格式完全相同 |
| 阶段 4 可读性测试 | Step 3 | 完全相同 |
| 阶段 5 角色与风格 | **删除** | Bible 已定;仅可选 Step 4 补丁 |
| 阶段 6 Prompt + 生图 | Step 5 + 6 | Prompt 来源不同,生图调用相同（写死 1024×1024） |
| 阶段 7 EPUB 打包 | Step 7 | 完全相同 |
| (无) | Step 8 自动有声 | 连载独有 |

### 5.4 series-omnibus-packager（阶段 D）

```
Step 0 上下文加载（解析合订范围:season-id / "全部" / 显式列表） → 用户确认
→ Step 1 合集结构（标题、封面沿用首册、目录页、各册扉页）
→ Step 2 调 generate-epub.ts --omnibus --volumes "s1v1,...,s1v6"
→ Step 3 输出 omnibus/<series>-<range>.epub + state.json 登记
```

设计要点：
- **不重新生图**——纯粹是已有 PNG 的重新打包
- **不出有声合集本**——单次 audio 任务对 100+ 页过重；保持单册有声、合订只静态
- 未 packaged 的册自动跳过 + 警告

---

## 6. 现有脚本扩展

### 6.1 `picture-book-creator/scripts/generate-epub.ts` 增加 `--omnibus` 模式

新参数：
- `--omnibus`：进入合集模式
- `--volumes "s1v1,s1v2,..."`：要合并的 volume id 列表（按出现顺序）
- `--series-root <path>`：series-output/<series>/ 路径
- `--title "<合集标题>"`、`--author`、`--lang`：与单册版相同

行为：
- 按 volume 顺序拼接每册 `<n>.png`
- 各册之间插入扉页 XHTML（一页空白带册标题）
- 主目录 `nav.xhtml` 按册分组列出
- 仍是 Fixed-Layout EPUB3

---

## 7. 测试策略

### 7.1 Fixture 设计

```
.claude/skills/series-volume-creator/scripts/test/fixtures/
└── mini-series/
    ├── state.json          # 仅有 bible,未做任何册
    ├── bible/
    │   ├── series-meta.md
    │   ├── world.md        # 极简一段话
    │   ├── characters.md   # 1 个角色
    │   ├── style.md        # 1 个色 + 1 个负面
    │   └── portraits/
    │       └── 主角.png    # 1×1 像素 PNG 占位
    └── seasons/
        └── s1/
            ├── season-arc.md
            └── volumes-outline.md  # 1 册
```

类似 fixture 也为 bible-creator / season-planner / omnibus-packager 各提供一份。

### 7.2 测试覆盖

| 测试 | 目标 | 验证 |
|---|---|---|
| series-bible-creator 单元 | series-meta frontmatter 解析 | YAML 字段完整 |
| series-season-planner 单元 | volumes-outline 段落解析 + 回写 | 解析 → 修改 → 序列化幂等 |
| series-volume-creator 单元 | Prompt 拼接函数 | 给定 bible+patch+page 输入,输出符合"风格→角色→场景→文字→负面"五段顺序 |
| series-volume-creator 单元 | 失败页重试自然语言解析 | "重试 5、9 页" → {5, 9} |
| series-omnibus-packager 单元 | 范围解析 | "第一季"/"全部"/显式列表 → 册 id 集合 |
| generate-epub.ts 单元 | --omnibus 模式 | 给定 N 张 fixture PNG,产出合订 EPUB,目录正确 |
| state.json 单元 | 原子更新 | 模拟"写一半 crash",检查文件不损坏 |
| 端到端冒烟（mini-series） | volume-creator 全流程 | 跑通 Step 0→Step 9（Step 6 mock image-generation 返回 1×1 PNG,Step 8 mock audio）,最终产物文件齐全 |

### 7.3 不测的部分

- LLM 输出质量（脚本可读性、Prompt 描述能力）——靠 picture-book-creator 现有 references/ 校验兜底
- 真实 image-generation API 调用（昂贵、慢、不稳定）——所有自动化测试 mock 它
- 真实 EPUB 在 Apple Books 渲染——人工抽查

---

## 8. 错误处理与恢复

| 场景 | 处理 |
|---|---|
| state.json 损坏/丢失 | 从目录结构兜底重建（portraits 存在 → bible frozen；outline 存在 → 该季 outline 就绪；epub 存在 → 该册 packaged） |
| Bible 未冻结时调 season-planner | 报错并提示先跑 bible-creator |
| outline 不存在时调 volume-creator 且未带 --no-season | 报错并提示先跑 season-planner 或加 --no-season 走游离册 |
| Step 6 部分页生图失败 | 列出失败页 + prompt 路径,提供"重试某几页"交互 |
| Step 8 audio 失败 | 不影响静态 EPUB 已产出,state.json 标 `audio: false`,可后续手动重试 |
| 用户中途打断 | 已写入的文件不删除；下次启动 state.json + 目录扫描自动恢复到中断处 |

---

## 9. 输出物总览

```
.claude/skills/                              （仓库内）
├── picture-book-creator/                    原样保留
├── audio-picture-book-creator/              原样保留
├── image-generation/                        原样保留（1024×1024）
├── text-to-speech/                          原样保留
├── series-bible-creator/        ★ 新增      SKILL.md + scripts/ + fixtures
├── series-season-planner/       ★ 新增      SKILL.md + scripts/ + fixtures
├── series-volume-creator/       ★ 新增      SKILL.md + scripts/ + fixtures
└── series-omnibus-packager/     ★ 新增      SKILL.md + scripts/ + fixtures

series-output/<series-slug>/                 （生成产物,gitignore）
├── state.json
├── bible/
│   ├── series-meta.md
│   ├── world.md
│   ├── characters.md
│   ├── style.md
│   └── portraits/<name>.png + .meta.json
├── seasons/<id>/
│   ├── season-arc.md
│   └── volumes-outline.md
├── volumes/<id>/
│   ├── script.md
│   ├── characters-patch.md      （可选）
│   ├── meta.json
│   ├── prompts/<n>.txt
│   ├── <n>.png
│   ├── <title>.epub
│   ├── <title>.pdf
│   └── <title>-audio.epub
└── omnibus/<series>-<range>.epub
```

---

## 10. 文档更新

- `series-output/.gitignore`：自动 ignore 整个目录（除非显式 commit 示例）
- `README.md` 增加"多册连载绘本"章节，介绍触发语和典型工作流
- 各 skill 的 `SKILL.md` 末尾必须有"我产出的文件 schema"小节，作为其他 skill 写代码时的合同

---

## 11. 已显式声明的非目标 / 后续

- Bible 修订模式（v2 / v3 演进）
- 季合集本有声版
- 跨季画风重设
- 多语言系列（同一系列同时出中英文版）
- 系列封面 / 系列周边页（角色介绍页 / 世界地图页）
- LLM 输出的自动评分与 A/B 测试

这些可在本期上线后按需迭代。
