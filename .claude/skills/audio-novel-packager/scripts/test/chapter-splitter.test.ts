// .claude/skills/audio-novel-packager/scripts/test/chapter-splitter.test.ts
import { describe, it, expect } from "bun:test";
import { splitToSentences } from "../lib/chapter-splitter";

describe("splitToSentences", () => {
  it("按中文句末标点切句（quote+attribution 不被错误拆开）", () => {
    const text = "天黑了。她抬起头。\"我来了？\"她问。";
    const out = splitToSentences(text, ["林晚"]);
    expect(out.map((s) => s.text)).toEqual([
      "天黑了。",
      "她抬起头。",
      "\"我来了？\"她问。",
    ]);
  });

  it("显式归属：'林晚说'", () => {
    const text = "\"我累了。\"林晚说。\"我也是。\"沈渊低声。";
    const out = splitToSentences(text, ["林晚", "沈渊"]);
    expect(out).toHaveLength(2);
    expect(out[0].speaker).toBe("林晚");
    expect(out[1].speaker).toBe("沈渊");
  });

  it("participants 仅 1 人时，对话归属于该人", () => {
    const text = "\"我可以走了吗？\"她又问了一遍。";
    const out = splitToSentences(text, ["林晚"]);
    expect(out).toHaveLength(1);
    expect(out[0].speaker).toBe("林晚");
  });

  it("无对话或多人歧义 → narrator", () => {
    const text = "雪落了一夜。山路湿滑。";
    const out = splitToSentences(text, ["林晚", "沈渊"]);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.speaker === "narrator")).toBe(true);
  });

  it("idx 从 0 开始连续编号", () => {
    const out = splitToSentences("一。二。三。", []);
    expect(out.map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it("中文弯引号 “ ” 也算 quote（不被错误拆）", () => {
    const text = "他停顿。“我答不出？”她追问。";
    const out = splitToSentences(text, ["他", "她"]);
    expect(out.map((s) => s.text)).toEqual([
      "他停顿。",
      "“我答不出？”她追问。",
    ]);
  });
});
