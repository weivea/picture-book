# 有声图文小说生成系统 — 设计规范

**Date:** 2026-05-13
**Status:** Draft v1（待 user review）
**Inspired by:** [NousResearch/autonovel](https://github.com/NousResearch/autonovel)（已 clone 至 `reference/autonovel/`）
**Related work in repo:**
- `picture-book-creator`（绘本全流程，复用其角色锚定短语机制与风格预设体系）
- `audio-picture-book-creator`（句级 Media Overlays 打包，复用其 SMIL/XHTML/OPF 构建器）
- `image-generation`（封装 Azure gpt-image-2，需要扩展 `--ref` 参数）
- `text-to-speech`（封装 edge-tts，需扩展支持多 voice 调度）

---

## 1. 目标与范围

把用户的一句模糊想法（"写一本关于 X 的有声图文小说"）扩展为一本**完整的有声图文小说**，单一入口，一次调用产出：

- **Reflowable EPUB3** + Media Overlays（句级高亮 + 自动翻页）
- **多人多声音频**（每章一个 mp3，按章拆分）
- **网漫范式插图**（约 1000 字 / 张，按"首次出场 / 关键对白 / 动作高潮 / 转折 / 道具 / 情绪反转"触发点选位）
- **完整中间产物**（5 层文档 + canon + 角色立绘 + 评估日志）

参考形态：《全职高手》图文版、日式轻小说、《一人之下》图文版——视觉占比 30-40%，介于"插图本小说"与"漫画"之间。

### 1.1 非目标

- 不做印刷级 LaTeX/PDF 排版（autonovel 的 `typeset/` 不移植）
- 不做漫画分镜（不追求连续视觉叙事）
- 不做 LoRA/DreamBooth 微调（与现有 Azure gpt-image-2 闭源接口不兼容；作为 v2 候选）
- 不复用 `picture-book-creator` 主 skill（绘本流程对儿童年龄段、Fixed-Layout 21cm² 开本、文字渲染入图等有大量硬约束，与小说不兼容）

---

## 2. 体量档位与插图密度

### 2.1 三档体量（参数化）

| 档位 | 章数 | 字数 | 默认插图密度 | 默认插图总数 | Opus 轮数 | 一致性回炉 | 预计耗时 |
|---|---|---|---|---|---|---|---|
| `short`（短篇） | 3-8 | 1-3 万 | comic-novel | 20-60 | 0-1（0=跳过 Opus 阶段） | 可选 | 1-3 h |
| `medium`（中篇，默认） | 10-20 | 3-8 万 | comic-novel | 50-120 | 2-3 | 可选 | 3-8 h |
| `long`（长篇） | 20-40 | 5-15 万 | comic-novel | 80-200 | 3-6 | 默认开启 | 8-24 h |

### 2.2 插图密度（与档位正交，可独立覆盖）

```
illustration_density: sparse | medium | comic-novel | per-scene
```

| 取值 | 含义 | 触发频率 |
|---|---|---|
| `sparse` | 每章 1 幅章首装饰 | 章首 |
| `medium` | 每章 2-3 幅关键场景 | 关键转折点 |
| `comic-novel`（默认） | 网漫范式 | 约 1000 字 / 张，按触发点清单 |
| `per-scene` | 每场景 1 幅 | 由 outline 场景拆分决定 |

**触发点清单**（comic-novel 模式扫描章节文本时使用）：
1. 角色首次出场
2. 关键对白（推动剧情、揭示性格）
3. 动作高潮（打斗、奔跑、对峙）
4. 场景切换（地点 / 时间转换）
5. 情绪反转（悲转喜、信任崩塌等）
6. 重要道具登场（推动后续剧情的物件）

### 2.3 预估表（主 skill 在阶段 0 必须输出）

主 skill 收集完档位 + 密度参数后，给出明确预估，让用户在大额消耗前知情确认：

```
═══ 生成预估 ═══（具体数字由主 skill 运行时动态计算）
档位：medium（中篇）
预估字数：约 5 万字（12-15 章）
插图密度：comic-novel（约 1000 字 / 张）
预估插图总数：约 60 张
预估生图时长：约 30 分钟（4 并发，每张 60-90 秒）
预估 Azure gpt-image-2 费用：根据 Azure 当前单价 × 插图数计算
预估 LLM token 总量：drafting ≈ 字数 × 3，评估 ≈ 字数 × 2，Opus ≈ 字数 × n_rounds
预估总耗时：4-6 小时

[回车确认] / 修改密度（sparse / medium / per-scene）
```

---

## 3. 系统架构

### 3.1 Skill 拓扑（5 新增 + 2 复用 + 2 扩展）

```
                ┌──────────────────────────────────────────┐
                │  illustrated-audio-novel-creator (主)     │
                │   · 档位 + 插图密度参数收集与预估           │
                │   · 阶段间流转 + 用户暂停点                 │
                │   · state.json 管理 / 断点续跑              │
                │   · Opus 跨章 review 调度                   │
                └─────────────┬────────────────────────────┘
                              │
   ┌──────────────┬───────────┼──────────┬─────────────────┐
   ▼              ▼           ▼          ▼                 ▼
foundation-    chapter-     scene-     audio-novel-     [复用 + 扩展]
builder        workshop     illustrator packager        image-generation
                                                        text-to-speech
```

### 3.2 资产目录

```
novel-output/<novel-slug>/
├── seed.md                    # 用户初始想法
├── voice.md                   # 写作 voice 风格指南
├── world.md                   # 世界观设定
├── characters.md              # 角色档案 + 英文 prompt 锚定短语
├── outline.md                 # 章节大纲 + 场景拆分 + 伏笔账本
├── canon.md                   # 横切硬事实数据库
├── style.md                   # 视觉风格 prefix + 配色 + 负面约束
├── voices.json                # 角色 → edge-tts voice 映射
├── state.json                 # 流水线状态机（断点续跑）
├── refs/                      # 角色立绘（image-to-image 锚）
│   └── <character>.png
├── chapters/                  # 章节正文 markdown（带场景标记）
│   └── chNN.md
├── scenes/                    # 场景插图
│   └── chNN-sMM.png
├── audio/
│   ├── chNN.mp3               # 章音频
│   └── chNN.timestamps.json   # 句级时间戳
├── eval_logs/                 # 评估与 review 日志
│   └── *.json
├── <title>.epub               # Reflowable EPUB3 + Media Overlays（最终交付物）
└── <title>.md                 # 全文 markdown（场景标记 + 插图链接，纯文本备份）
```

**与 `output/<slug>/`（picture-book-creator 用）独立**——两个生态位互不干扰。

### 3.3 状态机 `state.json`

```json
{
  "tier": "medium",
  "illustration_density": "comic-novel",
  "language": "zh",
  "phase": "foundation|drafting|illustration|audio|packaging|done",
  "estimated_illustrations": 80,
  "words_per_illustration_target": 1000,
  "consistency_recheck_enabled": false,
  "opus_max_rounds": 3,
  "foundation_score": 7.8,
  "chapters_total": 12,
  "chapters_drafted": 5,
  "chapters_evaluated": 5,
  "opus_review_round": 1,
  "refs_generated": ["lily", "tom"],
  "scenes_generated": ["ch01-s01", "ch01-s02"],
  "audio_generated": ["ch01"],
  "debts": [
    {
      "trigger": "ch3 reveals new magic rule",
      "affected": ["world.md", "ch01"],
      "status": "pending"
    }
  ]
}
```

**所有阶段都从 state.json 续跑**：用户输入"继续"或重新调用主 skill 时，自动定位到上次中断点恢复。

**字段初始化时机：**
- 阶段 0 末尾：写入 `tier` / `illustration_density` / `language` / `consistency_recheck_enabled` / `opus_max_rounds` / `words_per_illustration_target`
- 阶段 1 末尾：写入 `chapters_total`（由 outline 实际决定）/ `estimated_illustrations`（由密度 × 字数估算）/ `foundation_score`
- 阶段 2 末尾：append `refs_generated`
- 阶段 3 内每章末尾：increment `chapters_drafted` / `chapters_evaluated`，append `scenes_generated`
- 阶段 4 内每轮末尾：increment `opus_review_round`
- 阶段 6 内每章末尾：append `audio_generated`
- 任何阶段失败（重试耗尽）：append 一项到 `debts[]`，便于用户后续修复

---

## 4. Skill 契约（输入 / 输出 / 职责边界）

### 4.1 `illustrated-audio-novel-creator`（主编排器）

| 字段 | 内容 |
|---|---|
| **触发词** | "写有声图文小说""图文长篇""illustrated audio novel""网漫小说""有声小说" |
| **职责** | 阶段流转 + state.json 维护 + 用户暂停点 + 子 skill 调度 |
| **输入** | 用户的自然语言想法 |
| **输出** | 完整的 `novel-output/<slug>/` 目录 |
| **不做** | 任何具体生成工作（全部委托给子 skill） |
| **依赖** | foundation-builder / chapter-workshop / scene-illustrator / audio-novel-packager |

**阶段流转表**（与 picture-book-creator 同构）：

```
[阶段 0] 需求收集
  · 提取/追问 seed、tier、density、language、Opus 启用、一致性回炉
  · 输出预估表
  ⏸ 用户确认参数

[阶段 1] Foundation
  · novel-foundation-builder 生成 5 层 + style + voices
  · 给出 3 个故事方向供选择
  ⏸ 用户选故事方向 + 必要时调整 outline / characters

[阶段 2] 角色立绘
  · scene-illustrator (refs 模式) 为每个 named character 生立绘
  ⏸ 用户审看立绘 + 重生不满意的（避免后续场景全部跑偏）

[阶段 3] 逐章作坊（核心循环，全程不暂停）
  for ch in chapters:
    chapter-workshop(ch) ──> 起草+机械评估+LLM 评委+章内修订
    scene-illustrator(scene mode, ch) ──> 本章场景图
    state.json 更新 chapters_drafted / scenes_generated

[阶段 4] Opus 跨章 review 循环（按 tier 决定轮数）
  for round in 1..opus_max_rounds:
    Opus 双角色（评论家 + 教授）审全本
    解析 actionable items → 生成 brief → chapter-workshop 重写相关章
    停止条件：≤2 项 / >50% 是 hedge / 达到 round 上限

[阶段 5] 一致性抽查回炉（长篇默认开启）
  按角色分组送 LLM 比对所有 scene 图，跑偏回炉重生（最多 1 次）

⏸ 用户抽查（推荐随机抽 2-3 章 + 翻所有立绘 + 听 1-2 段音频样本）

[阶段 6] 打包
  · audio-novel-packager 跑对话归属 + 多 voice TTS + EPUB3 装配 + 多资产
  · 输出最终摘要
```

**4 个用户暂停点**：
- 阶段 0 后：参数 + 预估
- 阶段 1 后：故事方向 + outline + 角色表
- 阶段 2 后：角色立绘
- 阶段 5 后：抽查打包前

---

### 4.2 `novel-foundation-builder`

| 字段 | 内容 |
|---|---|
| **职责** | 把种子概念扩展为完整 5 层文档 + style + voices 映射 |
| **输入** | seed（用户初始想法）、tier、language |
| **输出** | `voice.md` / `world.md` / `characters.md` / `outline.md` / `canon.md` / `style.md` / `voices.json` |
| **不做** | 章节正文（drafting） |
| **依赖** | 无（独立 skill） |

**关键产物字段：**

- `outline.md`：每章包含 `beats[]` + `scenes[]`（场景级拆分），便于 chapter-workshop 与 scene-illustrator 后续解析
- `characters.md`：每角色含 **英文 prompt 锚定短语**（picture-book-creator 已验证机制），约 30-80 词
- `voices.json`：每个 named character 自动分配一个 edge-tts voice（性别/年龄/音色匹配），`NARRATOR` 必有
- `outline.md` 必须输出 **3 个故事方向**供用户选择（autonovel 风格的 brainstorming）

**新增引用文档（位于 `.claude/skills/novel-foundation-builder/references/`）：**

- `anti-slop-zh.md` — 中文 AI 套话词表（Tier 1/2/3 三档，初版约 80-150 词，由 chapter-workshop 共享读取）
- `anti-patterns.md` — autonovel 12 模式中文化（OVER-EXPLAIN 优先级最高，由 chapter-workshop 共享读取）
- `craft-zh.md` — CRAFT.md 精简中文版（Save the Cat / 角色三滑块 / 三幕结构 / Stability Trap）
- `edge-tts-voice-catalog.md` — 中文 voice 清单及定位（晓晓/云扬/云健/晓伊 等的性别/年龄/适用角色，由 audio-novel-packager 共享读取）
- `style-presets-novel.md` — 网漫小说风格预设（区别于 picture-book 的童趣风格，由 scene-illustrator 共享读取）

**共享 references 的访问方式**：以上文档放在 `novel-foundation-builder/references/` 下作为权威源，其他 skill 通过相对路径（`../novel-foundation-builder/references/<file>`）只读访问，避免重复维护。

---

### 4.3 `novel-chapter-workshop`

| 字段 | 内容 |
|---|---|
| **职责** | 单章的"起草 → 机械评估 → LLM 评委 → 章内修订" |
| **输入** | 章节号、上下文窗口、tier |
| **输出** | `chapters/chNN.md`（带场景标记的最终稿） + `eval_logs/chNN-*.json` |
| **不做** | 跨章 Opus review（由主 skill 在阶段 4 调度） |
| **依赖** | 无（独立 skill） |

**上下文窗口（必须全部加载）：**
- `voice.md` 全文
- `characters.md` 全文
- 本章 `outline.md` 段落（含 beats + scenes）
- 上章末段（约 2000 字）
- 下章 outline（保证连续性）
- `canon.md`（cross-reference 硬事实）

**内部流程：**

1. **draft**：调用 LLM 写完整章，第三人称限定 POV，遵守 voice.md 与场景边界
2. **机械评估**：扫 `anti-slop-zh.md` + `anti-patterns.md`，输出问题清单（Tier 1 必删，Tier 2 聚集警告，Tier 3 结构提醒）
3. **LLM 评委**：voice 贴合度 / 角色辨识度 / 节奏 / beat 覆盖（评分 0-10，阈值 6.0）
4. **章内修订**：综合分 < 阈值则重写（最多 3 次，超过保留最佳并写入 `state.debts`）
5. **场景标记**：在最终稿中插入 `<!-- scene s01 start -->` ... `<!-- scene s01 end -->`，供 scene-illustrator 与 audio packager 切片

**场景标记格式：**

```markdown
<!-- scene s01 start: cafe encounter -->
（本场景正文，多段）
<!-- scene s01 end -->

<!-- scene s02 start: walk home -->
（本场景正文，多段）
<!-- scene s02 end -->
```

---

### 4.4 `scene-illustrator`

| 字段 | 内容 |
|---|---|
| **职责** | 角色立绘 + 场景插图，调度 `image-generation` |
| **输入** | mode（refs / scene）、章节路径（scene 模式）、characters.md、style.md、refs/、本章 outline |
| **输出** | refs 模式 → `refs/*.png`；scene 模式 → `scenes/chNN-sMM.png` + 在章节 markdown 对应位置插入 `![](../scenes/chNN-sMM.png)` |
| **依赖** | `image-generation`（必须扩展支持 `--ref` 参数） |

**双模式：**

- **refs 模式**（一次性，阶段 2 调用）：根据 `characters.md`，为每个 named character 生中性立绘
  - 立绘要求：白底、全身、姿态平和、表情中性，避免后续场景图被姿态干扰
  - 输出 `refs/<character-slug>.png`

- **scene 模式**（逐章，阶段 3 调用）：解析单章场景标记
  - 按 `words_per_illustration_target` + 触发点扫描，决定本章插图位置与构图
  - 每张图对应一个具体段落锚点（插在该段落之后）

**每张图的 prompt 结构**（沿用 picture-book-creator）：

```
[风格 prefix from style.md]
[角色锚定短语 — 原封不动复制 from characters.md]
[场景与构图 — 由本场景文本提炼]
[负面提示词]
```

**调用 image-generation**：
- 必须传 `--ref refs/<出场角色>.png`（最多 3 张参考图）
- `--ratio 1:1`（与现有绘本一致）
- 失败重试 3 次后跳过并写入 `state.debts`

**并发**：每批最多 4 张；断点续跑读 `state.scenes_generated`

**一致性回炉**（长篇默认开启）：
- 全本场景图完成后，按角色分组：[角色 A 的所有 scene 图] 送 LLM 比对
- LLM 输出"明显跑偏"清单 → 回炉重生（最多 1 次重试）
- 仍跑偏的写入 `state.debts`，让用户最后人工抉择

---

### 4.5 `audio-novel-packager`

| 字段 | 内容 |
|---|---|
| **职责** | 把"完成稿 + 插图 + voices 表"打包成 Reflowable EPUB3 有声版 + 独立 MP3 + 全文 MD |
| **输入** | `novel-output/<slug>/` 完整目录 |
| **输出** | `<title>.epub` / `<title>.md` / `audio/chNN.mp3` / `audio/chNN.timestamps.json` |
| **依赖** | `text-to-speech`（需扩展支持 voice 参数）、复用 `audio-picture-book-creator/scripts/` 的 SMIL/XHTML/OPF 构建器 |

**内部流程：**

1. **对话归属解析**：
   - 用 LLM（中等模型）对单章做一次"对话标注"调用
   - 输出 `[{speaker, text, audio_tag}]` JSON（参考 autonovel 的 `gen_audiobook_script.py`）
   - 对照 `voices.json` 分配 voice ID
   - 未识别 speaker 段落 fallback 到 `NARRATOR`

2. **多 voice TTS**：
   - 调 `text-to-speech` skill，每段独立合成 mp3 并保留时间戳
   - 按章拼接 mp3，时间戳偏移累加
   - 输出 `audio/chNN.mp3` + `audio/chNN.timestamps.json`

3. **句级 SMIL 生成**：
   - 句级时间戳 → SMIL Media Overlays（复用 `audio-picture-book-creator` 已有逻辑）
   - 每章一个 `chNN.smil`

4. **Reflowable EPUB3 装配**：
   - 每章 1 个 XHTML，插图按 `<!-- scene -->` 标记原位嵌入
   - 绑定 SMIL，CSS 适配手机 / 平板
   - 关键 CSS：
     ```css
     img.scene { max-width: 100%; height: auto; display: block; margin: 1em auto; }
     p.sentence.-active { background: #fffde7; transition: background 0.2s; }
     ```

5. **多资产输出**：
   - `<title>.epub`（主产物）
   - 独立 `audio/*.mp3`（按章）
   - 全文 `<title>.md`（场景标记 + 插图链接，纯文本备份）

---

## 5. 关键技术决策

### 5.1 `image-generation` 扩展 `--ref` 参数（硬依赖）

- **当前接口**：`--prompt --out`
- **新增接口**：`--ref <path>`（可多次传入，最多 3 张）
- **实现路径**：Azure gpt-image-2 提供 `/edits` 端点（见 `azure-image-2-api.md` 第 36 行），支持 `image=@file.png` 多图传入做 image-to-image
  - 对单参考图：用 `/edits` 端点
  - 对多参考图：分轮次或拼图后传单图（实现策略在 implementation plan 中细化）
- **测试**：实现完成后必须用同一角色立绘 + 不同 prompt 生成 5 张场景图，肉眼比对一致性
- **fallback**：如 `/edits` 端点不支持多图，至少保证单参考图工作；多参考图退化为"主角参考图 + prompt 描述其他角色"

### 5.2 中文 anti-slop 词表

autonovel 的英文词表不能直接用。新建 `anti-slop-zh.md` 初版（约 80-150 词）：

- **Tier 1（删除，对应英文 delve / utilize）**：
  - 诸如、综上所述、不难看出、值得注意的是、让我们…、在某种意义上、不容小觑、深入探讨、究其本质、归根结底
- **Tier 2（聚集警告，3+ 同段重写）**：
  - 宛如、仿佛、似乎、彷彿、淡淡的、缓缓地、轻轻地、深深地、悄悄地、静静地
  - 莫名、隐约、不自觉、不由得、忍不住
- **Tier 3（结构性 AI 套路）**：
  - "不是 X，而是 Y" 句式（每章 ≤ 1 次）
  - 段段三段式（主题句 → 举例 → 收束）
  - 对偶排比成癖
  - 破折号过度（每页 ≤ 2 次）
  - 场景结尾必"小哲理"（autonovel ANTI-PATTERN #11）

完整词表在 implementation plan 阶段集中产出，可经验式迭代。

### 5.3 多 voice TTS 的对话归属

- **触发**：audio-novel-packager 阶段
- **方案**：用 LLM（中等模型，如 Sonnet）对单章做一次"对话标注"调用，输出 `[{speaker, text, audio_tag}]` JSON
- **voices.json 在 foundation 阶段就已生成**（每角色一个 edge-tts voice ID）
- **fallback 规则**：未识别 speaker 段落归 `NARRATOR`
- **复杂段处理**：同段内有"X 说"插入旁白时，LLM 必须切分为多段，每段独立分配 voice
- **audio_tag**（可选）：emotional cue 如 `[whisper]` `[shout]` `[soft]`，edge-tts 的 SSML 实现

### 5.4 Reflowable EPUB3 + 插图 + Media Overlays 兼容性

- Reflowable + Media Overlays + 内嵌图片在 Apple Books / Thorium 上可同时工作（已被 `audio-picture-book-creator` 验证）
- 插图所在段落不放进 SMIL，朗读时自动跳过
- 章节按 spine 顺序，每章 1 XHTML + 1 SMIL
- 与 Fixed-Layout EPUB（绘本走的） 在打包脚本上分支处理，但底层 SMIL/OPF 构建器复用

### 5.5 与 `picture-book-creator` 的边界

- **不复用 picture-book-creator 主 skill**——它对儿童年龄段、Fixed-Layout 21cm² 开本、文字渲染入图等有大量硬约束
- **复用其 `references/style-presets.md` 机制**——新增 `style-presets-novel.md`，定义网漫小说风格类（清新水彩 / 厚涂二次元 / 写实素描 / 国风工笔 / 赛博朋克 等）
- **复用其角色锚定短语机制**——这是已经验证过的核心，原文档可直接 cite
- **生态位独立**：`output/` 装绘本，`novel-output/` 装小说

### 5.6 Azure gpt-image-2 的限流与重试

- **限流**：实现指数退避（首次失败等 5s，二次 15s，三次 45s）
- **失败处理**：3 次仍失败则跳过该图并写入 `state.debts`
- **批量回炉**：用户在阶段 5 抽查时，可批量触发 `state.debts` 中的失败图重生

---

## 6. 阶段流程图

```
┌─────────────────────────────────────────────────────────────┐
│ [阶段 0] 需求收集 + 预估                                     │
│   tier / density / language / opus_rounds / consistency      │
│   ⏸ 用户确认                                                  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 1] Foundation                                          │
│   novel-foundation-builder                                   │
│   产出：5 层文档 + style + voices + 3 个故事方向              │
│   ⏸ 用户选方向 + 调整                                         │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 2] 角色立绘                                             │
│   scene-illustrator (refs mode)                              │
│   产出：refs/<character>.png × N                              │
│   ⏸ 用户审看 + 重生                                           │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 3] 逐章作坊（不暂停）                                   │
│   for ch in chapters:                                        │
│     chapter-workshop(ch) ─ 起草 + 机械评估 + LLM 评委 + 重写  │
│     scene-illustrator(scene, ch) ─ 本章场景图（comic-novel）  │
│   产出：chapters/chNN.md + scenes/chNN-sMM.png                │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 4] Opus 跨章 review 循环（按 tier）                    │
│   for round in 1..opus_max_rounds:                           │
│     Opus 双角色审全本 → 提炼 actionable items → 重写相关章   │
│   停止：≤2 项 / >50% hedge / 达到上限                         │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 5] 一致性抽查回炉（长篇默认开启）                       │
│   按角色分组送 LLM 比对 → 跑偏回炉（最多 1 次）               │
│   ⏸ 用户抽查（随机 2-3 章 + 翻所有立绘 + 听 1-2 段音频）       │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ [阶段 6] 打包                                                 │
│   audio-novel-packager                                       │
│   ├─ 对话归属解析 (LLM)                                       │
│   ├─ 多 voice TTS (text-to-speech × edge-tts)                │
│   ├─ 句级 SMIL 生成                                           │
│   ├─ Reflowable EPUB3 装配                                    │
│   └─ 多资产输出（EPUB + MP3 + MD）                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 测试策略

### 7.1 单元层

- `image-generation --ref` 扩展：固定参考图 + 5 个不同 prompt，肉眼一致性 ≥ 80%
- `text-to-speech` 多 voice：voices.json 映射 → 多角色短对话样本，听感不同
- 中文 anti-slop 词表：构造已知套话样本 5 段，扫描 100% 命中

### 7.2 集成层

- **短篇 fixture 测试**：固定 seed → 完整跑短篇档（3 章 / 1 万字 / 30 张图）→ 校验产出目录结构与 EPUB 可被 epubcheck 通过
- **断点续跑测试**：在阶段 3 第 2 章中断 → 重新调主 skill → 验证从第 2 章续跑
- **一致性回炉测试**：构造 1 张明显跑偏图 → 验证被识别并回炉

### 7.3 端到端

- 用一句真实想法（如 "想写一本关于猫咪侦探的中篇有声图文小说，民国背景"）跑完整流程，人工评估：
  - 章节阅读流畅度
  - 角色跨场景视觉一致性
  - 多 voice 配音的角色辨识度
  - EPUB 在 Apple Books / Thorium 的句级高亮 + 自动翻页

---

## 8. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| Azure gpt-image-2 `/edits` 端点对多参考图的支持不明确 | 实现阶段先做单参考图 PoC，多参考图退化为"主角 ref + prompt 描述配角" |
| 长篇 200 张图在 4 并发下耗时 1 小时，遇限流可能失败 | 指数退避 + state.debts 记账 + 用户阶段 5 批量回炉 |
| 中文 anti-slop 词表 v1 覆盖不全，错杀正常表达 | 经验式迭代，所有词表项可被 `references/anti-slop-zh.md` 单点修改 |
| edge-tts 在长文本上音质波动 | 按段切分（≤500 字 / 段）+ 平滑拼接 |
| Opus 跨章 review 一轮 token 量极大（5-15 万字 × n 轮） | tier 决定上限，长篇默认 3 轮，超出由用户主动续跑 |
| 用户在阶段 3 中长时间挂起后回来，state.json 与实际文件不一致 | 主 skill 启动时做一次 reconcile（扫描 chapters/ scenes/ 实际文件 vs state.json，修正字段） |

---

## 9. v2 候选（不在本 spec 范围）

- LoRA / DreamBooth 角色微调（一致性 95%+，但需切换到 SDXL/Flux 开源链路）
- 漫画分镜模式（连续视觉叙事 + 对白气泡）
- 多语言版本生成（同一稿件输出中/英/日三版 EPUB）
- 配套 Web 阅读器（不依赖 Apple Books / Thorium 的句级高亮渲染）
- 自动生成宣传物料（封面海报 + 角色 PV 视频）

---

## 10. 验收标准

v1 完成等价于以下全部为真：

- [ ] 5 个新 skill 全部以可调用形态存在于 `.claude/skills/`，每个含 SKILL.md + 必要 references 文档 + scripts
- [ ] `image-generation` 扩展 `--ref` 参数，单参考图 PoC 验证通过
- [ ] `text-to-speech` 扩展支持 voice 参数，多 voice 调用验证通过
- [ ] 用一句真实中文想法触发主 skill，可端到端产出短篇档 EPUB（3 章 / 30 张图 / 多 voice 音频）
- [ ] EPUB 通过 epubcheck 校验，在 Apple Books 与 Thorium 上可朗读 + 句级高亮 + 自动翻页
- [ ] 短篇 fixture 集成测试 + 断点续跑测试 + 一致性回炉测试全绿
- [ ] README 增补"有声图文小说"章节，描述用法与限制
