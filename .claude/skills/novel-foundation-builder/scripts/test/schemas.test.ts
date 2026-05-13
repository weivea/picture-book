import { describe, it, expect } from "bun:test";
import {
  parseCharactersMd,
  parseOutlineMd,
  validateState,
  type FoundationState,
} from "../lib/schemas";

describe("parseCharactersMd", () => {
  it("解析合规的 characters.md", () => {
    const md = `---\ncount: 2\n---\n\n## 林晚\n- role: 主角\n- core: 失明少女靠灵气感知世界\n- wound: 12岁失明\n- want: 复明\n- need: 接受新感官\n- lie: 我必须看见才有价值\n- appearance: long silver hair, dark green robe, milky eyes\n- voice_profile: auto\n\n## 沈渊\n- role: 导师\n- core: 隐居灵气医师\n- wound: 失去爱徒\n- want: 不再收徒\n- need: 重新信任\n- lie: 教导即背叛\n- appearance: tall man with grey beard, faded blue robe\n- voice_profile: auto\n`;
    const result = parseCharactersMd(md);
    expect(result.count).toBe(2);
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0].name).toBe("林晚");
    expect(result.characters[0].appearance).toContain("silver hair");
    expect(result.characters[1].voice_profile).toBe("auto");
  });

  it("缺少 appearance 字段时报错", () => {
    const md = `---\ncount: 1\n---\n\n## 林晚\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- voice_profile: auto\n`;
    expect(() => parseCharactersMd(md)).toThrow(/appearance/);
  });

  it("count 与实际角色数不匹配时报错", () => {
    const md = `---\ncount: 3\n---\n\n## A\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: x\n- voice_profile: auto\n`;
    expect(() => parseCharactersMd(md)).toThrow(/count/);
  });
});

describe("parseOutlineMd", () => {
  it("解析合规的 outline.md", () => {
    const md = `---\ntier: short\nchapter_count: 2\ntarget_words_total: 10000\nbeat_structure: 5-act\n---\n\n## Chapter 1: 觉醒\n- beat: Opening Image\n- pov: 林晚\n- summary: 林晚在废墟苏醒，第一次感知到灵气流动。她意识到失去视觉之后，世界以另一种方式回到她身边。这一章建立基调。\n- scene_count_hint: 3\n\n## Chapter 2: 相遇\n- beat: Catalyst\n- pov: 林晚\n- summary: 林晚遇到沈渊，被告知她的感知能力极为罕见。她拒绝相信，但被一场袭击逼迫接受现实。\n- scene_count_hint: 4\n`;
    const result = parseOutlineMd(md);
    expect(result.tier).toBe("short");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe("觉醒");
    expect(result.chapters[0].sceneCountHint).toBe(3);
  });

  it("chapter_count 与实际章节数不匹配时报错", () => {
    const md = `---\ntier: short\nchapter_count: 5\ntarget_words_total: 10000\nbeat_structure: 5-act\n---\n\n## Chapter 1: x\n- beat: x\n- pov: x\n- summary: ${"x".repeat(80)}\n- scene_count_hint: 1\n`;
    expect(() => parseOutlineMd(md)).toThrow(/chapter_count/);
  });
});

describe("validateState", () => {
  it("接受合规 state", () => {
    const state: FoundationState = {
      version: 1,
      project: "test-novel",
      tier: "short",
      phase: "foundation_done",
      seed: "x",
      target_words: 10000,
      chapter_count: 5,
      created_at: "2026-05-13T00:00:00Z",
      debts: [],
      chapters: {},
    };
    expect(() => validateState(state)).not.toThrow();
  });

  it("拒绝未知 phase", () => {
    expect(() =>
      validateState({ phase: "unknown" } as unknown as FoundationState),
    ).toThrow(/phase/);
  });
});
