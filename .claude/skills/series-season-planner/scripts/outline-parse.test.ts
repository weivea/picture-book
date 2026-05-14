import { describe, test, expect } from "bun:test";
import { parseOutline, serializeOutline } from "./outline-parse";

const SAMPLE = `---
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
- summary: 第二天清早一只匆忙的兔子误闯进来,小熊给了他一块还没烤透的可颂。
- characters: [小熊, 兔子顾客]
- planned_pages: 10
- mood: 紧张 / 慌乱
`;

describe("parseOutline", () => {
  test("parses frontmatter", () => {
    const o = parseOutline(SAMPLE);
    expect(o.season_id).toBe("s1");
    expect(o.revision).toBe(1);
  });

  test("parses every volume entry", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes).toHaveLength(2);
    expect(o.volumes[0]!.id).toBe("s1v1");
    expect(o.volumes[0]!.title).toBe("招牌还没挂上");
    expect(o.volumes[0]!.beat).toBe("开篇 / 季初状态");
    expect(o.volumes[0]!.pov).toBe("小熊");
  });

  test("captures characters as array", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes[0]!.characters).toEqual(["小熊", "邻居老鼠"]);
  });

  test("captures planned_pages as number", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes[0]!.planned_pages).toBe(12);
    expect(o.volumes[1]!.planned_pages).toBe(10);
  });

  test("throws on missing frontmatter", () => {
    expect(() => parseOutline("## s1v1 no frontmatter\n")).toThrow();
  });
});

describe("serializeOutline", () => {
  test("round-trips a parsed outline", () => {
    const parsed = parseOutline(SAMPLE);
    const out = serializeOutline(parsed);
    const reparsed = parseOutline(out);
    expect(reparsed).toEqual(parsed);
  });

  test("updating planned_pages and revision survives round-trip", () => {
    const parsed = parseOutline(SAMPLE);
    parsed.volumes[0]!.planned_pages = 14;
    parsed.revision = 2;
    const out = serializeOutline(parsed);
    expect(out).toContain("revision: 2");
    expect(out).toContain("planned_pages: 14");
    const reparsed = parseOutline(out);
    expect(reparsed.revision).toBe(2);
    expect(reparsed.volumes[0]!.planned_pages).toBe(14);
  });
});
