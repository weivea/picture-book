// .claude/skills/novel-chapter-workshop/scripts/test/slop-scanner.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanSlop, type SlopHit } from "../lib/slop-scanner";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

const tinyAntiSlop = `# anti-slop-zh

## Tier 1（绝对禁用）
- 缓缓地
- 不禁
- 仿佛命运的齿轮

## Tier 2（容忍少量）
- 充满希望
- 深深的沉思

## Tier 3（视语境）
- 突然
`;

describe("scanSlop", () => {
  it("命中 Tier 1 词，记录 tier+term", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    const tier1 = hits.filter((h) => h.tier === 1);
    expect(tier1.map((h) => h.term)).toContain("缓缓地");
    expect(tier1.map((h) => h.term)).toContain("不禁");
    expect(tier1.map((h) => h.term)).toContain("仿佛命运的齿轮");
  });

  it("Tier 2 计入但与 Tier 1 区分", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    expect(hits.some((h) => h.tier === 2 && h.term === "深深的沉思")).toBe(true);
  });

  it("好章节命中数为 0", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const hits = scanSlop(ch, tinyAntiSlop);
    expect(hits).toHaveLength(0);
  });

  it("hit 包含 1-based 行号与列号", () => {
    const md = `---\nfoo: bar\n---\n\n第一段，没问题。\n第二段，缓缓地走过来。\n`;
    const hits = scanSlop(md, tinyAntiSlop);
    expect(hits[0].line).toBe(6);
    // "第二段，缓缓地走过来。" → 缓缓地 starts at index 4 (1-based column 5)
    expect(hits[0].column).toBe(5);
  });

  it("多行 SCENE 注释不打乱后续行号", () => {
    const md = [
      "---",
      "x: 1",
      "---",
      "",
      "<!-- SCENE: 序",
      "  location: 北郊",
      "  mood: tense",
      "-->",
      "第一行没问题。",
      "第二行：缓缓地走来。",
      "",
    ].join("\n");
    const hits = scanSlop(md, tinyAntiSlop);
    // 5 frontmatter lines (1–4) + 4-line SCENE comment (5–8) + body line 9 + body line 10
    expect(hits[0].line).toBe(10);
  });

  it("非 Tier 的 ## 小节不会污染上一 Tier 词表", () => {
    const md = [
      "## Tier 1（绝对禁用）",
      "- 缓缓地",
      "",
      "## 使用示例",
      "- 不该被当成 Tier 1 的示例短语",
      "",
    ].join("\n");
    // 在示例小节里的 bullet 不应被扫描命中
    const hits = scanSlop("不该被当成 Tier 1 的示例短语\n", md);
    expect(hits).toHaveLength(0);
  });
});
