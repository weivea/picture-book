// .claude/skills/illustrated-audio-novel-creator/scripts/test/tier-config.test.ts
import { describe, it, expect } from "bun:test";
import { tierToConfig } from "../lib/tier-config";

describe("tierToConfig", () => {
  it("short", () => {
    const c = tierToConfig("short");
    expect(c.chapter_count).toBe(5);
    expect(c.words_per_chapter).toBe(2000);
    expect(c.target_words).toBe(10000);
    expect(c.beat_structure).toBe("5-act");
    expect(c.opus_review_enabled).toBe(false);
  });
  it("medium", () => {
    const c = tierToConfig("medium");
    expect(c.chapter_count).toBe(12);
    expect(c.target_words).toBe(30000);
    expect(c.beat_structure).toBe("9-beat");
    expect(c.opus_review_enabled).toBe(false);
  });
  it("long enables opus review", () => {
    const c = tierToConfig("long");
    expect(c.chapter_count).toBe(24);
    expect(c.target_words).toBe(72000);
    expect(c.beat_structure).toBe("save-the-cat-15");
    expect(c.opus_review_enabled).toBe(true);
  });
  it("非法 tier 报错", () => {
    expect(() => tierToConfig("epic" as unknown as "short")).toThrow(/tier/);
  });
  it("返回的 tier 字段与输入一致", () => {
    expect(tierToConfig("short").tier).toBe("short");
    expect(tierToConfig("medium").tier).toBe("medium");
    expect(tierToConfig("long").tier).toBe("long");
  });
});
