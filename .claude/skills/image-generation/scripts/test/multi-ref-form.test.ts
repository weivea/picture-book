// 验证：3 张 --ref 时 multipart body 含 3 个 name="image" 字段，
// 文件名为各路径的 basename，顺序与 CLI 传入顺序一致；
// 默认带 input_fidelity=high；off 时不带。

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const SCRIPT = resolve(".claude/skills/image-generation/scripts/generate-image.ts");

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
const TINY_PNG_BUF = Buffer.from(TINY_PNG_B64, "base64");

const TIMEOUT_MS = 30_000;

interface CapturedRequest {
  imageNames: string[];
  fidelity: string | null;
  promptField: string | null;
}

function startCapture(): { server: ReturnType<typeof Bun.serve>; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const form = await req.formData();
      const images = form.getAll("image") as File[];
      captured.push({
        imageNames: images.map((f) => f.name),
        fidelity: (form.get("input_fidelity") as string | null) ?? null,
        promptField: (form.get("prompt") as string | null) ?? null,
      });
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { server, captured };
}

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "multi-ref-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function makeRef(name: string): Promise<string> {
  const p = join(workDir, name);
  await writeFile(p, TINY_PNG_BUF);
  return p;
}

async function runScript(args: string[], extraEnv: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", SCRIPT, ...args],
    env: {
      ...process.env,
      AZURE_API_KEY: "fake",
      IMAGE_GEN_SEMA_DIR: join(workDir, "sema"),
      IMAGE_GEN_MIN_INTERVAL_MS: "0",
      SKIP_PNG_COMPRESS: "1",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { status: exitCode, stderr };
}

describe("multi-ref multipart body", () => {
  it("3 张 --ref → 3 个 image 字段，filename = basename，顺序 = 输入顺序", async () => {
    const { server, captured } = startCapture();
    const editsEndpoint = `http://localhost:${server.port}/edits`;
    const out = join(workDir, "out.png");
    try {
      const r1 = await makeRef("ref-a.png");
      const r2 = await makeRef("ref-b.png");
      const r3 = await makeRef("ref-c.png");
      const res = await runScript(
        ["--prompt", "p", "--output", out, "--ref", r1, "--ref", r2, "--ref", r3],
        {
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/generations`,
          AZURE_IMAGE_EDITS_ENDPOINT: editsEndpoint,
        },
      );
      expect(res.status).toBe(0);
      expect(captured.length).toBe(1);
      expect(captured[0].imageNames).toEqual(["ref-a.png", "ref-b.png", "ref-c.png"]);
      expect(captured[0].promptField).toBe("p");
      expect(existsSync(out)).toBe(true);
    } finally {
      server.stop(true);
    }
  }, TIMEOUT_MS);

  it("默认带 input_fidelity=high", async () => {
    const { server, captured } = startCapture();
    const out = join(workDir, "out.png");
    try {
      const r1 = await makeRef("only.png");
      const res = await runScript(
        ["--prompt", "p", "--output", out, "--ref", r1],
        {
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/generations`,
          AZURE_IMAGE_EDITS_ENDPOINT: `http://localhost:${server.port}/edits`,
        },
      );
      expect(res.status).toBe(0);
      expect(captured.length).toBe(1);
      expect(captured[0].fidelity).toBe("high");
    } finally {
      server.stop(true);
    }
  }, TIMEOUT_MS);

  it("IMAGE_GEN_INPUT_FIDELITY=off → form 不含 input_fidelity 字段", async () => {
    const { server, captured } = startCapture();
    const out = join(workDir, "out.png");
    try {
      const r1 = await makeRef("only.png");
      const res = await runScript(
        ["--prompt", "p", "--output", out, "--ref", r1],
        {
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/generations`,
          AZURE_IMAGE_EDITS_ENDPOINT: `http://localhost:${server.port}/edits`,
          IMAGE_GEN_INPUT_FIDELITY: "off",
        },
      );
      expect(res.status).toBe(0);
      expect(captured.length).toBe(1);
      expect(captured[0].fidelity).toBeNull();
    } finally {
      server.stop(true);
    }
  }, TIMEOUT_MS);

  it("IMAGE_GEN_INPUT_FIDELITY=low → form 字段值 = low", async () => {
    const { server, captured } = startCapture();
    const out = join(workDir, "out.png");
    try {
      const r1 = await makeRef("only.png");
      const res = await runScript(
        ["--prompt", "p", "--output", out, "--ref", r1],
        {
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/generations`,
          AZURE_IMAGE_EDITS_ENDPOINT: `http://localhost:${server.port}/edits`,
          IMAGE_GEN_INPUT_FIDELITY: "low",
        },
      );
      expect(res.status).toBe(0);
      expect(captured.length).toBe(1);
      expect(captured[0].fidelity).toBe("low");
    } finally {
      server.stop(true);
    }
  }, TIMEOUT_MS);

  it("非法 IMAGE_GEN_INPUT_FIDELITY 立即 die", async () => {
    const { server } = startCapture();
    const out = join(workDir, "out.png");
    try {
      const r1 = await makeRef("only.png");
      const res = await runScript(
        ["--prompt", "p", "--output", out, "--ref", r1],
        {
          AZURE_IMAGE_ENDPOINT: `http://localhost:${server.port}/generations`,
          AZURE_IMAGE_EDITS_ENDPOINT: `http://localhost:${server.port}/edits`,
          IMAGE_GEN_INPUT_FIDELITY: "HIGH",
        },
      );
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("IMAGE_GEN_INPUT_FIDELITY 必须是");
    } finally {
      server.stop(true);
    }
  }, TIMEOUT_MS);
});
