import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(import.meta.dir, "..", "generate-image.ts");

// Track every scratch dir we create so afterAll can sweep them.
const scratchDirs: string[] = [];

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function run(args: string[]) {
  // Hermetic env: each spawn gets its own per-call sema dir + zero rate
  // interval, so it can never inherit a polluted /tmp/image-gen-sema/ from the
  // host or from other tests. Also bound the spawn so any future stall fails
  // fast instead of hanging until Bun's default test timeout.
  const semaDir = mkScratchDir("ref-mode-sema-");
  return spawnSync("bun", ["run", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      AZURE_API_KEY: "test-key",
      IMAGE_GEN_SEMA_DIR: semaDir,
      IMAGE_GEN_MIN_INTERVAL_MS: "0",
    },
  });
}

function tmpPngsIn(dir: string, count: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = join(dir, `r${i}.png`);
    // Real PNG magic bytes — the "accepts 6" path passes the count guard and
    // reaches MIME detection downstream, so a valid PNG signature avoids
    // tripping the magic-byte validator on success-path tests.
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    paths.push(path);
  }
  return paths;
}

afterAll(() => {
  for (const d of scratchDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; nothing to do if it's already gone
    }
  }
});

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
    const dir = mkScratchDir("ref-mode-accept6-");
    const refs = tmpPngsIn(dir, 6);
    const args = ["--prompt", "x", "--output", "/tmp/out.png"];
    for (const r of refs) args.push("--ref", r);
    const out = run(args);
    // We don't expect success — there's no real Azure call. We only assert
    // the count guard does NOT fire, AND that no other --ref-related error
    // surfaces (e.g. arg-parsing regression that silently swallows refs).
    expect(out.stderr).not.toContain("最多支持 6 张参考图");
    expect(out.stderr).not.toMatch(/--ref/);
  });

  it("rejects 7 --ref with the new count message", () => {
    const dir = mkScratchDir("ref-mode-reject7-");
    const refs = tmpPngsIn(dir, 7);
    const args = ["--prompt", "x", "--output", "/tmp/out.png"];
    for (const r of refs) args.push("--ref", r);
    const out = run(args);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("--ref 当前最多支持 6 张参考图（收到 7 张）");
  });
});
