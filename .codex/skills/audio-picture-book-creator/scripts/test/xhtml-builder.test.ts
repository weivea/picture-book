import { describe, expect, test } from "bun:test";
import { buildPageXhtml } from "../lib/xhtml-builder";

describe("buildPageXhtml", () => {
  test("生成包含 img 与可朗读 span 的 XHTML", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: ["毛毛跑了。", "前面有花。"],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });

    expect(xhtml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xhtml).toContain("<!DOCTYPE html>");
    expect(xhtml).toContain('<meta name="viewport" content="width=2048, height=2048"/>');
    expect(xhtml).toContain('src="images/1.png"');
    expect(xhtml).toContain('<span id="p1-s1">毛毛跑了。</span>');
    expect(xhtml).toContain('<span id="p1-s2">前面有花。</span>');
    expect(xhtml).toContain(".-epub-media-overlay-active");
  });

  test("封面页 page 0 同样工作", () => {
    const xhtml = buildPageXhtml({
      pageNum: 0,
      imageFile: "0.png",
      sentences: ["测试绘本"],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain('src="images/0.png"');
    expect(xhtml).toContain('<span id="p0-s1">测试绘本</span>');
  });

  test("XML 特殊字符被转义", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: ['他说"你好"。'],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain("&quot;你好&quot;");
  });

  test("空 sentences 生成无 caption 内容的页", () => {
    const xhtml = buildPageXhtml({
      pageNum: 1,
      imageFile: "1.png",
      sentences: [],
      viewportWidth: 2048,
      viewportHeight: 2048,
    });
    expect(xhtml).toContain('src="images/1.png"');
    expect(xhtml).not.toContain("<span");
  });
});
