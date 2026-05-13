// .claude/skills/novel-chapter-workshop/scripts/test/scene-marker-parser.test.ts
import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseScenes, type Scene } from "../lib/scene-marker-parser";

const FIX = (name: string) =>
  resolve(import.meta.dir, "fixtures", name);

describe("parseScenes", () => {
  it("解析 ch-good.md 的两个 SCENE", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const scenes = parseScenes(ch);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].title).toBe("苏醒");
    expect(scenes[0].location).toBe("北郊废墟");
    expect(scenes[0].mood).toBe("melancholy");
    expect(scenes[0].participants).toEqual(["林晚"]);
    expect(scenes[1].participants).toEqual(["林晚", "沈渊"]);
  });

  it("捕获正文（去除 SCENE 标记自身）", async () => {
    const ch = await readFile(FIX("ch-good.md"), "utf8");
    const scenes = parseScenes(ch);
    expect(scenes[0].body).toContain("林晚醒来时");
    expect(scenes[0].body).not.toContain("<!-- SCENE");
  });

  it("非法 mood 报错", () => {
    const md = `<!-- SCENE: x | location: y | mood: superhappy | participants: A -->\n.\n<!-- /SCENE -->\n`;
    expect(() => parseScenes(md)).toThrow(/mood/);
  });

  it("缺 closing tag 报错", () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: A -->\nbody`;
    expect(() => parseScenes(md)).toThrow(/closing/);
  });

  it("participants=none 解析为空数组", () => {
    const md = `<!-- SCENE: x | location: y | mood: calm | participants: none -->\nbody\n<!-- /SCENE -->\n`;
    const scenes = parseScenes(md);
    expect(scenes[0].participants).toEqual([]);
  });
});
