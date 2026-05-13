#!/usr/bin/env bun
// .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { buildAnchors } from "./lib/anchor-builder";
import { buildScenePrompt, type StyleInfo } from "./lib/scene-prompt-builder";
import { audit } from "./lib/portrait-manager";
import { parseScenes } from "../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    chapter: { type: "string" },
    mode: { type: "string", default: "all" },
    "scene-index": { type: "string" },
  },
  strict: true,
});

if (!values["output-dir"]) {
  console.error("用法: --output-dir <dir> [--chapter N] [--mode all|portraits-only|scene --scene-index I]");
  process.exit(1);
}

const VALID_MODES = ["all", "portraits-only", "scene"] as const;
const mode = values.mode ?? "all";
if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
  console.error(`--mode 必须是 ${VALID_MODES.join("|")}，收到 "${mode}"`);
  process.exit(1);
}

const outputDir = resolve(values["output-dir"] as string);

// 1. 读 characters.md / style.md
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const styleMd = await readFile(join(outputDir, "style.md"), "utf8");
const anchors = buildAnchors(charactersMd);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractField(md: string, header: string): string {
  const re = new RegExp(`#\\s*${escapeRe(header)}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`);
  return md.match(re)?.[1].trim() ?? "";
}

const style: StyleInfo = {
  promptPrefix: extractField(styleMd, "promptPrefix"),
  negative: extractField(styleMd, "negative"),
};
if (!style.promptPrefix) {
  console.error("style.md 缺失或空 '# promptPrefix' 段（请检查 init-foundation 输出）");
  process.exit(1);
}
if (!style.negative) {
  console.error("style.md 缺失或空 '# negative' 段（请检查 init-foundation 输出）");
  process.exit(1);
}

// 2. portraits Phase
const portraitsDir = join(outputDir, "portraits");
await mkdir(portraitsDir, { recursive: true });
const portraitAudit = await audit(anchors, portraitsDir);

// 测试钩子：通过 IMAGE_GEN_SCRIPT 环境变量替换 image-generation 脚本路径，
// 让集成测试能 stub 掉真实 Azure 调用。生产环境无需设置；保持默认即可。
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

// 并行派发：image-generation 内置 rate-gate（默认 35s 间隔）会自动节流到 Azure RPM 上限。
// fail-fast：任意一张失败立即抛出，章节生成中断（与原串行行为一致）。
await Promise.all(
  portraitAudit.missing.map(async (name) => {
    const anchor = anchors.get(name)!;
    const prompt = `${style.promptPrefix}, character portrait, ${anchor}, neutral background, ${style.negative}`;
    const out = join(portraitsDir, `${name}.png`);
    await runImageGen([
      "--prompt", prompt,
      "--output", out,
      "--ratio", "1:1",
      "--size", "1024x1024",
      "--quality", "high",
    ]);
    await writeFile(
      join(portraitsDir, `${name}.meta.json`),
      JSON.stringify({ name, prompt, anchor, generatedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`✓ portrait: ${name}`);
  }),
);

if (mode === "portraits-only") {
  console.log("portraits-only 完成。");
  process.exit(0);
}

// 3. scenes Phase
if (!values.chapter) {
  console.error("--chapter 必填（除非 mode=portraits-only）");
  process.exit(1);
}
const chapterN = parseInt(values.chapter, 10);
if (Number.isNaN(chapterN) || chapterN < 1) {
  console.error(`--chapter 必须是正整数，收到 "${values.chapter}"`);
  process.exit(1);
}
const chapterPath = join(outputDir, "chapters", `ch_${String(chapterN).padStart(2, "0")}.md`);
const chapterMd = await readFile(chapterPath, "utf8");
const scenes = parseScenes(chapterMd);

let targetScenes: typeof scenes;
if (mode === "scene") {
  if (values["scene-index"] === undefined) {
    console.error("--mode scene 时 --scene-index 必填");
    process.exit(1);
  }
  const idx = parseInt(values["scene-index"], 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= scenes.length) {
    console.error(`--scene-index 越界（${values["scene-index"]}），可用范围 0..${scenes.length - 1}`);
    process.exit(1);
  }
  targetScenes = [scenes[idx]];
} else {
  targetScenes = scenes;
}

const illustrationsDir = join(outputDir, "illustrations", `ch_${String(chapterN).padStart(2, "0")}`);
await mkdir(illustrationsDir, { recursive: true });

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

console.log(`done. chapter ${chapterN} → ${illustrationsDir}`);
