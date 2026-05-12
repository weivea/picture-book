import { describe, expect, test } from "bun:test";
import { msToISO8601, msToClipMs } from "../lib/duration";

describe("msToISO8601", () => {
  test("常规毫秒转 PT 格式", () => {
    expect(msToISO8601(4820)).toBe("PT4.820S");
    expect(msToISO8601(0)).toBe("PT0.000S");
    expect(msToISO8601(62500)).toBe("PT62.500S");
  });

  test("整秒补三位小数", () => {
    expect(msToISO8601(5000)).toBe("PT5.000S");
  });
});

describe("msToClipMs", () => {
  test("毫秒转 SMIL clipBegin 格式", () => {
    expect(msToClipMs(0)).toBe("0ms");
    expect(msToClipMs(1880)).toBe("1880ms");
  });
});
