// .claude/skills/novel-chapter-workshop/scripts/test/pattern-scanner.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanPatterns } from "../lib/pattern-scanner";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

describe("scanPatterns", () => {
  it("捕获 sloppy fixture 的开篇套路", async () => {
    const ch = await readFile(FIX("ch-sloppy.md"), "utf8");
    const hits = scanPatterns(ch);
    // 期望命中：开篇 "在那个X与Y交织的Z" 模式
    expect(hits.some((h) => h.code === "ARCHETYPE_OPENING_BIPOLAR")).toBe(true);
  });

  it("捕获缺对话归属", async () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: 林晚 -->\n"我来了。"\n"你早。"\n<!-- /SCENE -->\n`;
    const hits = scanPatterns(md);
    expect(hits.some((h) => h.code === "DIALOG_ATTRIB_MISSING")).toBe(true);
  });

  it("好章节命中为 0", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const hits = scanPatterns(ch);
    expect(hits).toHaveLength(0);
  });

  it("hit 含行号", () => {
    const md = `---\nx: y\n---\n\n在那个充满希望与绝望交织的清晨，林晚醒来。`;
    const hits = scanPatterns(md);
    expect(hits[0].line).toBeGreaterThan(0);
  });
});
