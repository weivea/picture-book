# Multi-Ref Image Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the 1-ref hard limit in `image-generation` to 6, default `scene-illustrator` to use all participants' portraits as refs, and add `input_fidelity=high` (with an env escape hatch) to improve cross-scene character consistency.

**Architecture:** Two skills, two layers. `image-generation` (low-level) stays a single-process CLI but its `/edits` path now appends N `image` fields (per Microsoft multipart docs) and an `input_fidelity` field; magic-byte + size validation lives in a small lib. `scene-illustrator` (high-level) decides which portraits become refs (default: all participants whose portrait file exists) and passes them as repeated `--ref` flags. CLI surface is fully backward compatible — single-ref callers (e.g. picture-book-creator) keep working unchanged.

**Tech Stack:** Bun + TypeScript. `bun:test` for unit tests. `Bun.serve` for HTTP mock servers in integration tests. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-05-13-multi-ref-image-design.md`

---

## File Map

**New files:**
- `.claude/skills/image-generation/scripts/lib/input-fidelity.ts` — parser for `IMAGE_GEN_INPUT_FIDELITY` env, default `"high"`
- `.claude/skills/image-generation/scripts/lib/ref-image.ts` — magic-byte mime detection + 50 MB size check
- `.claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts`
- `.claude/skills/image-generation/scripts/test/lib/ref-image.test.ts`
- `.claude/skills/image-generation/scripts/test/multi-ref-form.test.ts`
- `.claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts`

**Modified files:**
- `.claude/skills/image-generation/scripts/generate-image.ts` — lift ref limit, multi-image multipart, input_fidelity, magic+size validation, 4xx HINT, DEFAULT_ENDPOINT api-version bump
- `.claude/skills/image-generation/scripts/test/ref-mode.test.ts` — limit 1→6 expectations
- `.claude/skills/image-generation/SKILL.md`
- `.claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts` — `refPath: string|null` → `refPaths: string[]`
- `.claude/skills/scene-illustrator/scripts/illustrate-chapter.ts` — filter existing portraits, repeat `--ref`, `refsUsed: string[]` in meta
- `.claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts`
- `.claude/skills/scene-illustrator/SKILL.md`

---

## Task 1: Extract `input-fidelity.ts` parser (lib + test)

Pure env-parsing function. Default `"high"`, validates against the 4-value enum.

**Files:**
- Create: `.claude/skills/image-generation/scripts/lib/input-fidelity.ts`
- Create: `.claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { readInputFidelity } from "../../lib/input-fidelity";

const ORIG = process.env.IMAGE_GEN_INPUT_FIDELITY;
afterEach(() => {
  if (ORIG === undefined) delete process.env.IMAGE_GEN_INPUT_FIDELITY;
  else process.env.IMAGE_GEN_INPUT_FIDELITY = ORIG;
});

