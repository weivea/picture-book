import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { readFile, mkdtemp, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import pngquantPath from "pngquant-bin";
import oxipngPath from "oxipng-bin";
import { compressPngInPlace, __setBinariesForTest } from "../compress-png";

const FIXTURE = fileURLToPath(new URL("../../tests/fixtures/sample.png", import.meta.url));
const PNGQUANT_AVAILABLE = existsSync(pngquantPath as unknown as string);
const OXIPNG_AVAILABLE = existsSync(oxipngPath as unknown as string);

let tmp: string;
let raw: Buffer;

beforeAll(async () => {
  raw = await readFile(FIXTURE);
});

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function freshTmp(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "compress-png-"));
  return tmp;
}

describe("compressPngInPlace - happy path", () => {
  test("二进制可用时压缩 PNG；缺失时安全 fallback", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");

    const result = await compressPngInPlace(raw, out);

    if (!PNGQUANT_AVAILABLE || !OXIPNG_AVAILABLE) {
      expect(result.mode).toBe("fallback");
      expect(result.finalBytes).toBe(raw.length);
      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
      return;
    }

    expect(result.mode).toBe("compressed");
    expect(result.origBytes).toBe(raw.length);
    expect(result.finalBytes).toBeLessThan(raw.length * 0.5);

    const written = await readFile(out);
    // PNG magic number
    expect(written.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR width/height (bytes 16..23, big-endian uint32)
    expect(written.readUInt32BE(16)).toBe(1024);
    expect(written.readUInt32BE(20)).toBe(1024);

    const s = await stat(out);
    expect(s.size).toBe(result.finalBytes);
  });
});

describe("compressPngInPlace - SKIP_PNG_COMPRESS", () => {
  test("env=1 时直接落盘原图，mode=skipped", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const prev = process.env.SKIP_PNG_COMPRESS;
    process.env.SKIP_PNG_COMPRESS = "1";
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("skipped");
      expect(result.finalBytes).toBe(raw.length);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SKIP_PNG_COMPRESS;
      else process.env.SKIP_PNG_COMPRESS = prev;
    }
  });
});

describe("compressPngInPlace - fallback", () => {
  test("pngquant 二进制不存在 → mode=fallback, 文件等于原图", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const restore = __setBinariesForTest({
      pngquant: "/nonexistent/pngquant-please-fail",
    });
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("fallback");
      expect(result.finalBytes).toBe(raw.length);
      expect(result.fallbackReason).toMatch(/pngquant failed/);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      restore();
    }
  });

  test("oxipng 二进制不存在 → mode=fallback, 文件等于原图", async () => {
    if (!PNGQUANT_AVAILABLE) return;

    const dir = await freshTmp();
    const out = join(dir, "out.png");
    const restore = __setBinariesForTest({
      oxipng: "/nonexistent/oxipng-please-fail",
    });
    try {
      const result = await compressPngInPlace(raw, out);
      expect(result.mode).toBe("fallback");
      expect(result.finalBytes).toBe(raw.length);
      expect(result.fallbackReason).toMatch(/oxipng failed/);

      const written = await readFile(out);
      expect(written.equals(raw)).toBe(true);
    } finally {
      restore();
    }
  });
});
