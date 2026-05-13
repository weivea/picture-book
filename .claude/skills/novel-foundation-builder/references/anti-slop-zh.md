# Anti-Slop 词表（中文）

> 本文件由 `novel-foundation-builder`（写入 voice.md 时引用）与 `novel-chapter-workshop/scripts/lib/slop-scanner.ts`（机械扫描）共同消费。
> 改动后两边都自动生效。

## Tier 1：见即删除（高 AI 概率短语）

每出现一次扣 1 分，drafting 阶段必须改写。

```
诸如
综上所述
不难看出
值得注意的是
让我们
在某种意义上
不容小觑
深入探讨
究其本质
归根结底
某种程度上
不可否认
显而易见
毋庸置疑
与此同时
然而值得一提的是
说到这里
这就是为什么
正所谓
有那么一瞬间
不知为何
莫名其妙地
```

## Tier 2：聚集警告（同段 ≥3 次触发重写）

单独使用没问题，但同段聚集即"AI 抒情套路"。

```
宛如
仿佛
似乎
彷彿
淡淡的
缓缓地
轻轻地
深深地
悄悄地
静静地
莫名
隐约
不自觉
不由得
忍不住
若有所思
意味深长
心中一动
心头一紧
心如刀绞
```

## Tier 3：结构性 AI 套路

在 LLM 评委 prompt 里作为 checklist；机械扫描可识别但难精确。

- "不是 X，而是 Y" 句式：每章 ≤ 1 次
- "X，是 Y，更是 Z" 三段递进式：禁用
- 段段三段式（主题句 → 举例 → 收束）：检测段首词与段长方差
- 对偶排比成癖：连续 3 段对仗即重写
- 破折号过度：每页 ≤ 2 次
- 场景结尾必"小哲理"（autonovel ANTI-PATTERN #11）：禁用
- 每章必"望天/望窗外/望远方"收尾：禁用
- 心理描写过度（"他想……他又想……他终于想明白……"）：用动作或对白替代

## 使用示例

```typescript
import { scanSlop } from "../../novel-chapter-workshop/scripts/lib/slop-scanner";
const report = scanSlop(chapterText);
// report = { tier1: [{phrase, count, lineNum}], tier2Clusters: [{paragraph, hits}], score: 8.3 }
```
