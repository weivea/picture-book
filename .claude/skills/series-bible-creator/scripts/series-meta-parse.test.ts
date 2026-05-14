import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSeriesMeta } from "./series-meta-parse";

const SAMPLE = readFileSync(join(import.meta.dir, "test/fixtures/series-meta.md"), "utf-8");

describe("parseSeriesMeta", () => {
  test("parses scalar fields", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.slug).toBe("xiaoxiong-mianbaofang");
    expect(m.title).toBe("小熊面包房的故事");
    expect(m.age_range).toBe("4-6");
    expect(m.language).toBe("zh");
    expect(m.series_scale).toBe("medium");
    expect(m.typical_pages_per_volume).toBe(12);
  });

  test("parses list fields", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.education_goals).toEqual(["学会等待", "认识团队合作"]);
    expect(m.taboos).toEqual(["不出现现实人类"]);
  });

  test("captures markdown body after frontmatter", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.body).toContain("# 系列概述");
    expect(m.body).toContain("一段散文形式的整体介绍。");
  });

  test("rejects missing required field 'slug'", () => {
    const bad = SAMPLE.replace(/slug:.*\n/, "");
    expect(() => parseSeriesMeta(bad)).toThrow(/slug/);
  });

  test("rejects invalid series_scale", () => {
    const bad = SAMPLE.replace("series_scale: medium", "series_scale: huge");
    expect(() => parseSeriesMeta(bad)).toThrow(/series_scale/);
  });

  test("rejects missing frontmatter", () => {
    expect(() => parseSeriesMeta("# just markdown\n")).toThrow(/frontmatter/);
  });

  test("rejects non-integer typical_pages_per_volume", () => {
    const bad = SAMPLE.replace("typical_pages_per_volume: 12", "typical_pages_per_volume: twelve");
    expect(() => parseSeriesMeta(bad)).toThrow(/typical_pages_per_volume/);
  });

  test("rejects empty required scalar (e.g. blank slug)", () => {
    const bad = SAMPLE.replace("slug: xiaoxiong-mianbaofang", "slug: ");
    expect(() => parseSeriesMeta(bad)).toThrow(/slug/);
  });
});
