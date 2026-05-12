import { describe, expect, test } from "bun:test";
import { parseScript } from "../lib/parse-script";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures/mini-script.md");

describe("parseScript", () => {
  test("提取每页的 text 字段", async () => {
    const pages = await parseScript(fixture);
    expect(pages).toEqual([
      { pageNum: 0, text: "测试绘本" },
      { pageNum: 1, text: "毛毛跑啊跑。前面有花。" },
      { pageNum: 2, text: "小猫笑了。" },
    ]);
  });

  test("缺失文件抛错", async () => {
    await expect(parseScript("/nonexistent.md")).rejects.toThrow();
  });
});
