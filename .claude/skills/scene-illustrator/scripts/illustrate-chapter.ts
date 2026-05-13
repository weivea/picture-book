#!/usr/bin/env bun
// .claude/skills/scene-illustrator/scripts/illustrate-chapter.ts

import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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

// 2. portraits Phase
const portraitsDir = join(outputDir, "portraits");
await mkdir(portraitsDir, { recursive: true });
const portraitAudit = await audit(anchors, portraitsDir);

async function runImageGen(args: string[]): Promise<void> {
  await new Promise<void>((res, rej) => {
    const cp = spawn("bun", ["run", ".claude/skills/image-generation/scripts/generate-image.ts", ...args], {
      stdio: "inherit",
    });
    cp.on("exit", (code) => (code === 0 ? res() : rej(new Error(`image-gen exit ${code}`))));
  });
}

for (const name of portraitAudit.missing) {
  const anchor = anchors.get(name)!;
  const prompt = `${style.promptPrefix}, character portrait, ${anchor}, neutral background, ${style.negative}`;
  const out = join(portraitsDir, `${name}.png`);
  await runImageGen(["--prompt", prompt, "--output", out, "--size", "1024x1024", "--quality", "high"]);
  await writeFile(
    join(portraitsDir, `${name}.meta.json`),
    JSON.stringify({ name, prompt, anchor, generatedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`✓ portrait: ${name}`);
}

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

for (const scene of targetScenes) {
  const { prompt, refPath } = buildScenePrompt(scene, anchors, style, { portraitsDir });
  const sceneIdx = String(scene.index + 1).padStart(2, "0");
  const out = join(illustrationsDir, `scene_${sceneIdx}.png`);
  const args = ["--prompt", prompt, "--output", out, "--size", "1024x1024", "--quality", "high"];
  if (refPath) args.push("--ref", refPath);
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
        refUsed: refPath,
        recheck: null,
      },
      null,
      2,
    ),
  );
  console.log(`✓ scene ${sceneIdx}: ${scene.title}`);
}

console.log(`done. chapter ${chapterN} → ${illustrationsDir}`);
