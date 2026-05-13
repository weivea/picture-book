#!/usr/bin/env bun
// .claude/skills/novel-foundation-builder/scripts/init-foundation.ts

import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCharactersMd,
  parseOutlineMd,
  validateState,
  type FoundationState,
  type Tier,
} from "./lib/schemas";
import { assignVoices, type CharacterForVoice } from "./lib/voice-assigner";

// --- adapter ---------------------------------------------------------------
// references/edge-tts-voice-catalog.md uses Markdown TABLES under
//   ## 旁白 NARRATOR（默认） / ## 男声 / ## 女声
// but voice-assigner.ts:parseCatalog expects bullet-list items
//   - id | gender | notes
// under
//   ## 主角推荐 / ## 配角池 / ## 旁白
// This helper rewrites the catalog into that bullet shape.
function tableCatalogToBullets(md: string): string {
  type Section = { name: string; rows: string[][] };
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const rawLine of md.split("\n")) {
    const head = rawLine.match(/^##\s+(.+)$/);
    if (head) {
      current = { name: head[1].trim(), rows: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("|")) continue;
    // | a | b | c | -> ["a","b","c"]
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    // Skip separator row (---/:---:/etc.)
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    // Skip header row
    if (cells[0] === "id") continue;
    current.rows.push(cells);
  }

  const narratorSec = sections.find((s) => /^旁白/.test(s.name));
  const maleSec = sections.find((s) => s.name === "男声");
  const femaleSec = sections.find((s) => s.name === "女声");

  const stripBackticks = (s: string) => s.replace(/`/g, "").trim();

  const protagonist: string[] = [];
  const supporting: string[] = [];
  const narrator: string[] = [];

  function emitVoiceRows(sec: Section | undefined, gender: "male" | "female") {
    if (!sec) return;
    for (const row of sec.rows) {
      // Expect: id | gender | age | timbre | bestFor
      if (row.length < 5) continue;
      const id = stripBackticks(row[0]);
      const timbre = row[3];
      const bestFor = row[4];
      const notes = `${timbre}; ${bestFor}`;
      const bullet = `- ${id} | ${gender} | ${notes}`;
      if (bestFor.includes("主角")) protagonist.push(bullet);
      supporting.push(bullet);
    }
  }

  emitVoiceRows(maleSec, "male");
  emitVoiceRows(femaleSec, "female");

  if (narratorSec && narratorSec.rows.length > 0) {
    // 旁白 table only has (id, 定位); default narrator is male in this catalog.
    const row = narratorSec.rows[0];
    const id = stripBackticks(row[0]);
    const notes = row[row.length - 1] ?? "";
    narrator.push(`- ${id} | male | ${notes}`);
  }

  return [
    "## 主角推荐",
    ...protagonist,
    "",
    "## 配角池",
    ...supporting,
    "",
    "## 旁白",
    ...narrator,
    "",
  ].join("\n");
}

// --- CLI -------------------------------------------------------------------
const { values } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    seed: { type: "string" },
    tier: { type: "string" },
    project: { type: "string" },
  },
  strict: true,
});

if (!values["output-dir"] || !values.seed || !values.tier) {
  console.error("用法: --output-dir <dir> --seed <text> --tier <short|medium|long>");
  process.exit(1);
}
if (!["short", "medium", "long"].includes(values.tier)) {
  console.error(`--tier 必须是 short|medium|long，收到 "${values.tier}"`);
  process.exit(1);
}
const tier = values.tier as Tier;
const outputDir = resolve(values["output-dir"]!);

// 1. 读 + 校验
const charactersMd = await readFile(join(outputDir, "characters.md"), "utf8");
const outlineMd = await readFile(join(outputDir, "outline.md"), "utf8");
const charactersParsed = parseCharactersMd(charactersMd);
const outlineParsed = parseOutlineMd(outlineMd);

if (outlineParsed.tier !== tier) {
  throw new Error(`outline.md tier (${outlineParsed.tier}) 与 --tier (${tier}) 不匹配`);
}

// 2. 读 voice catalog 并适配
const here = dirname(fileURLToPath(import.meta.url));
const catalogRaw = await readFile(
  resolve(here, "../references/edge-tts-voice-catalog.md"),
  "utf8",
);
const catalogBullets = tableCatalogToBullets(catalogRaw);

// 3. 估性别（极简启发式：role=旁白 优先；否则按名字常见字粗判，无法判定时默认 female）
function guessGender(c: { name: string; role: string }): "male" | "female" {
  const maleHints = ["渊", "泽", "峰", "磊", "刚", "强", "杰", "伟"];
  const femaleHints = ["晚", "雨", "月", "雪", "媛", "婷", "怡", "芳"];
  for (const ch of c.name) {
    if (maleHints.includes(ch)) return "male";
    if (femaleHints.includes(ch)) return "female";
  }
  return "female";
}

const charsForVoice: CharacterForVoice[] = charactersParsed.characters.map((c) => ({
  name: c.name,
  role: c.role,
  gender_hint: guessGender(c),
}));
const voiceMap = assignVoices(charsForVoice, catalogBullets);

// 4. 回写 characters.md（替换 voice_profile: auto → 实际 id）
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let updatedMd = charactersMd;
for (const c of charactersParsed.characters) {
  const voice = voiceMap[c.name];
  // 仅替换该角色块内首次出现的 "voice_profile: auto"
  // 用 \s*\n 锁住 heading 边界，避免 "## 林晚" 误匹配 "## 林晚秋"
  const re = new RegExp(
    `(## ${escapeRe(c.name)}\\s*\\n[\\s\\S]*?voice_profile:\\s*)auto`,
  );
  updatedMd = updatedMd.replace(re, `$1${voice}`);
}
await writeFile(join(outputDir, "characters.md"), updatedMd);

// 5. 写 state.json
const state: FoundationState = {
  version: 1,
  project: values.project ?? basename(outputDir) ?? "novel",
  tier,
  phase: "foundation_done",
  seed: values.seed!,
  target_words: outlineParsed.targetWordsTotal,
  chapter_count: outlineParsed.chapterCount,
  created_at: new Date().toISOString(),
  debts: [],
  chapters: Object.fromEntries(
    outlineParsed.chapters.map((ch) => [String(ch.n), {}]),
  ),
};
validateState(state);
await writeFile(join(outputDir, "state.json"), JSON.stringify(state, null, 2));

console.log(`✓ foundation initialized: ${outputDir}`);
console.log(`  - characters: ${charactersParsed.count} (voices assigned)`);
console.log(`  - chapters: ${outlineParsed.chapterCount}`);
console.log(`  - state.phase: foundation_done`);
