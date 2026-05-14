import { describe, test, expect } from "bun:test";
import { parseSeasonArc } from "./season-arc-parse";

const SAMPLE = `---
season_id: s1
title: 第一季：开张啦
volumes_planned: 6
opening_state: 主角小熊刚搬进新城,面包房还没招牌
ending_state: 小熊学会让顾客等待中的小欢喜
key_turn_points:
  - volume: s1v3
    event: 第一次面包烤糊但顾客反而喜欢
  - volume: s1v5
    event: 邻居老猫给小熊送来祖传食谱
new_characters:
  - 老猫先生（s1v5 出现）
arc_locked: true
---

# 季弧线叙述

散文形式叙述本季成长主线。

# 给下一季的伏笔

- 老猫先生临别提到"北边的小狐狸面包师"
- 小熊还没学会做生日蛋糕
`;

describe("parseSeasonArc", () => {
  test("parses scalar frontmatter", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.season_id).toBe("s1");
    expect(a.title).toBe("第一季：开张啦");
    expect(a.volumes_planned).toBe(6);
    expect(a.arc_locked).toBe(true);
  });

  test("parses key_turn_points as list of {volume, event}", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.key_turn_points).toHaveLength(2);
    expect(a.key_turn_points[0]).toEqual({ volume: "s1v3", event: "第一次面包烤糊但顾客反而喜欢" });
    expect(a.key_turn_points[1]).toEqual({ volume: "s1v5", event: "邻居老猫给小熊送来祖传食谱" });
  });

  test("parses new_characters as string list", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.new_characters).toEqual(["老猫先生（s1v5 出现）"]);
  });

  test("captures '给下一季的伏笔' bullets as foreshadowing array", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.foreshadowing_for_next_season).toEqual([
      `老猫先生临别提到"北边的小狐狸面包师"`,
      "小熊还没学会做生日蛋糕",
    ]);
  });

  test("foreshadowing is empty when section missing", () => {
    const noFore = SAMPLE.replace(/# 给下一季的伏笔[\s\S]*$/, "");
    const a = parseSeasonArc(noFore);
    expect(a.foreshadowing_for_next_season).toEqual([]);
  });

  test("rejects missing frontmatter", () => {
    expect(() => parseSeasonArc("# bare\n")).toThrow(/frontmatter/);
  });

  test("rejects non-integer volumes_planned", () => {
    const bad = SAMPLE.replace("volumes_planned: 6", "volumes_planned: many");
    expect(() => parseSeasonArc(bad)).toThrow(/volumes_planned/);
  });

  test("rejects negative volumes_planned", () => {
    const bad = SAMPLE.replace("volumes_planned: 6", "volumes_planned: -1");
    expect(() => parseSeasonArc(bad)).toThrow(/volumes_planned/);
  });

  test("rejects empty required scalar (e.g. blank season_id)", () => {
    const bad = SAMPLE.replace("season_id: s1", "season_id: ");
    expect(() => parseSeasonArc(bad)).toThrow(/season_id/);
  });

  test("rejects key_turn_points item missing event field", () => {
    // Replace the second KTP with a malformed one that has volume but no event
    const bad = SAMPLE.replace(
      "  - volume: s1v5\n    event: 邻居老猫给小熊送来祖传食谱",
      "  - volume: s1v5"
    );
    expect(() => parseSeasonArc(bad)).toThrow(/key_turn_points/);
  });

  test("string-list bullet containing colon is preserved (not misparsed as object)", () => {
    const withColon = SAMPLE.replace(
      "  - 老猫先生（s1v5 出现）",
      "  - 老猫先生: s1v5 出现的智者"
    );
    const a = parseSeasonArc(withColon);
    expect(a.new_characters).toEqual(["老猫先生: s1v5 出现的智者"]);
  });
});
