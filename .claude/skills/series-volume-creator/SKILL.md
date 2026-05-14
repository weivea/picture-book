---
name: series-volume-creator
description: |
  连载绘本"单册"全流程 skill。从已冻结的 Series Bible + 已锁定的 Season Outline
  出发,做出某一册的脚本、图、静态 EPUB,并自动衔接调 audio-picture-book-creator
  出有声版。
  当用户说"做这个系列的下一册"、"出第 X 册"、"把 outline 第 N 册做出来"、
  "build volume 3"、"做一本游离册" 时,触发此 skill。
  内部调用 image-generation、generate-epub.ts、audio-picture-book-creator,
  本 skill 不重写底层能力。
---

# Series Volume Creator

把"已规划的某一册"做成 packaged + audio 完成态。**全流程仅在 Step 0 与 Step 3 暂停**。

## When to Use

- Bible 已冻结，且要做的册属于某锁定 season 的 outline；OR
- 用户明确要做游离册（`--no-season`），volume id 形如 `standalone-NNN`

## When NOT to Use

- 单本绘本（无系列）→ picture-book-creator
- 系列还没冻结 Bible → series-bible-creator
- 季还没锁 → series-season-planner

## Output Layout

```
series-output/<slug>/volumes/<vid>/
├── script.md                      ← Step 2,复用 picture-book-creator 阶段 3 格式
├── characters-patch.md            ← Step 4,可选
├── prompts/
│   ├── 0.txt                      ← Step 5,本页完整 prompt
│   ├── 1.txt
│   └── ...
├── 0.png ~ N.png                  ← Step 6,1024×1024
├── meta.json                      ← Step 7 末尾写入,spec §4.7
├── <册名>.epub                    ← Step 7
├── <册名>.pdf                     ← Step 7
└── <册名>-audio.epub              ← Step 8
```

## Flow (10 steps; only Step 0 + Step 3 stop)

### Step 0 — 上下文加载 + 目标确认（**唯一启动暂停**）

调用 `scripts/load-context.ts` 的 `loadVolumeContext(seriesRoot, volumeId)`。
- 报告：bible 版本、季信息、本册大纲条目（beat/pov/summary/characters/planned_pages）、
  patch 是否存在
- 要求用户口头确认"开始做 <vid>"或调整 volumeId

### Step 1 — 本册微定位（仅游离册或 outline 不够细时）

游离册（`standalone-NNN`）outline 缺失 → 当场用 picture-book-creator 阶段 1
的提问框架补齐；产物即时写入 `volumes/<vid>/meta.json` 草稿（不写 outline）。

### Step 2 — 分页脚本

完全复用 picture-book-creator 阶段 3 的格式与 reference（`age-standards.md`）。
保存到 `volumes/<vid>/script.md`。

state 登记：调 `updateState` → `volumes[vid] = { season, phase: "drafting" }`。

### Step 3 — 可读性测试（**用户确认必经闸门**）

复用 picture-book-creator 阶段 4 的「可读性校验清单」，自动检查 → 自动修 → 报告。
全部通过后 → 暂停等用户最终确认。
确认后 state 登记 `phase: "scripted"`。

### Step 4 — 角色补丁（默认跳过）

仅当：
- 用户在 Step 0 显式要求；OR
- 脚本中出现 Bible 主锚定不覆盖的关键细节（如"穿围裙第一次出现"）

则按 spec §4.6 写出 `volumes/<vid>/characters-patch.md`。

### Step 5 — 图像 Prompt 生成

对每一页（0 ~ N）调用 `scripts/compose-prompt.ts`（Task 3）的
`composePagePrompt({ ctx, page })`，把返回的字符串写到
`volumes/<vid>/prompts/<n>.txt`。

便于：(a) 用户人工审 prompt；(b) 失败重试时复用同一 prompt 而不重新 LLM 生成。

### Step 6 — 并行生图

按页号 0..N 派发 `image-generation` skill，**每批 4 个并发**。
- 每个 fork 任务的指令字符串：`prompt: <prompts/<n>.txt 内容> | output: volumes/<vid>/<n>.png`
- 必传：`--ratio 1:1 --size 1024x1024`
- **不传** `--size 4K`

#### 6.3 验证

