// .claude/skills/image-generation/scripts/test/generate-image-retry.test.ts
//
// 用本地 mock HTTP server 验证 generate-image.ts 对 429/5xx 的退避重试逻辑。
// 每个用例独立 listen 在 OS 分配的端口（port:0），避免 CI 抢占。

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const SCRIPT = resolve(
  ".claude/skills/image-generation/scripts/generate-image.ts",
);

// 1×1 透明 PNG 的 base64
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

function tmpOut(): string {
  return `/tmp/test-gen-img-retry-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
}

let semaDir: string;

beforeEach(() => {
  semaDir = `/tmp/test-gen-img-sema-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
});

afterEach(async () => {
  await rm(semaDir, { recursive: true, force: true });
});

function startMockServer(handler: (req: Request) => Response | Promise<Response>) {
  return Bun.serve({ port: 0, fetch: handler });
}

/**
 * 用 Bun.spawn（异步） 而非 spawnSync —— 因为本测试进程同时跑 Bun.serve，
 * 同步 spawn 会阻塞事件循环导致 mock server 永远不响应（死锁）。
 */
async function runScript(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", SCRIPT, ...args],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { status: exitCode, stdout, stderr };
}

describe("generate-image: 429 retry", () => {
  it("第一次 429 + Retry-After: 1，第二次成功 → exit 0，文件落盘，耗时 ≥ 1s", async () => {
    let calls = 0;
    const server = startMockServer(() => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { code: "EngineOverloaded", message: "rate limited" } }),
          { status: 429, headers: { "Retry-After": "1" } },
        );
      }
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const out = tmpOut();
    try {
      const t0 = Date.now();
      const res = await runScript(
        ["--prompt", "test", "--output", out],
        {
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/`,
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
          SKIP_PNG_COMPRESS: "1",
        },
      );
      const elapsed = Date.now() - t0;

      expect(res.status).toBe(0);
      expect(calls).toBe(2);
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(0);
      // Retry-After: 1s — 容忍 OS 计时偏差，要求至少 800ms
      expect(elapsed).toBeGreaterThanOrEqual(800);
      // 应当看到 stderr 里写了重试日志
      expect(res.stderr).toContain("429");
    } finally {
      server.stop(true);
      await rm(out, { force: true });
    }
  }, 30_000);

  it("连续 4 次 429 → 重试 3 次后 exit 1，stderr 含 429", async () => {
    let calls = 0;
    const server = startMockServer(() => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: "EngineOverloaded", message: "x" } }),
        { status: 429, headers: { "Retry-After": "1" } },
      );
    });

    const out = tmpOut();
    try {
      const res = await runScript(
        ["--prompt", "test", "--output", out],
        {
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/`,
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
          SKIP_PNG_COMPRESS: "1",
        },
      );

      expect(res.status).toBe(1);
      // 1 次原始 + 3 次 retry = 4 次调用
      expect(calls).toBe(4);
      expect(res.stderr).toContain("429");
    } finally {
      server.stop(true);
      await rm(out, { force: true });
    }
  }, 30_000);

  it("500 也触发重试", async () => {
    let calls = 0;
    const server = startMockServer(() => {
      calls++;
      if (calls === 1) {
        return new Response("internal", {
          status: 500,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const out = tmpOut();
    try {
      const res = await runScript(
        ["--prompt", "test", "--output", out],
        {
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/`,
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
          SKIP_PNG_COMPRESS: "1",
        },
      );

      expect(res.status).toBe(0);
      expect(calls).toBe(2);
      expect(existsSync(out)).toBe(true);
    } finally {
      server.stop(true);
      await rm(out, { force: true });
    }
  }, 30_000);

  it("400 不重试（prompt 被审核拒绝场景） → 立即 exit 1", async () => {
    let calls = 0;
    const server = startMockServer(() => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: "content_filter", message: "blocked" } }),
        { status: 400 },
      );
    });

    const out = tmpOut();
    try {
      const res = await runScript(
        ["--prompt", "test", "--output", out],
        {
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/`,
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
          SKIP_PNG_COMPRESS: "1",
        },
      );

      expect(res.status).toBe(1);
      expect(calls).toBe(1); // 不重试
      expect(res.stderr).toContain("400");
    } finally {
      server.stop(true);
      await rm(out, { force: true });
    }
  }, 30_000);

  it("prompt 长度 > 4000 → 立即 die，不打 API", async () => {
    let calls = 0;
    const server = startMockServer(() => {
      calls++;
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
      });
    });

    const out = tmpOut();
    try {
      const longPrompt = "a".repeat(4001);
      const res = await runScript(
        ["--prompt", longPrompt, "--output", out],
        {
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/`,
          IMAGE_GEN_SEMA_DIR: semaDir,
          IMAGE_GEN_MIN_INTERVAL_MS: "0",
          SKIP_PNG_COMPRESS: "1",
        },
      );

      expect(res.status).toBe(1);
      expect(calls).toBe(0);
      expect(res.stderr).toContain("4000");
    } finally {
      server.stop(true);
      await rm(out, { force: true });
    }
  });
});
