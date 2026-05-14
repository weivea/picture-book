import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { verifyPages } from "./verify-pages";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);
// Real-ish 110KB filler so it passes the >100KB threshold.
const BIG_PNG = Buffer.concat([TINY_PNG, Buffer.alloc(110_000)]);

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "verify-pages-"));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "0.png"), BIG_PNG);  // ok
  await writeFile(join(root, "1.png"), BIG_PNG);  // ok
  await writeFile(join(root, "2.png"), TINY_PNG); // too small
  // page 3 missing
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("verifyPages", () => {
  test("flags missing page", async () => {
    const r = await verifyPages(root, 4);
    expect(r.ok).toContain(0);
    expect(r.ok).toContain(1);
    expect(r.failed.find((f) => f.page === 3)?.reason).toMatch(/missing/i);
  });
  test("flags too-small page (<100KB)", async () => {
    const r = await verifyPages(root, 4);
    expect(r.failed.find((f) => f.page === 2)?.reason).toMatch(/too small/i);
  });
  test("ok pages excluded from failed list", async () => {
    const r = await verifyPages(root, 2);
    expect(r.ok).toEqual([0, 1]);
    expect(r.failed).toEqual([]);
  });
});
