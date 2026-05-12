import { describe, expect, test } from "bun:test";
import { aggregateToSentences, sanityCheck } from "../lib/timestamp-aggregator";

describe("aggregateToSentences", () => {
  test("把 words 按句子原文位置切片成句级时间戳", () => {
    const text = "毛毛跑了。前面有花。";
    const sentences = ["毛毛跑了。", "前面有花。"];
    const words = [
      { text: "毛毛", start_ms: 0, end_ms: 400 },
      { text: "跑", start_ms: 400, end_ms: 600 },
      { text: "了", start_ms: 600, end_ms: 900 },
      { text: "前面", start_ms: 1100, end_ms: 1500 },
      { text: "有", start_ms: 1500, end_ms: 1700 },
      { text: "花", start_ms: 1700, end_ms: 2000 },
    ];

    const result = aggregateToSentences(text, sentences, words);
    expect(result).toEqual([
      { text: "毛毛跑了。", start_ms: 0, end_ms: 900 },
      { text: "前面有花。", start_ms: 1100, end_ms: 2000 },
    ]);
  });

  test("某句无对应word时取前后句的边界兜底", () => {
    const text = "啊。哈。哦。";
    const sentences = ["啊。", "哈。", "哦。"];
    const words = [
      { text: "啊", start_ms: 0, end_ms: 200 },
      // "哈" 缺失
      { text: "哦", start_ms: 800, end_ms: 1000 },
    ];

    const result = aggregateToSentences(text, sentences, words);
    expect(result[0]).toEqual({ text: "啊。", start_ms: 0, end_ms: 200 });
    expect(result[1]).toEqual({ text: "哈。", start_ms: 200, end_ms: 800 });
    expect(result[2]).toEqual({ text: "哦。", start_ms: 800, end_ms: 1000 });
  });

  test("第一句缺word时start_ms=0", () => {
    const text = "啊。哈。";
    const sentences = ["啊。", "哈。"];
    const words = [{ text: "哈", start_ms: 500, end_ms: 800 }];

    const result = aggregateToSentences(text, sentences, words);
    expect(result[0].start_ms).toBe(0);
    expect(result[0].end_ms).toBe(500);
  });
});

describe("sanityCheck", () => {
  test("words总时长在mp3 duration ±10%内不调整", () => {
    const sentences = [{ text: "啊", start_ms: 0, end_ms: 1000 }];
    const result = sanityCheck(sentences, 1050);
    expect(result.adjusted).toBe(false);
    expect(result.sentences[0].end_ms).toBe(1000);
  });

  test("words总时长偏差>10%按比例线性重整", () => {
    const sentences = [
      { text: "a", start_ms: 0, end_ms: 500 },
      { text: "b", start_ms: 500, end_ms: 1000 },
    ];
    // 实际 mp3 duration 2000ms，words 报告 1000ms，比例 2x
    const result = sanityCheck(sentences, 2000);
    expect(result.adjusted).toBe(true);
    expect(result.sentences[0].end_ms).toBe(1000);
    expect(result.sentences[1].end_ms).toBe(2000);
  });

  test("words为空时兜底单段", () => {
    const result = sanityCheck([], 3000);
    expect(result.adjusted).toBe(true);
    expect(result.sentences).toEqual([]);
  });
});
