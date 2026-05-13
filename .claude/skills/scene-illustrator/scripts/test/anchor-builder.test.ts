// .claude/skills/scene-illustrator/scripts/test/anchor-builder.test.ts
import { describe, it, expect } from "bun:test";
import { buildAnchors, validateAnchor } from "../lib/anchor-builder";

const goodChars = `---\ncount: 2\n---\n\n## 林晚\n- role: 主角\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: long silver hair tied with red ribbon, dark green robe, milky-white blind eyes\n- voice_profile: zh-CN-XiaoxiaoNeural\n\n## 沈渊\n- role: 导师\n- core: x\n- wound: x\n- want: x\n- need: x\n- lie: x\n- appearance: tall man with grey beard, faded blue robe, jade pendant\n- voice_profile: zh-CN-YunyangNeural\n`;

describe("buildAnchors", () => {
  it("从 characters.md 抽出 name → anchor", () => {
    const map = buildAnchors(goodChars);
    expect(map.get("林晚")).toContain("silver hair");
    expect(map.get("沈渊")).toContain("jade pendant");
  });

  it("含中文 appearance 时报错（必须英文）", () => {
    const md = goodChars.replace("long silver hair", "长长的银发");
    expect(() => buildAnchors(md)).toThrow(/英文/);
  });
});

describe("validateAnchor", () => {
  it("接受满足三选二的 anchor", () => {
    expect(() =>
      validateAnchor("long silver hair, dark green robe"),
    ).not.toThrow(); // 颜色 + 服饰 ≥ 2
  });

  it("仅 1 类锚定时报错", () => {
    expect(() => validateAnchor("a person")).toThrow(/三选二/);
  });

  it("超过 25 token 报错", () => {
    const long = Array(30).fill("word").join(" ");
    expect(() => validateAnchor(long)).toThrow(/token/);
  });

  it("不被子串污染（silverware/blindfold 不算颜色或特征）", () => {
    // 仅靠子串拼凑出"颜色+特征"两类的伪锚定，应该被拒
    expect(() => validateAnchor("a silverware blindfold maker")).toThrow(
      /三选二/,
    );
  });

  it("CRLF 输入也能正常解析 characters.md", () => {
    const crlf = `---\r\ncount: 1\r\n---\r\n\r\n## 林晚\r\n- appearance: long silver hair, dark green robe, ribbon\r\n`;
    const map = buildAnchors(crlf);
    expect(map.get("林晚")).toContain("silver hair");
  });
});
