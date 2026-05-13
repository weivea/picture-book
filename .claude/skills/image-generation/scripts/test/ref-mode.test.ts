import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(import.meta.dir, "..", "generate-image.ts");

function run(args: string[]) {
  return spawnSync("bun", ["run", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, AZURE_API_KEY: "test-key" },
  });
}

function tmpPng(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ref-mode-"));
  const path = join(dir, name);
  // 1x1 PNG bytes are not needed here — guard fires before MIME detection in
  // these tests because we never get past the count check (or the file-exists
  // check). A non-empty file is enough.
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return path;
}

describe("--ref count guard", () => {
  it("rejects when --ref points to a non-existent file", () => {
    const out = run([
      "--prompt", "x",
      "--output", "/tmp/out.png",
      "--ref", "/tmp/does-not-exist-" + Date.now() + ".png",
    ]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("--ref 文件不存在");
  });

  it("accepts up to 6 --ref (passes the count guard)", () => {
    const refs: string[] = [];
    for (let i = 0; i < 6; i++) refs.push(tmpPng(`r${i}.png`));
    const args = ["--prompt", "x", "--output", "/tmp/out.png"];
    for (const r of refs) args.push("--ref", r);
    const out = run(args);
    // We don't expect success — there's no real Azure call. We only assert
    // the count guard does NOT fire.
    expect(out.stderr).not.toContain("最多支持 6 张参考图");
  });

  it("rejects 7 --ref with the new count message", () => {
    const refs: string[] = [];
    for (let i = 0; i < 7; i++) refs.push(tmpPng(`r${i}.png`));
    const args = ["--prompt", "x", "--output", "/tmp/out.png"];
    for (const r of refs) args.push("--ref", r);
    const out = run(args);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("--ref 当前最多支持 6 张参考图（收到 7 张）");
  });
});
