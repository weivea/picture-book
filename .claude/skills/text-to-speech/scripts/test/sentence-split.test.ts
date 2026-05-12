import { describe, expect, test } from "bun:test";
import { splitSentences } from "../lib/sentence-split";

describe("splitSentences", () => {
  test("按。！？切句并保留标点", () => {
    expect(splitSentences("毛毛跑啊跑！前面有什么？小兔子说。")).toEqual([
      "毛毛跑啊跑！",
      "前面有什么？",
      "小兔子说。",
    ]);
  });

  test("引号包裹的对话作为整体不拆", () => {
    expect(splitSentences('他说"我要回家！现在就走"。')).toEqual([
      '他说"我要回家！现在就走"。',
    ]);
  });

  test("「」中文引号同样保护", () => {
    expect(splitSentences("妈妈说「快睡吧。明天再玩」。")).toEqual([
      "妈妈说「快睡吧。明天再玩」。",
    ]);
  });

  test("超过25字的长段按，；二次拆", () => {
    const long = "今天的天气特别好阳光明媚而且没有风，所以我们决定去公园玩耍；带上风筝和野餐垫。";
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(long);
  });

  test("短段不二次拆即使有逗号", () => {
    expect(splitSentences("小猫，跑了。")).toEqual(["小猫，跑了。"]);
  });

  test("句末无标点整段一句", () => {
    expect(splitSentences("毛毛在外婆家过暑假")).toEqual(["毛毛在外婆家过暑假"]);
  });

  test("纯空字符串返回空数组", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  test("过滤空切片", () => {
    expect(splitSentences("！！句子。")).toEqual(["！", "！", "句子。"]);
  });
});
