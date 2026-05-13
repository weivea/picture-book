// .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
import { describe, it, expect } from "bun:test";
import {
  buildScenePrompt,
  type StyleInfo,
} from "../lib/scene-prompt-builder";
import type { Scene } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

const style: StyleInfo = {
  promptPrefix: "Webtoon-style anime illustration, soft cel shading",
  negative: "no watermark, no text, no signature",
};

const anchors = new Map<string, string>([
  ["林晚", "long silver hair tied with red ribbon, dark green robe, milky eyes"],
  ["沈渊", "tall man with grey beard, faded blue robe"],
]);

describe("buildScenePrompt", () => {
  it("style + mood + anchors + body 顺序正确", () => {
    const scene: Scene = {
      index: 0,
      title: "门后之物",
      location: "北郊废墟",
      mood: "tense",
      participants: ["林晚", "沈渊"],
      body: "林晚走入废墟，听见沈渊的低语。",
      startLine: 5,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(prompt.startsWith("Webtoon-style anime illustration")).toBe(true);
    expect(prompt).toContain("tense atmosphere");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("grey beard");
    expect(prompt.endsWith("no watermark, no text, no signature")).toBe(true);
    expect(refPath).toBe("/tmp/portraits/林晚.png");
  });

  it("participants=[] 时无 ref", () => {
    const scene: Scene = {
      index: 0,
      title: "废墟",
      location: "北郊废墟",
      mood: "lonely",
      participants: [],
      body: "雪落在断墙上。",
      startLine: 1,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(refPath).toBeNull();
    expect(prompt).toContain("lonely atmosphere");
    expect(prompt).not.toContain("silver hair");
  });

  it("未知 participant 报错", () => {
    const scene: Scene = {
      index: 0,
      title: "x",
      location: "y",
      mood: "calm",
      participants: ["路人甲"],
      body: "x",
      startLine: 1,
    };
    expect(() =>
      buildScenePrompt(scene, anchors, style, { portraitsDir: "/tmp/portraits" }),
    ).toThrow(/路人甲/);
  });
});