describe("readInputFidelity", () => {
  it("默认 high（env 未设）", () => {
    delete process.env.IMAGE_GEN_INPUT_FIDELITY;
    expect(readInputFidelity()).toBe("high");
  });
  it("空字符串视为未设 → high", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "";
    expect(readInputFidelity()).toBe("high");
  });
  it("low / auto / off / high 都允许", () => {
    for (const v of ["low", "auto", "off", "high"] as const) {
      process.env.IMAGE_GEN_INPUT_FIDELITY = v;
      expect(readInputFidelity()).toBe(v);
    }
  });
  it("两侧空白被 trim", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "  low  ";
    expect(readInputFidelity()).toBe("low");
  });
  it("非法值抛错（含原始值）", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "HIGH";
    expect(() => readInputFidelity()).toThrow(/IMAGE_GEN_INPUT_FIDELITY/);
    process.env.IMAGE_GEN_INPUT_FIDELITY = "medium";
    expect(() => readInputFidelity()).toThrow(/medium/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test .claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts
```

Expected: FAIL — `Cannot find module ../../lib/input-fidelity`.

- [ ] **Step 3: Implement the lib**

Create `.claude/skills/image-generation/scripts/lib/input-fidelity.ts`:

```ts
// .claude/skills/image-generation/scripts/lib/input-fidelity.ts
//
// Parser for IMAGE_GEN_INPUT_FIDELITY env. Returns one of "high"|"low"|"auto"|"off".
// Default = "high". Throws on invalid value (caller should die() on the message).

export type InputFidelity = "high" | "low" | "auto" | "off";

const ALLOWED = new Set<InputFidelity>(["high", "low", "auto", "off"]);

export function readInputFidelity(): InputFidelity {
  const raw = process.env.IMAGE_GEN_INPUT_FIDELITY;
  if (raw === undefined) return "high";
  const v = raw.trim();
  if (v === "") return "high";
  if (ALLOWED.has(v as InputFidelity)) return v as InputFidelity;
  throw new Error(
    `IMAGE_GEN_INPUT_FIDELITY 必须是 high|low|auto|off，收到 "${raw}"`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts
```

Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/image-generation/scripts/lib/input-fidelity.ts \
        .claude/skills/image-generation/scripts/test/lib/input-fidelity.test.ts
git commit -m "feat(image-generation): add IMAGE_GEN_INPUT_FIDELITY env parser"
```

---

## Task 2: Extract `ref-image.ts` (magic byte + size check)

Pure validation: detect `image/png` / `image/jpeg` by magic bytes, reject anything else; reject files > 50 MB. No I/O — caller passes a `Buffer` and a byte count.

**Files:**
- Create: `.claude/skills/image-generation/scripts/lib/ref-image.ts`
- Create: `.claude/skills/image-generation/scripts/test/lib/ref-image.test.ts`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/image-generation/scripts/test/lib/ref-image.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { detectRefMime, MAX_REF_BYTES } from "../../lib/ref-image";

describe("detectRefMime", () => {
  it("PNG magic → image/png", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectRefMime(buf)).toBe("image/png");
  });
  it("JPEG magic → image/jpeg", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectRefMime(buf)).toBe("image/jpeg");
  });
  it("ASCII 文本 → null", () => {
    expect(detectRefMime(Buffer.from("hello world"))).toBeNull();
  });
  it("空 buffer → null", () => {
    expect(detectRefMime(Buffer.from([]))).toBeNull();
  });
  it("仅 2 字节 PNG header → null（不足以确认）", () => {
    expect(detectRefMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("MAX_REF_BYTES", () => {
  it("= 50 MB", () => {
    expect(MAX_REF_BYTES).toBe(50 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test .claude/skills/image-generation/scripts/test/lib/ref-image.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lib**

Create `.claude/skills/image-generation/scripts/lib/ref-image.ts`:

```ts
// .claude/skills/image-generation/scripts/lib/ref-image.ts
//
// Reference-image validation helpers for /edits multipart upload.
// Detect mime by magic bytes; reject anything that isn't PNG or JPEG.
// Size cap (50 MB) matches Azure server-side limit so we fail fast.

export type RefMime = "image/png" | "image/jpeg";

export const MAX_REF_BYTES = 50 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

function startsWith(buf: Buffer, magic: readonly number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

export function detectRefMime(buf: Buffer): RefMime | null {
  if (startsWith(buf, PNG_MAGIC)) return "image/png";
  if (startsWith(buf, JPEG_MAGIC)) return "image/jpeg";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/image-generation/scripts/test/lib/ref-image.test.ts
```

Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/image-generation/scripts/lib/ref-image.ts \
        .claude/skills/image-generation/scripts/test/lib/ref-image.test.ts
git commit -m "feat(image-generation): add ref-image magic-byte + 50MB validation"
```

---

## Task 3: Lift `--ref` limit from 1 to 6 in generate-image.ts

Update the strict `> 1` die guard to `> 6`. Keep CLI shape (`multiple: true`). Don't touch multipart logic yet — that's Task 4.

**Files:**
- Modify: `.claude/skills/image-generation/scripts/test/ref-mode.test.ts`
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts:151-156`

- [ ] **Step 1: Update existing test cases (failing first)**

Replace `.claude/skills/image-generation/scripts/test/ref-mode.test.ts` entirely:

```ts
import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import { resolve } from "path";

const SCRIPT = resolve(
  ".claude/skills/image-generation/scripts/generate-image.ts"
);
const REF = resolve(
  ".claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png"
);

const FAKE_ENV = {
  AZURE_API_KEY: "fake",
  AZURE_IMAGE_ENDPOINT:
    "https://test.invalid/openai/deployments/x/images/generations?api-version=2024-02-01",
};

describe("--ref routing", () => {
  it("rejects --ref pointing to non-existent file", () => {
    const out = "/tmp/test-out-noref.png";
    const res = spawnSync(
      "bun",
      ["run", SCRIPT, "--prompt", "x", "--output", out, "--ref", "/no/such/file.png"],
      { encoding: "utf-8", env: { ...process.env, ...FAKE_ENV } }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--ref 文件不存在");
  });

  it("accepts up to 6 --ref values (parse-time)", () => {
    // 6 张 ref 通过参数校验 → 进入网络请求阶段（指向 invalid host → 失败）。
    // 我们只验证 stderr 不包含"超过上限"。
    const out = "/tmp/test-out-6ref.png";
    const args = ["run", SCRIPT, "--prompt", "x", "--output", out];
    for (let i = 0; i < 6; i++) args.push("--ref", REF);
    const res = spawnSync("bun", args, {
      encoding: "utf-8",
      env: {
        ...process.env,
        ...FAKE_ENV,
        IMAGE_GEN_SEMA_DIR: `/tmp/test-sema-6ref-${Date.now()}`,
        IMAGE_GEN_MIN_INTERVAL_MS: "0",
      },
    });
    expect(res.stderr).not.toContain("最多支持");
  });

  it("rejects 7 --ref values", () => {
    const out = "/tmp/test-out-7ref.png";
    const args = ["run", SCRIPT, "--prompt", "x", "--output", out];
    for (let i = 0; i < 7; i++) args.push("--ref", REF);
    const res = spawnSync("bun", args, {
      encoding: "utf-8",
      env: { ...process.env, ...FAKE_ENV },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--ref 当前最多支持 6 张");
  });
});
```

- [ ] **Step 2: Run test to verify the new "rejects 7" / "accepts 6" expectations fail**

```bash
bun test .claude/skills/image-generation/scripts/test/ref-mode.test.ts
```

Expected: FAIL — current code says "--ref 当前仅支持 1 张" (would still trigger on 6 and 7), and the message string doesn't say "6". Both new tests fail.

- [ ] **Step 3: Update the limit guard in generate-image.ts**

Edit `.claude/skills/image-generation/scripts/generate-image.ts`, find and replace:

```ts
if (refPaths.length > 1) {
  die(
    `--ref 当前仅支持 1 张参考图（收到 ${refPaths.length} 张）。其他参考角色请在 prompt 文本中描述。` +
      `如未来需要多 ref，请在脚本扩展 callEditsApi 后放开此限制。`,
  );
}
```

With:

```ts
const MAX_REFS = 6;
if (refPaths.length > MAX_REFS) {
  die(
    `--ref 当前最多支持 ${MAX_REFS} 张参考图（收到 ${refPaths.length} 张）。` +
      `Azure /edits multipart 接受重复 image 字段，但本 skill 上限设为 ${MAX_REFS}。`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/image-generation/scripts/test/ref-mode.test.ts
```

Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/image-generation/scripts/test/ref-mode.test.ts \
        .claude/skills/image-generation/scripts/generate-image.ts
git commit -m "feat(image-generation): lift --ref hard limit from 1 to 6"
```

---

## Task 4: Multi-image multipart + `input_fidelity` in `callEditsApi`

Refactor `callEditsApi(refPath: string)` → `callEditsApi(refPaths: string[])`. Append N `image` fields with detected mime + basename; append `input_fidelity` unless `=off`. Use Task 2's `detectRefMime` and Task 1's `readInputFidelity`.

**Files:**
- Create: `.claude/skills/image-generation/scripts/test/multi-ref-form.test.ts`
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts:298-338`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/image-generation/scripts/test/multi-ref-form.test.ts`:

```ts
// 验证：3 张 --ref 时 multipart body 含 3 个 name="image" 字段，
// 文件名为各路径的 basename，顺序与 CLI 传入顺序一致；
// 默认带 input_fidelity=high；off 时不带。

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const SCRIPT = resolve(".claude/skills/image-generation/scripts/generate-image.ts");

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
const TINY_PNG_BUF = Buffer.from(TINY_PNG_B64, "base64");

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
beforeEach(async () => {
  workDir = `/tmp/test-multi-ref-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await mkdir(workDir, { recursive: true });
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
  }, 30_000);

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
      expect(captured[0].fidelity).toBe("high");
    } finally {
      server.stop(true);
    }
  }, 30_000);

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
      expect(captured[0].fidelity).toBeNull();
    } finally {
      server.stop(true);
    }
  }, 30_000);

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
      expect(captured[0].fidelity).toBe("low");
    } finally {
      server.stop(true);
    }
  }, 30_000);

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
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts
```

Expected: FAIL — current `callEditsApi` only takes 1 ref, hardcodes filename `"ref.png"`, never sends `input_fidelity`, doesn't read the env.

- [ ] **Step 3: Refactor `callEditsApi` in generate-image.ts**

Edit `.claude/skills/image-generation/scripts/generate-image.ts`. First add imports near the top (alongside the existing `compress-png` and `concurrency-gate` imports):

```ts
import { detectRefMime, MAX_REF_BYTES } from "./lib/ref-image";
import { readInputFidelity } from "./lib/input-fidelity";
```

Also add `stat` to the existing `node:fs/promises` import line — change:

```ts
import { mkdir, readFile } from "fs/promises";
```

To:

```ts
import { mkdir, readFile, stat } from "fs/promises";
```

Replace the `callEditsApi` function (currently around lines 298–321) with:

```ts
async function callEditsApi(refPaths: string[]): Promise<Buffer> {
  const editsEndpoint = deriveEditsEndpoint();

  // 预读 + 校验所有 ref（先全部读完再发送，便于在网络前 fail-fast）。
  const refs: { name: string; buf: Buffer; mime: "image/png" | "image/jpeg" }[] = [];
  for (const p of refPaths) {
    const st = await stat(p);
    if (st.size > MAX_REF_BYTES) {
      die(
        `--ref ${p} 大小 ${(st.size / (1024 * 1024)).toFixed(1)} MB 超过 50 MB 单文件上限`,
      );
    }
    const buf = await readFile(p);
    const mime = detectRefMime(buf);
    if (!mime) {
      die(`--ref ${p} 不是合法 PNG/JPG（magic 字节失败）`);
    }
    const base = p.split("/").pop() ?? "ref.png";
    refs.push({ name: base, buf, mime });
  }

  // input_fidelity：env 控制；非法值在此处 throw → die
  let fidelity: ReturnType<typeof readInputFidelity>;
  try {
    fidelity = readInputFidelity();
  } catch (err) {
    die((err as Error).message);
  }

  const res = await fetchWithRetry(
    () => {
      // form 必须每次重建，因为部分 server 会消费 stream
      const form = new FormData();
      for (const r of refs) {
        form.append("image", new Blob([r.buf], { type: r.mime }), r.name);
      }
      form.append("prompt", prompt);
      form.append("size", apiSize);
      form.append("quality", values.quality!);
      form.append("output_format", "png");
      form.append("n", "1");
      if (fidelity !== "off") {
        form.append("input_fidelity", fidelity);
      }
      return fetch(editsEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` }, // 不要设 Content-Type，让 fetch 自动加 boundary
        body: form,
      });
    },
    "edits",
  );
  return parseImageResponse(res);
}
```

Then update the call site (around line 334):

```ts
if (refPaths.length === 0) {
  buffer = await callGenerateApi();
} else {
  buffer = await callEditsApi(refPaths);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts
```

Expected: PASS, 5 tests green.

- [ ] **Step 5: Run all image-generation tests to confirm no regression**

```bash
bun test .claude/skills/image-generation/scripts/test/
```

Expected: PASS — all existing retry / concurrency / compress / ref-mode tests still green.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/image-generation/scripts/generate-image.ts \
        .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts
git commit -m "feat(image-generation): multipart multi-image + input_fidelity in /edits"
```

---

## Task 5: Add 4xx HINT for `input_fidelity` rejection

When the API returns 4xx and the body mentions `input_fidelity`, append a one-line HINT pointing to the env escape hatch.

**Files:**
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts` (parseImageResponse)
- Add test inline in `.claude/skills/image-generation/scripts/test/multi-ref-form.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `.claude/skills/image-generation/scripts/test/multi-ref-form.test.ts` (inside the existing `describe`):

```ts
  it("4xx 响应 body 含 input_fidelity → stderr 出现 HINT 行", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BadRequest",
              message: "Unknown parameter: input_fidelity",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    });
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
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("HINT");
      expect(res.stderr).toContain("IMAGE_GEN_INPUT_FIDELITY=off");
    } finally {
      server.stop(true);
    }
  }, 30_000);
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
bun test .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts -t "HINT"
```

Expected: FAIL — current `parseImageResponse` just dies with the raw body, no HINT.

- [ ] **Step 3: Add the HINT branch in `parseImageResponse`**

Edit `.claude/skills/image-generation/scripts/generate-image.ts`, find:

```ts
async function parseImageResponse(res: Response): Promise<Buffer> {
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    die(`API 返回 ${res.status} ${res.statusText}\n${text}`);
  }
```

Replace with:

```ts
async function parseImageResponse(res: Response): Promise<Buffer> {
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    let hint = "";
    if (
      res.status >= 400 &&
      res.status < 500 &&
      text.includes("input_fidelity")
    ) {
      hint =
        "\n[generate-image] HINT: 当前部署可能不识别 input_fidelity。" +
        "在 .env 设置 IMAGE_GEN_INPUT_FIDELITY=off 重试。";
    }
    die(`API 返回 ${res.status} ${res.statusText}\n${text}${hint}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts
```

Expected: PASS — all 6 tests green (5 prior + new HINT).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/image-generation/scripts/generate-image.ts \
        .claude/skills/image-generation/scripts/test/multi-ref-form.test.ts
git commit -m "feat(image-generation): hint when 4xx mentions input_fidelity"
```

---

## Task 6: Update `image-generation/SKILL.md` + bump DEFAULT_ENDPOINT api-version

Documentation-only changes (plus the placeholder URL constant). User-supplied endpoints are not affected.

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md`
- Modify: `.claude/skills/image-generation/scripts/generate-image.ts:35-36`

- [ ] **Step 1: Update SKILL.md — Reference-image Mode section**

In `.claude/skills/image-generation/SKILL.md`, replace the block under `## Reference-image Mode`:

```md
## Reference-image Mode（image-to-image）

传入 `--ref <path>` 时切到 Azure gpt-image-2 的 `/edits` 端点，把参考图作为 multipart body 的 `image` 字段。
用于"角色立绘 + prompt 描述场景"实现跨场景视觉一致性（scene-illustrator 调用范式）。

`AZURE_IMAGE_EDITS_ENDPOINT` 见上面 Prerequisites 表。

**当前限制：**
- **只接受 1 张 `--ref`**，传多张直接 `exit 1`（其他参考角色请在 prompt 文本中描述）
- 不支持 `--mask`（区域编辑场景目前不需要）
```

With:

```md
## Reference-image Mode（image-to-image）

传入 `--ref <path>` 时切到 Azure 的 `/edits` 端点，按 Microsoft 文档把每张参考图作为
**重复的 `image` multipart 字段**（不是 `image[]`，不是 JSON 数组）。
用于"角色立绘 + prompt 描述场景"实现跨场景视觉一致性（scene-illustrator 调用范式）。

`AZURE_IMAGE_EDITS_ENDPOINT` 见上面 Prerequisites 表。

**限制：**
- 接受 0..6 张 `--ref`，传 ≥ 7 张直接 `exit 1`
- 每张 ref 必须是 PNG 或 JPEG（按 magic 字节判定），单文件 ≤ 50 MB
- 不支持 `--mask`（区域编辑场景目前不需要）
- `input_fidelity` 默认 `high`，由 `IMAGE_GEN_INPUT_FIDELITY` env 控制；
  设为 `off` 完全不发送该字段（用于不识别该字段的部署）
```

- [ ] **Step 2: Update SKILL.md — Prerequisites env table**

In the env table under `## Prerequisites`, add a row after `SKIP_PNG_COMPRESS`:

```md
| `IMAGE_GEN_INPUT_FIDELITY` | ✗ | `high`（默认）\| `low` \| `auto` \| `off`。控制 `/edits` 请求里的 `input_fidelity` 字段；`off` = 完全不发送该字段（用于不识别该字段的部署） |
```

Also remove the obsolete line in the env table under `## 速率上限（自动）` if present — leave it; that table is unrelated.

- [ ] **Step 3: Update SKILL.md — Quick Reference**

Replace the `--ref` line in the bash code fence under `## Quick Reference`:

```md
  [--ref <path>]        # 传入则走 /edits 端点做 image-to-image。仅支持 1 张
```

With:

```md
  [--ref <path>]        # 可重复 0..6 次。传入则走 /edits 端点（image-to-image）
```

- [ ] **Step 4: Update SKILL.md — Behavior on Error table**

In the table under `## Behavior on Error`, replace the row:

```md
| `--ref 当前仅支持 1 张` | 传了 ≥2 张 `--ref` | 调用方修复参数，不要重试 |
```

With (and add 3 new rows):

```md
| `--ref 当前最多支持 6 张参考图（收到 N 张）` | 传了 ≥ 7 张 `--ref` | 调用方修复参数，不要重试 |
| `--ref ... 不是合法 PNG/JPG（magic 字节失败）` | ref 文件不是 PNG/JPEG | 调用方换文件或转码 |
| `--ref ... 大小 X MB 超过 50 MB 单文件上限` | 单 ref > 50 MB | 调用方压缩或换图 |
| `IMAGE_GEN_INPUT_FIDELITY 必须是 high\|low\|auto\|off` | env 取了非法值 | 修 env |
| `HINT: ... IMAGE_GEN_INPUT_FIDELITY=off` | API 返回 4xx 且 body 含 `input_fidelity` | 在 .env 设置 `IMAGE_GEN_INPUT_FIDELITY=off` 后重试 |
```

- [ ] **Step 5: Update SKILL.md — Common Mistakes**

Replace the bullet:

```md
- **传多张 `--ref`**：会 exit 1（语义陷阱：旧版本会静默丢弃，新版本严格 die）
```

With:

```md
- **传 ≥ 7 张 `--ref`**：会 exit 1。本 skill 上限 6
- **ref 文件是 WebP / GIF / SVG**：仅 PNG / JPEG 接受，magic 字节失败立即 exit 1
```

- [ ] **Step 6: Bump DEFAULT_ENDPOINT api-version in script**

Edit `.claude/skills/image-generation/scripts/generate-image.ts:35-36`:

```ts
const DEFAULT_ENDPOINT =
  "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01";
```

Replace with:

```ts
const DEFAULT_ENDPOINT =
  "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2025-04-01-preview";
```

> Note: this only affects the placeholder error message ("DEFAULT_ENDPOINT 仅是占位符") — users with their own `AZURE_IMAGE_ENDPOINT` are unaffected. `2025-04-01-preview` is the version in the Microsoft Learn examples for multi-image edit.

- [ ] **Step 7: Sanity-run the full image-generation suite**

```bash
bun test .claude/skills/image-generation/scripts/test/
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/image-generation/SKILL.md \
        .claude/skills/image-generation/scripts/generate-image.ts
git commit -m "docs(image-generation): document multi-ref + input_fidelity, bump default api-version"
```

---

## Task 7: Refactor `scene-prompt-builder` (`refPath` → `refPaths`)

Pure type/return-shape change. `BuildResult.refPath: string|null` → `BuildResult.refPaths: string[]`. Returns one path per participant; **does not** check file existence (that's illustrate-chapter's job — keeps this function I/O-free, matching its existing pattern).

**Files:**
- Modify: `.claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts`
- Modify: `.claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts`

- [ ] **Step 1: Update existing tests (failing first)**

Edit `.claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts`. Replace the first test body (lines 19–39 area):

```ts
  it("style + mood + anchors + body 顺序正确", () => {
    const scene: Scene = {
      index: 0,
      title: "门后之物",
      location: "北郊废墟",
      mood: "tense",
      participants: ["林晚", "沈渊"],
      body: "林晚走入废墟，听见沈渊的低语。",
      startLine: 5,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(prompt.startsWith("Webtoon-style anime illustration")).toBe(true);
    expect(prompt).toContain("tense atmosphere");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("grey beard");
    expect(prompt.endsWith("no watermark, no text, no signature")).toBe(true);
    expect(refPath).toBe("/tmp/portraits/林晚.png");
  });
```

With:

```ts
  it("style + mood + anchors + body 顺序正确，refPaths = 全部 participants", () => {
    const scene: Scene = {
      index: 0,
      title: "门后之物",
      location: "北郊废墟",
      mood: "tense",
      participants: ["林晚", "沈渊"],
      body: "林晚走入废墟，听见沈渊的低语。",
      startLine: 5,
    };
    const { prompt, refPaths } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(prompt.startsWith("Webtoon-style anime illustration")).toBe(true);
    expect(prompt).toContain("tense atmosphere");
    expect(prompt).toContain("silver hair");
    expect(prompt).toContain("grey beard");
    expect(prompt.endsWith("no watermark, no text, no signature")).toBe(true);
    expect(refPaths).toEqual([
      "/tmp/portraits/林晚.png",
      "/tmp/portraits/沈渊.png",
    ]);
  });
```

Replace the second test body:

```ts
  it("participants=[] 时无 ref", () => {
    const scene: Scene = {
      index: 0,
      title: "废墟",
      location: "北郊废墟",
      mood: "lonely",
      participants: [],
      body: "雪落在断墙上。",
      startLine: 1,
    };
    const { prompt, refPath } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(refPath).toBeNull();
    expect(prompt).toContain("lonely atmosphere");
    expect(prompt).not.toContain("silver hair");
  });
```

With:

```ts
  it("participants=[] 时 refPaths 为空数组", () => {
    const scene: Scene = {
      index: 0,
      title: "废墟",
      location: "北郊废墟",
      mood: "lonely",
      participants: [],
      body: "雪落在断墙上。",
      startLine: 1,
    };
    const { prompt, refPaths } = buildScenePrompt(scene, anchors, style, {
      portraitsDir: "/tmp/portraits",
    });
    expect(refPaths).toEqual([]);
    expect(prompt).toContain("lonely atmosphere");
    expect(prompt).not.toContain("silver hair");
  });
```

(The other two tests — "未知 participant 报错" and "超长 body 截到 80 字" — don't reference `refPath`, leave them.)

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
```

Expected: FAIL — `refPaths` doesn't exist on `BuildResult`.

- [ ] **Step 3: Refactor scene-prompt-builder.ts**

Edit `.claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts`. Replace the `BuildResult` interface and the bottom of `buildScenePrompt`:

```ts
export interface BuildResult {
  prompt: string;
  refPath: string | null; // 第一个 participant 的立绘路径
}
```

With:

```ts
export interface BuildResult {
  prompt: string;
  /** 每个 participant 一条路径（不检查文件是否存在；调用方自行 filter）。 */
  refPaths: string[];
}
```

Then replace the `return` statement at the end of `buildScenePrompt`:

```ts
  const prompt = parts.filter(Boolean).join(", ");
  const refPath = scene.participants.length
    ? join(opts.portraitsDir, `${scene.participants[0]}.png`)
    : null;
  return { prompt, refPath };
}
```

With:

```ts
  const prompt = parts.filter(Boolean).join(", ");
  const refPaths = scene.participants.map((name) =>
    join(opts.portraitsDir, `${name}.png`),
  );
  return { prompt, refPaths };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
```

Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts \
        .claude/skills/scene-illustrator/scripts/test/scene-prompt-builder.test.ts
git commit -m "refactor(scene-illustrator): refPath -> refPaths in scene-prompt-builder"
```

---

## Task 8: Update `illustrate-chapter.ts` — loop refs, filter missing, write `refsUsed[]`

Consumes Task 7's new `refPaths` shape. Filters by `existsSync` so missing portraits are silently skipped (per spec §2.3 — model falls back to prompt description). Writes `refsUsed: string[]` to meta JSON.

**Files:**
- Modify: `.claude/skills/scene-illustrator/scripts/illustrate-chapter.ts:138-171`
- Create: `.claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `.claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts`:

```ts
// 验证 illustrate-chapter.ts 把所有存在 portrait 的 participants 通过多次 --ref 传给 image-generation。
// 通过 stub image-generation 脚本（PATH 注入一个假 bun 脚本）来捕获参数。

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, ".claude/skills/scene-illustrator/scripts/illustrate-chapter.ts");

let workDir: string;
let captureDir: string;

const FAKE_GEN_SCRIPT = `#!/usr/bin/env bun
// 假 image-generation：把所有 argv 写入 captureDir/<output basename>.args.json，
// 并把一张 1x1 透明 PNG 写到 --output。
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
const args = process.argv.slice(2);
const outIdx = args.indexOf("--output");
const out = args[outIdx + 1];
await writeFile(out, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
));
await writeFile(
  process.env.CAPTURE_DIR + "/" + basename(out) + ".args.json",
  JSON.stringify(args, null, 2)
);
`;

beforeEach(async () => {
  workDir = `/tmp/test-illustrate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  captureDir = join(workDir, "capture");
  await mkdir(captureDir, { recursive: true });

  // 写 characters.md / style.md / chapters/ch_01.md / portraits
  await writeFile(
    join(workDir, "style.md"),
    "# promptPrefix\nWebtoon-style anime illustration\n# negative\nno watermark\n",
  );
  await writeFile(
    join(workDir, "characters.md"),
    "## A\n- appearance: silver hair, dark green robe, scar\n## B\n- appearance: tall man with grey beard, faded blue robe\n## C\n- appearance: short blonde girl, red dress, ribbon\n",
  );
  await mkdir(join(workDir, "chapters"), { recursive: true });
  await writeFile(
    join(workDir, "chapters", "ch_01.md"),
    `# Chapter 1\n\n<!--SCENE: title=\"开场\"; location=\"街角\"; mood=\"calm\"; participants=\"A,B,C\"-->\n三人对视。\n<!--/SCENE-->\n`,
  );
  await mkdir(join(workDir, "portraits"), { recursive: true });
  // 只为 A 和 C 准备 portrait；B 缺失 → 应被 filter 掉
  for (const n of ["A", "C"]) {
    await writeFile(
      join(workDir, "portraits", `${n}.png`),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(
      join(workDir, "portraits", `${n}.meta.json`),
      JSON.stringify({ name: n }),
    );
  }
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runIllustrate(): Promise<{ status: number; stderr: string }> {
  // 通过 PATH 注入 stub bun。但 illustrate-chapter 自己也是 bun 脚本，会跟着 stub 起飞 → 不行。
  // 改用环境变量 + spawn 替换：直接 monkey-patch 子进程命令。
  //
  // 简化策略：让 illustrate-chapter 调用 spawn("bun", ["run", path-to-image-gen, ...]).
  // 我们把 image-generation 的脚本路径替换成 stub。环境变量 IMAGE_GEN_SCRIPT 没在源码里——
  // 所以需要用另一个办法：用 mock-bin 目录把 image-generation 路径替换。
  //
  // 最干净：依赖 illustrate-chapter 的实现细节，stub 通过 PATH 提供一个假 bun 二进制是不行的。
  // 因此本测试要求 illustrate-chapter 支持环境变量 IMAGE_GEN_SCRIPT 来覆盖默认脚本路径。
  // 见 Task 8 Step 3 的实现。
  const stub = join(workDir, "fake-image-gen.ts");
  await writeFile(stub, FAKE_GEN_SCRIPT);

  const proc = Bun.spawn({
    cmd: ["bun", "run", SCRIPT, "--output-dir", workDir, "--chapter", "1"],
    env: {
      ...process.env,
      CAPTURE_DIR: captureDir,
      IMAGE_GEN_SCRIPT: stub,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const status = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { status, stderr };
}

describe("illustrate-chapter ref passing", () => {
  it("scene 有 3 participants（B portrait 缺失）→ image-gen 收到 2 个 --ref，meta.refsUsed.length=2", async () => {
    const res = await runIllustrate();
    expect(res.status).toBe(0);

    // capture: scene_01.png.args.json 应该存在
    const argsPath = join(captureDir, "scene_01.png.args.json");
    const argsJson = JSON.parse(await readFile(argsPath, "utf8")) as string[];
    const refIdxs = argsJson.reduce<number[]>((acc, v, i) => {
      if (v === "--ref") acc.push(i);
      return acc;
    }, []);
    expect(refIdxs.length).toBe(2);
    const refValues = refIdxs.map((i) => argsJson[i + 1]);
    expect(refValues).toEqual([
      join(workDir, "portraits", "A.png"),
      join(workDir, "portraits", "C.png"),
    ]);

    // meta.json
    const meta = JSON.parse(
      await readFile(join(workDir, "illustrations", "ch_01", "scene_01.meta.json"), "utf8"),
    );
    expect(meta.refsUsed).toEqual([
      join(workDir, "portraits", "A.png"),
      join(workDir, "portraits", "C.png"),
    ]);
    // 旧字段名不再写出
    expect(meta.refUsed).toBeUndefined();
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test .claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts
```

Expected: FAIL — `IMAGE_GEN_SCRIPT` env not honored, default script gets called and dies on AZURE_API_KEY (or hits the real upstream).

- [ ] **Step 3: Update illustrate-chapter.ts**

Edit `.claude/skills/scene-illustrator/scripts/illustrate-chapter.ts`. First, near the top imports, add:

```ts
import { existsSync } from "node:fs";
```

Then replace the `runImageGen` function (around line 69):

```ts
async function runImageGen(args: string[]): Promise<void> {
  await new Promise<void>((res, rej) => {
    const cp = spawn("bun", ["run", ".claude/skills/image-generation/scripts/generate-image.ts", ...args], {
      stdio: "inherit",
    });
    cp.on("exit", (code) => (code === 0 ? res() : rej(new Error(`image-gen exit ${code}`))));
  });
}
```

With:

```ts
const IMAGE_GEN_SCRIPT =
  process.env.IMAGE_GEN_SCRIPT ??
  ".claude/skills/image-generation/scripts/generate-image.ts";

async function runImageGen(args: string[]): Promise<void> {
  await new Promise<void>((res, rej) => {
    const cp = spawn("bun", ["run", IMAGE_GEN_SCRIPT, ...args], {
      stdio: "inherit",
    });
    cp.on("exit", (code) => (code === 0 ? res() : rej(new Error(`image-gen exit ${code}`))));
  });
}
```

Then replace the scene loop (lines 138–171, the `await Promise.all(targetScenes.map(...))` block) with:

```ts
// 并行派发 scenes：image-generation 内部 rate-gate 自动节流；fail-fast 同 portraits。
await Promise.all(
  targetScenes.map(async (scene) => {
    const { prompt, refPaths } = buildScenePrompt(scene, anchors, style, { portraitsDir });
    // 过滤掉文件不存在的 ref（让模型靠 prompt 描述兜底，不 fail）
    const existingRefs = refPaths.filter((p) => existsSync(p));
    const sceneIdx = String(scene.index + 1).padStart(2, "0");
    const out = join(illustrationsDir, `scene_${sceneIdx}.png`);
    const args = [
      "--prompt", prompt,
      "--output", out,
      "--ratio", "1:1",
      "--size", "1024x1024",
      "--quality", "high",
    ];
    for (const r of existingRefs) {
      args.push("--ref", r);
    }
    await runImageGen(args);
    await writeFile(
      join(illustrationsDir, `scene_${sceneIdx}.meta.json`),
      JSON.stringify(
        {
          sceneIndex: scene.index,
          title: scene.title,
          mood: scene.mood,
          participants: scene.participants,
          prompt,
          refsUsed: existingRefs,
          recheck: null,
        },
        null,
        2,
      ),
    );
    console.log(`✓ scene ${sceneIdx}: ${scene.title} (${existingRefs.length} refs)`);
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test .claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts
```

Expected: PASS, 1 test green.

- [ ] **Step 5: Run all scene-illustrator tests**

```bash
bun test .claude/skills/scene-illustrator/scripts/test/
```

Expected: all green (4 prompt-builder tests + 1 illustrate-chapter test + existing anchor + portrait-manager tests).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts \
        .claude/skills/scene-illustrator/scripts/test/illustrate-chapter.refs.test.ts
git commit -m "feat(scene-illustrator): pass all participants' portraits as refs (skip missing)"
```

---

## Task 9: Update `scene-illustrator/SKILL.md`

Documentation only.

**Files:**
- Modify: `.claude/skills/scene-illustrator/SKILL.md`

- [ ] **Step 1: Update the meta.json schema in Outputs**

In `.claude/skills/scene-illustrator/SKILL.md`, replace this block under `## Outputs`:

```md
│   ├── scene_01.meta.json    # { sceneIndex, prompt, refsUsed, recheck }
```

(It already says `refsUsed`. Leave as-is — the existing doc text was aspirationally accurate and the new code matches.)

- [ ] **Step 2: Update the scenes Phase Step 1 description**

Replace this bullet under `#### Step 1：解析章节 SCENE 块`:

```md
   - 拼 prompt（见 scene-prompt-builder.ts）
   - 收集 refs：`scene.participants` 中每人的 portrait 路径
   - 调 image-generation，**首位 participant 的 portrait 作为 `--ref`**（image-to-image 锚定）
   - 落盘 PNG + meta.json
```

With:

```md
   - 拼 prompt（见 scene-prompt-builder.ts）
   - 收集 refs：`scene.participants` 中每人的 portrait 路径
   - 文件不存在的 portrait 自动 skip（让模型靠 prompt 描述兜底）
   - 调 image-generation，**所有存在 portrait 的 participants 都作为 `--ref` 多次传入**
     （image-to-image 多角色锚定，最多 6 张 — image-generation 内部上限）
   - 落盘 PNG + meta.json（`refsUsed` 为本张图实际使用的 ref 路径数组）
```

- [ ] **Step 3: Update Quality bar bullet**

The existing bullet `- [ ] 每张 scene 图：refsUsed.length ≥ 1（除非 participants=none）` already matches the new behavior — but it understates. Replace with:

```md
- [ ] 每张 scene 图：refsUsed.length = 存在 portrait 的 participants 数量（0 表示 participants=空 或 portraits 全缺失）
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/scene-illustrator/SKILL.md
git commit -m "docs(scene-illustrator): document multi-ref participant passing"
```

---

## Task 10: Final verification + smoke check guidance

Per `superpowers:verification-before-completion`: prove it works end-to-end before claiming done.

**Files:** none (read-only verification)

- [ ] **Step 1: Run full test suite**

```bash
bun test .claude/skills/image-generation/scripts/test/ \
         .claude/skills/scene-illustrator/scripts/test/
```

Expected output structure:
```
 ... pass
 ... pass
 ...
N pass
0 fail
```

Paste the actual exit summary into the conversation. If anything fails, **stop and debug** — do not claim completion.

- [ ] **Step 2: TypeScript check (best-effort)**

```bash
bun --bun tsc --noEmit -p . 2>&1 | head -50
```

Expected: no new errors related to `refPath`, `refPaths`, `input_fidelity`, or `MAX_REFS`. (Pre-existing errors elsewhere are out of scope.)

- [ ] **Step 3: Real-Azure smoke check — single ref baseline (regression)**

This requires a working `.env` with `AZURE_API_KEY` and `AZURE_IMAGE_ENDPOINT`. **Ask the user to run** these and paste output:

```bash
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "A red apple on a wooden table, photographic" \
  --output /tmp/smoke-1ref.png \
  --ref .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png
ls -la /tmp/smoke-1ref.png
```

Expected: `OK /tmp/smoke-1ref.png ...` line + non-empty file.

- [ ] **Step 4: Real-Azure smoke check — 3 refs (the new feature)**

Ask the user to run (after Step 3):

```bash
cp .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png /tmp/r1.png
cp .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png /tmp/r2.png
cp .claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png /tmp/r3.png
bun run .claude/skills/image-generation/scripts/generate-image.ts \
  --prompt "Three people standing under a cherry blossom tree, illustration" \
  --output /tmp/smoke-3ref.png \
  --ref /tmp/r1.png --ref /tmp/r2.png --ref /tmp/r3.png
ls -la /tmp/smoke-3ref.png
```

Expected outcomes:
- **PASS:** exit 0 + non-empty PNG → multi-image works on this gpt-image-2 deployment.
- **FAIL with "input_fidelity" in stderr + HINT line:** deployment doesn't support `input_fidelity`. User runs:
  ```bash
  IMAGE_GEN_INPUT_FIDELITY=off bun run .claude/skills/image-generation/scripts/generate-image.ts \
    --prompt "Three people..." --output /tmp/smoke-3ref.png \
    --ref /tmp/r1.png --ref /tmp/r2.png --ref /tmp/r3.png
  ```
  Expected: success. Then add to `.env`: `IMAGE_GEN_INPUT_FIDELITY=off`.
- **FAIL with multipart-related 4xx:** deployment doesn't accept multi-image. Document in `image-generation/SKILL.md` Known Limitations and consider gating behind env later.

- [ ] **Step 5: Commit any doc updates from smoke discoveries (if any)**

If Step 4 surfaced limitations, append a "Known limitations on gpt-image-2 deployment" note to `image-generation/SKILL.md` under "Reference-image Mode" and commit:

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "docs(image-generation): note gpt-image-2 multi-ref behavior observed in smoke check"
```

(Skip this step entirely if Step 4 succeeded cleanly.)

- [ ] **Step 6: Report completion**

Post a single message containing:

1. The line counts from `bun test` (total tests, passes, fails)
2. The result of each smoke check (1-ref, 3-ref, and 3-ref with `IMAGE_GEN_INPUT_FIDELITY=off` if applicable)
3. Git log showing the commits added (last ~10):
   ```bash
   git log --oneline -10
   ```

Do **not** claim "done" until all unit tests are green AND at least one real-Azure ref-mode call succeeded (1-ref or 3-ref).
