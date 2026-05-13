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
  // 测试默认禁用速率限制；个别用例显式开启
  process.env.IMAGE_GEN_MIN_INTERVAL_MS = "0";
});

afterEach(async () => {
  delete process.env.IMAGE_GEN_SEMA_DIR;
  delete process.env.IMAGE_GEN_MAX_CONCURRENCY;
  delete process.env.IMAGE_GEN_MIN_INTERVAL_MS;
  await rm(semaDir, { recursive: true, force: true });
});

describe("concurrency-gate: single-process serial", () => {
  it("acquire-release 3 次都立刻拿到（slot 复用，无速率限制时）", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "2";
    process.env.IMAGE_GEN_MIN_INTERVAL_MS = "0";
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
    process.env.IMAGE_GEN_MIN_INTERVAL_MS = "0";
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
    process.env.IMAGE_GEN_MIN_INTERVAL_MS = "0";
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
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
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

// ===== 速率门（MIN_INTERVAL_MS）测试 =====

describe("rate-gate: MIN_INTERVAL_MS 强制最小请求间隔", () => {
  it("MIN_INTERVAL_MS=300 时 3 次串行 acquire 总耗时 ≥ 600ms（首次免等）", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "2";
    process.env.IMAGE_GEN_MIN_INTERVAL_MS = "300";

    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await acquireSlot();
      // 立即释放 slot；rate-gate 仍应在下次 acquire 前强制等待
      await r();
    }
    const elapsed = Date.now() - t0;
    // 第 1 次 0ms + 第 2 次 ~300ms + 第 3 次 ~300ms = ~600ms（容忍系统抖动）
    expect(elapsed).toBeGreaterThanOrEqual(550);
  });

  it("MIN_INTERVAL_MS=0 时 5 次连续 acquire 不被节流", async () => {
    process.env.IMAGE_GEN_MAX_CONCURRENCY = "2";
    process.env.IMAGE_GEN_MIN_INTERVAL_MS = "0";

    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      const r = await acquireSlot();
      await r();
    }
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("跨进程：MIN_INTERVAL_MS=400 时 3 个并发子进程总耗时 ≥ 800ms", async () => {
    const helper = resolve(
      ".claude/skills/image-generation/scripts/test/fixtures/concurrency-helper.ts",
    );

    const t0 = Date.now();
    const procs = [0, 1, 2].map(() =>
      Bun.spawn({
        cmd: ["bun", "run", helper, "0"], // helper 内部只 acquire+release，不 sleep
        env: {
          ...process.env,
          IMAGE_GEN_MAX_CONCURRENCY: "2",
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "400",
        },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    const elapsed = Date.now() - t0;

    for (const c of codes) expect(c).toBe(0);
    // 第 1 次 ~0ms + 第 2 次 ≥400ms + 第 3 次 ≥400ms（取决于调度）
    expect(elapsed).toBeGreaterThanOrEqual(700);
  });
});

describe("rate-gate: IMAGE_GEN_MIN_INTERVAL_MS 校验（subprocess）", () => {
  const helper = resolve(
    ".claude/skills/image-generation/scripts/test/fixtures/concurrency-helper.ts",
  );

  function runHelperWith(intervalValue: string) {
    return Bun.spawnSync({
      cmd: ["bun", "run", helper, "0"],
      env: {
        ...process.env,
        IMAGE_GEN_MAX_CONCURRENCY: "1",
        IMAGE_GEN_MIN_INTERVAL_MS: intervalValue,
        IMAGE_GEN_SEMA_DIR: semaDir,
      },
    });
  }

  it("非数字抛错", () => {
    const res = runHelperWith("abc");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MIN_INTERVAL_MS");
  });

  it("负数抛错", () => {
    const res = runHelperWith("-1");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MIN_INTERVAL_MS");
  });

  it(">600000 抛错", () => {
    const res = runHelperWith("600001");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("IMAGE_GEN_MIN_INTERVAL_MS");
  });

  it("0 合法（禁用速率门）", () => {
    const res = runHelperWith("0");
    expect(res.exitCode).toBe(0);
  });
});
