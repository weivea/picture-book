import { describe, expect, test } from "bun:test";
import { buildSmil } from "../lib/smil-builder";

describe("buildSmil", () => {
  test("生成包含 par 元素的 well-formed SMIL", () => {
    const smil = buildSmil({
      pageNum: 1,
      sentences: [
        { text: "啊。", start_ms: 0, end_ms: 1000 },
        { text: "哈。", start_ms: 1000, end_ms: 2000 },
      ],
    });

    expect(smil).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(smil).toContain('xmlns="http://www.w3.org/ns/SMIL"');
    expect(smil).toContain('epub:textref="../page-1.xhtml"');
    expect(smil).toContain('id="seq1"');
    expect(smil).toContain('<text src="../page-1.xhtml#p1-s1"/>');
    expect(smil).toContain('<text src="../page-1.xhtml#p1-s2"/>');
    expect(smil).toContain('clipBegin="0ms"');
    expect(smil).toContain('clipEnd="1000ms"');
    expect(smil).toContain('clipBegin="1000ms"');
    expect(smil).toContain('clipEnd="2000ms"');
    expect(smil).toContain('src="../audio/1.mp3"');
  });

  test("封面页 page 0 同样工作", () => {
    const smil = buildSmil({
      pageNum: 0,
      sentences: [{ text: "标题", start_ms: 0, end_ms: 1500 }],
    });
    expect(smil).toContain('id="seq0"');
    expect(smil).toContain('epub:textref="../page-0.xhtml"');
    expect(smil).toContain('src="../audio/0.mp3"');
    expect(smil).toContain('id="par0-1"');
  });

  test("页尾停顿会延长最后一句 clipEnd", () => {
    const smil = buildSmil({
      pageNum: 1,
      durationMs: 2500,
      trailingPauseMs: 2000,
      sentences: [
        { text: "啊。", start_ms: 0, end_ms: 1000 },
        { text: "哈。", start_ms: 1000, end_ms: 2000 },
      ],
    });

    expect(smil).toContain('clipEnd="1000ms"');
    expect(smil).toContain('clipEnd="4500ms"');
  });

  test("空 sentences 生成空 seq", () => {
    const smil = buildSmil({ pageNum: 1, sentences: [] });
    expect(smil).toContain("<seq");
    expect(smil).not.toContain("<par");
  });
});
