import { describe, test, expect } from "bun:test";
import { parseSeriesMeta } from "./series-meta-parse";

const SAMPLE = `---
slug: xiaoxiong-mianbaofang
title: 小熊面包房的故事
title_en: The Bear's Bakery
age_range: 4-6
language: zh
genre: 治愈 / 日常生活
series_scale: medium
typical_pages_per_volume: 12
education_goals:
  - 学会等待
  - 认识团队合作
taboos:
  - 不出现现实人类
created_at: 2026-05-14T08:30:00Z
---

# 系列概述

一段散文形式的整体介绍。
`;

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
});