调 `scripts/verify-pages.ts` 的 `verifyPages(volumeDir, totalPages)`。
- 全部 OK → state 登记 `phase: "imaged"`
- 有失败页 → 列出失败页 + reason + `prompts/<n>.txt` 路径，
  接受用户自然语言（"重试 5、9 页" / "改 5 页 prompt 后重试"）。
  - 解析用 `scripts/parse-retry.ts`（Task 4）的 `parseRetrySpec(input, totalPages)`
  - 仅对解析出的页号重新派发 image-generation
- 失败页数 > 50% → 报告 + 退出，不强行继续

### Step 7 — 静态 EPUB + PDF 打包

```bash
bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts \
  --input series-output/<slug>/volumes/<vid> \
  --title "<册名>" \
  --author "<series-meta.author 或默认>" \
  --lang <series-meta.language>
```

PDF 暂走与单本相同流程（如有）。
写出 `volumes/<vid>/meta.json`（spec §4.7），state 登记 `phase: "packaged"`。

### Step 8 — 自动衔接有声 EPUB

调用 `audio-picture-book-creator` skill。给它的输入：
- 静态 EPUB 路径
- voice_profile 来自 `bible/characters.md` 的主角字段（不询问用户）

成功 → state 登记 `audio: true, built_at: <now>`。
失败 → state 登记 `audio: false`，输出"Step 8 失败但 packaged 已完成,可手动重试"，**不**让 Step 7 的成果回滚。

### Step 9 — 登记 + outline 回写

如果实际页数 ≠ outline `planned_pages`：
- 调 `outline-parse.ts` 的 `parseOutline + serializeOutline` 回写
  `seasons/<season>/volumes-outline.md`，更新 `planned_pages` 与
  `outline_revision++`
- 在 state 中写 `volumes[vid].pages = <actual>`

最后输出指引：
```
✅ 第 <N> 册 packaged + audio 完成
📂 series-output/<slug>/volumes/<vid>/
   ├── <册名>.epub
   └── <册名>-audio.epub
下一步：
  • 做下一册 → 继续召唤本 skill
  • 出本季合订本 → 召唤 series-omnibus-packager
```

## 与 picture-book-creator 阶段对照

| picture-book-creator 阶段 | 本 skill 对应 | 关键差异 |
|---|---|---|
| 阶段 1 需求收集 | Step 0 (+ 可选 Step 1) | 大量字段从 Bible/outline 继承 |
| 阶段 2 故事方案（3 选 1） | **删除** | outline 已定梗概 |
| 阶段 3 分页脚本 | Step 2 | 格式相同 |
| 阶段 4 可读性测试 | Step 3 | 完全相同 |
| 阶段 5 角色与风格 | **删除** | Bible 已定 |
| 阶段 6 Prompt + 生图 | Step 5 + 6 | Prompt 来源不同；写死 1024×1024 |
| 阶段 7 EPUB 打包 | Step 7 | 完全相同 |
| (无) | Step 8 自动有声 | 连载独有 |

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `volumes/<vid>/meta.json` | omnibus-packager | volume_id, season, title, pages, outputs.epub |
| `volumes/<vid>/<n>.png` | omnibus-packager | 文件名按 0,1,2,... 严格命名 |
| `volumes/<vid>/<title>.epub` | 用户 | Fixed-Layout EPUB3 |
| `volumes/<vid>/<title>-audio.epub` | 用户 | Media Overlays EPUB3 |

omnibus-packager **不读** script.md / characters-patch.md / prompts/。

## Common Mistakes

- **改写 prompt_anchor**：禁止；compose-prompt 已强制原样复制 Bible 锚定
- **传 `--size 4K`**：连载多册 4K 成本翻倍；只用 1024×1024
- **失败时全部重做**：用 parse-retry 只跑失败页
- **Step 8 失败时回滚 Step 7**：不允许；packaged + audio:false 是合法状态

## Implementation

| 模块 | 路径 | 来源 |
|---|---|---|
| state I/O | `series-bible-creator/scripts/lib/state.ts` | Task 1 |
| outline parser | `series-season-planner/scripts/outline-parse.ts` | Task 2 |
| compose prompt | `series-volume-creator/scripts/compose-prompt.ts` | Task 3 |
| parse retry | `series-volume-creator/scripts/parse-retry.ts` | Task 4 |
| load context | `series-volume-creator/scripts/load-context.ts` | this task |
| verify pages | `series-volume-creator/scripts/verify-pages.ts` | this task |
| EPUB 打包 | `picture-book-creator/scripts/generate-epub.ts` | existing |
| 单图生成 | `image-generation` skill | existing |
| 有声版 | `audio-picture-book-creator` skill | existing |
