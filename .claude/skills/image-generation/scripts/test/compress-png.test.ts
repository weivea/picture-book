import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { readFile, mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { compressPngInPlace } from "../compress-png";

const FIXTURE = new URL(
  "../../tests/fixtures/sample.png",
  import.meta.url,
).pathname;

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
  test("把 ~1.7MB PNG 压缩到原始 50% 以下且仍是 PNG", async () => {
    const dir = await freshTmp();
    const out = join(dir, "out.png");

    const result = await compressPngInPlace(raw, out);

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
