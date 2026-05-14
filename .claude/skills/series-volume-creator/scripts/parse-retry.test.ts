import { describe, test, expect } from "bun:test";
import { parseRetrySpec } from "./parse-retry";

describe("parseRetrySpec", () => {
  test("parses Chinese comma list", () => {
    expect(parseRetrySpec("重试 5、9 页", 12)).toEqual([5, 9]);
  });

  test("parses Chinese ASCII comma list", () => {
    expect(parseRetrySpec("重试 1, 3, 5 页", 12)).toEqual([1, 3, 5]);
  });

  test("parses English comma list", () => {
    expect(parseRetrySpec("redo pages 2, 4, 6", 12)).toEqual([2, 4, 6]);
  });

  test("parses ranges with hyphen", () => {
    expect(parseRetrySpec("重试 3-6 页", 12)).toEqual([3, 4, 5, 6]);
  });

  test("parses Chinese 至 range", () => {
    expect(parseRetrySpec("重试 3 至 6 页", 12)).toEqual([3, 4, 5, 6]);
  });

  test("mixes ranges and singletons", () => {
    expect(parseRetrySpec("重试 1、3-5、9 页", 12)).toEqual([1, 3, 4, 5, 9]);
  });

  test("dedupes and sorts", () => {
    expect(parseRetrySpec("重试 9、3、5、3 页", 12)).toEqual([3, 5, 9]);
  });

  test("includes page 0 (cover)", () => {
    expect(parseRetrySpec("重试 0 页", 12)).toEqual([0]);
  });

  test("throws when a page is out of range", () => {
    expect(() => parseRetrySpec("重试 15 页", 12)).toThrow(/15/);
  });

  test("throws when a range exceeds total", () => {
    expect(() => parseRetrySpec("重试 10-20 页", 12)).toThrow();
  });

  test("throws when input contains no numbers", () => {
    expect(() => parseRetrySpec("再做一次", 12)).toThrow(/no page numbers/i);
  });

  test("throws on inverted range", () => {
    expect(() => parseRetrySpec("重试 9-3 页", 12)).toThrow(/range/i);
  });
});
