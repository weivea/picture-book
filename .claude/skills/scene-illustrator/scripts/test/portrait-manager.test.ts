// .claude/skills/scene-illustrator/scripts/test/portrait-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { audit } from "../lib/portrait-manager";

const TMP = "/tmp/scene-illustrator-test-portraits";

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
});
afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("audit", () => {
  it("两人有立绘、一人没有 → existing=2, missing=1", async () => {
    await writeFile(join(TMP, "林晚.png"), Buffer.from([0]));
    await writeFile(join(TMP, "沈渊.png"), Buffer.from([0]));
    const anchors = new Map<string, string>([
      ["林晚", "x"],
      ["沈渊", "y"],
      ["周泽", "z"],
    ]);
    const r = await audit(anchors, TMP);
    expect(r.existing).toEqual(["林晚", "沈渊"]);
    expect(r.missing).toEqual(["周泽"]);
  });

  it("空目录 → 全部 missing", async () => {
    const anchors = new Map<string, string>([
      ["A", "x"],
      ["B", "y"],
    ]);
    const r = await audit(anchors, TMP);
    expect(r.missing).toEqual(["A", "B"]);
    expect(r.existing).toEqual([]);
  });
});
