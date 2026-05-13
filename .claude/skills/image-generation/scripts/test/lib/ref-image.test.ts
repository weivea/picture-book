import { describe, it, expect } from "bun:test";
import { detectRefMime, MAX_REF_BYTES } from "../../lib/ref-image";

describe("detectRefMime", () => {
  it("PNG magic → image/png", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectRefMime(buf)).toBe("image/png");
  });
  it("JPEG magic → image/jpeg", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectRefMime(buf)).toBe("image/jpeg");
  });
  it("ASCII 文本 → null", () => {
    expect(detectRefMime(Buffer.from("hello world"))).toBeNull();
  });
  it("空 buffer → null", () => {
    expect(detectRefMime(Buffer.from([]))).toBeNull();
  });
  it("仅 2 字节 PNG header → null（不足以确认）", () => {
    expect(detectRefMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("MAX_REF_BYTES", () => {
  it("= 50 MB", () => {
    expect(MAX_REF_BYTES).toBe(50 * 1024 * 1024);
  });
});
