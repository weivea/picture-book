import { describe, test, expect } from "bun:test";
import {
  composePrompt,
  composePagePrompt,
  type BibleStyle,
  type BibleCharacter,
  type PageSpec,
  type PatchEntry,
} from "./compose-prompt";

const STYLE: BibleStyle = {
  promptPrefix: "Soft watercolor illustration, gentle pastel palette",
  negative: "no humans, no realistic photo",
};

const BEAR: BibleCharacter = {
  name: "小熊",
  prompt_anchor: "small honey-colored bear cub with round black eyes",
  negative: "no fangs",
};

const PAGE: PageSpec = {
  page_number: 3,
  text: "小熊把面团揉成了圆圆的一团。",
  scene: "厨房中央的木桌上摆着一团白色的面团",
  action: "小熊用两只前爪揉面团",
  emotion: "专注 / 开心",
  composition: "中景,从面团斜上方看下去",
};

describe("composePrompt", () => {
  test("five sections appear in fixed order", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    const styleIdx = out.indexOf("Soft watercolor");
    const charIdx = out.indexOf("small honey-colored bear");
    const sceneIdx = out.indexOf("厨房中央");
    const textIdx = out.indexOf("小熊把面团揉成了");
    const negIdx = out.indexOf("no humans");
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(charIdx).toBeGreaterThan(styleIdx);
    expect(sceneIdx).toBeGreaterThan(charIdx);
    expect(textIdx).toBeGreaterThan(sceneIdx);
    expect(negIdx).toBeGreaterThan(textIdx);
  });

  test("bible anchor appears verbatim", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("small honey-colored bear cub with round black eyes");
  });

  test("patch anchor appended after bible anchor with comma", () => {
    const patches: PatchEntry[] = [
      { name: "小熊", anchor: "wearing a flour-dusted white apron" },
    ];
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches, page: PAGE });
    const bibleIdx = out.indexOf("small honey-colored bear cub with round black eyes");
    const patchIdx = out.indexOf("wearing a flour-dusted white apron");
    expect(bibleIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeGreaterThan(bibleIdx);
    const between = out.slice(bibleIdx + "small honey-colored bear cub with round black eyes".length, patchIdx);
    expect(between).toBe(", ");
  });

  test("emotion is included with the character", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("mood: 专注 / 开心");
  });

  test("page text is quoted into the TEXT section", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("小熊把面团揉成了圆圆的一团。");
  });

  test("character negative is merged into NEGATIVE section", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("no fangs");
    expect(out).toContain("no humans");
  });

  test("characters with no patch render without trailing comma", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).not.toMatch(/,\s*,/);
    expect(out).not.toContain(", (mood");
  });
});

describe("composePagePrompt (VolumeContext adapter)", () => {
  test("pulls style from raw style.md text and delegates to composePrompt", () => {
    const out = composePagePrompt({
      ctx: {
        style: "# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n",
        characters: new Map([["小熊", { prompt_anchor: "small honey-colored bear cub", negative: "no fangs" }]]),
        patch: null,
      },
      page: {
        pageNumber: 1,
        text: "小熊很开心。",
        scene: "厨房",
        action: "微笑",
        emotion: "开心",
        composition: "中景",
        characters: ["小熊"],
      },
    });
    expect(out).toContain("warm pastel watercolor");
    expect(out).toContain("small honey-colored bear cub");
    expect(out).toContain("小熊很开心。");
    expect(out).toContain("no fangs");
    expect(out).toContain("no watermark");
  });

  test("applies patch anchors for characters that have them", () => {
    const out = composePagePrompt({
      ctx: {
        style: "- style_prompt: x\n- negative_prompt: y\n",
        characters: new Map([["小熊", { prompt_anchor: "BEAR_ANCHOR" }]]),
        patch: new Map([["小熊", "wearing apron"]]),
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["小熊"],
      },
    });
    const bearIdx = out.indexOf("BEAR_ANCHOR");
    const aprIdx = out.indexOf("wearing apron");
    expect(bearIdx).toBeGreaterThanOrEqual(0);
    expect(aprIdx).toBeGreaterThan(bearIdx);
  });

  test("throws when a page references a character not in the bible", () => {
    expect(() => composePagePrompt({
      ctx: {
        style: "- style_prompt: x\n- negative_prompt: y\n",
        characters: new Map(),
        patch: null,
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["不存在"],
      },
    })).toThrow(/不存在/);
  });

  test("throws when style.md lacks style_prompt", () => {
    expect(() => composePagePrompt({
      ctx: {
        style: "# 风格\n",
        characters: new Map([["小熊", { prompt_anchor: "x" }]]),
        patch: null,
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["小熊"],
      },
    })).toThrow(/style_prompt/);
  });
});
