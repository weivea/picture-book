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
// 注意：仅当本次调用包含 --ref（即 scene 阶段）时才写出 output 文件；
// portrait 阶段（无 --ref）我们故意不写文件，这样 Phase A 调用我们补缺 B 时
// B.png 仍然不存在，从而真正触发 illustrate-chapter 在 Phase B 的 existsSync 过滤。
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
const args = process.argv.slice(2);
const outIdx = args.indexOf("--output");
const out = args[outIdx + 1];
const hasRef = args.includes("--ref");
if (hasRef) {
  await writeFile(out, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
    "base64"
  ));
}
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
    `# Chapter 1\n\n<!-- SCENE: 开场 | location: 街角 | mood: calm | participants: A,B,C -->\n三人对视。\n<!-- /SCENE -->\n`,
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
