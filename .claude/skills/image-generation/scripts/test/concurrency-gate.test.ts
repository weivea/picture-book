// .claude/skills/image-generation/scripts/test/concurrency-gate.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { acquireSlot } from "../lib/concurrency-gate";

function tmpSemaDir(): string {
  return `/tmp/test-image-gen-sema-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

let semaDir: string;

beforeEach(() => {
  semaDir = tmpSemaDir();
  process.env.IMAGE_GEN_SEMA_DIR = semaDir;
  delete process.env.IMAGE_GEN_MAX_CONCURRENCY;
});

afterEach(async () => {
  delete process.env.IMAGE_GEN_SEMA_DIR;
  delete process.env.IMAGE_GEN_MAX_CONCURRENCY;
  await rm(semaDir, { recursive: true, force: true });
});

describe("concurrency-gate: single-process serial", () => {
  it("acquire-release 3 次都立刻拿到（slot 复用）", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "2";
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const release = await acquireSlot();
      expect(Date.now() - t0).toBeLessThan(100);
      await release();
    }
  });
});

describe("concurrency-gate: full → release wakes pending", () => {
  it("MAX=2 时第 3 个 acquire 会等待，释放后被唤醒", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "2";
    const r1 = await acquireSlot();
    const r2 = await acquireSlot();

    let resolvedAt: number | null = null;
    const t0 = Date.now();
    const p3 = acquireSlot().then((rel) => {
      resolvedAt = Date.now();
      return rel;
    });

    await new Promise((r) => setTimeout(r, 250));
    expect(resolvedAt).toBeNull();

    await r1();
    const r3 = await p3;
    expect(resolvedAt).not.toBeNull();
    expect(resolvedAt! - t0).toBeLessThan(1500);

    await r2();
    await r3();
  });
});

describe("concurrency-gate: stale lock 自动清理", () => {
  it("死 pid 占据的 lock 会被回收", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "1";
    await mkdir(semaDir, { recursive: true });
    const lockDir = join(semaDir, "slot-1.lock");
    await mkdir(lockDir);
    await writeFile(join(lockDir, "pid"), "999999");
    await writeFile(join(lockDir, "started"), String(Date.now()));

    const t0 = Date.now();
    const release = await acquireSlot();
    expect(Date.now() - t0).toBeLessThan(500);
    await release();
  });
});

describe("concurrency-gate: env 校验（subprocess）", () => {
  // env 在每次 acquireSlot 调用时校验；用子进程跑 helper 来稳定地拿到 stderr
  const helper = resolve(
    ".claude/skills/image-generation/scripts/test/fixtures/concurrency-helper.ts",
  );

  function runHelperWith(maxValue: string) {
    return Bun.spawnSync({
      cmd: ["bun", "run", helper, "0"],
      env: {
        ...process.env,
        IMAGE_GEN_MAX_CONCURRENCY: maxValue,
        IMAGE_GEN_SEMA_DIR: semaDir,
      },
    });
  }

  it("非数字抛错", () => {
    const res = runHelperWith("abc");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MAX_CONCURRENCY");
  });

  it("0 抛错", () => {
    const res = runHelperWith("0");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MAX_CONCURRENCY");
  });

  it(">16 抛错", () => {
    const res = runHelperWith("20");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MAX_CONCURRENCY");
  });
});

describe("concurrency-gate: 跨进程串行化", () => {
  it("MAX=1 时 3 个子进程串行，总耗时 ≥ 3×单次", async () => {
    const helper = resolve(
      ".claude/skills/image-generation/scripts/test/fixtures/concurrency-helper.ts",
    );
    expect(existsSync(helper)).toBe(true);

    const t0 = Date.now();
    const procs = [0, 1, 2].map(() =>
      Bun.spawn({
        cmd: ["bun", "run", helper, "300"],
        env: {
          ...process.env,
          IMAGE_GEN_MAX_CONCURRENCY: "1",
          IMAGE_GEN_SEMA_DIR: semaDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    const elapsed = Date.now() - t0;

    for (const c of codes) expect(c).toBe(0);
    // 严格串行：≥ 3 × 300ms - 启动开销容忍 ⇒ ≥ 800ms
    expect(elapsed).toBeGreaterThanOrEqual(800);
  });
});
