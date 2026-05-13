#!/usr/bin/env bun
// .claude/skills/novel-chapter-workshop/scripts/evaluate-chapter.ts

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSlop } from "./lib/slop-scanner";
import { scanPatterns } from "./lib/pattern-scanner";
import { parseScenes } from "./lib/scene-marker-parser";

const { values } = parseArgs({
  options: {
    chapter: { type: "string" },
    "anti-slop": { type: "string" },
  },
  strict: true,
});

if (!values.chapter) {
  console.error("用法: --chapter <path/to/ch_NN.md> [--anti-slop <path>]");
  process.exit(1);
}

const chapterPath = resolve(values.chapter);
const ch = await readFile(chapterPath, "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const ANTI_SLOP_DEFAULT = resolve(
  here,
  "../../novel-foundation-builder/references/anti-slop-zh.md",
);
const antiSlopPath = values["anti-slop"]
  ? resolve(values["anti-slop"])
  : ANTI_SLOP_DEFAULT;
const antiSlop = await readFile(antiSlopPath, "utf8");

/**
 * Convert the real anti-slop-zh.md format (code-fenced word-per-line for Tier 1/2,
 * bullet list for Tier 3) into the bullet-only format that scanSlop's parseAntiSlop expects.
 *
 * - Inside a fenced block under ## Tier N, each non-empty line becomes a `- <line>` bullet.
 * - Bullets outside fences (Tier 3) pass through unchanged.
 * - Tier 3 entries describe structural patterns rather than greppable phrases; we still
 *   emit them so scanSlop can match exact substrings if any happen to appear verbatim.
 *   Phrases like "不是 X，而是 Y 句式" won't substring-match real prose, which is the
 *   intended no-op behavior.
 */
function adaptAntiSlopFormat(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      const word = line.trim();
      if (word.length === 0) {
        out.push(line);
      } else {
        out.push(`- ${word}`);
      }
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

const slopHits = scanSlop(ch, adaptAntiSlopFormat(antiSlop));
const patternHits = scanPatterns(ch);
let scenes: ReturnType<typeof parseScenes>;
let sceneError: string | null = null;
try {
  scenes = parseScenes(ch);
} catch (e) {
  sceneError = (e as Error).message;
  scenes = [];
}

const slopByTier = {
  1: slopHits.filter((h) => h.tier === 1).length,
  2: slopHits.filter((h) => h.tier === 2).length,
  3: slopHits.filter((h) => h.tier === 3).length,
};

const wordCount = ch
  .replace(/^---\n[\s\S]*?\n---\n/, "")
  .replace(/<!--[^]*?-->/g, "")
  .replace(/\s/g, "").length;

const passes =
  slopByTier[1] === 0 &&
  slopByTier[2] <= 3 &&
  patternHits.length === 0 &&
  sceneError === null &&
  scenes.length >= 2;

const report = {
  chapter_path: chapterPath,
  word_count: wordCount,
  scene_count: scenes.length,
  scene_error: sceneError,
  slop_hits: slopByTier,
  slop_detail: slopHits,
  pattern_hits: patternHits,
  mechanical_pass: passes,
  judge_pending: true,
};

const outPath = chapterPath.replace(/\.md$/, ".eval.json");
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`✓ wrote ${outPath}  mechanical_pass=${passes}`);
if (!passes) process.exitCode = 2;
