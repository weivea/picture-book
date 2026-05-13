// .claude/skills/illustrated-audio-novel-creator/scripts/lib/state-helpers.ts

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const VALID_PHASES = [
  "init",
  "foundation_done",
  "drafting",
  "drafted",
  "revising",
  "revised",
  "illustrated",
  "audio_done",
  "packaged",
] as const;
export type Phase = (typeof VALID_PHASES)[number];

export interface Debt {
  kind: string;
  ref: string;
  note: string;
}

export interface ChapterState {
  drafted?: boolean;
  revised?: boolean;
  score?: number;
  illustrations?: number;
  audio?: boolean;
}

export interface NovelState {
  version: 1;
  project: string;
  tier: "short" | "medium" | "long";
  phase: Phase;
  seed: string;
  target_words: number;
  chapter_count: number;
  created_at: string;
  debts: Debt[];
  chapters: Record<string, ChapterState>;
}

const statePath = (dir: string) => join(resolve(dir), "state.json");

export async function readState(dir: string): Promise<NovelState> {
  return JSON.parse(await readFile(statePath(dir), "utf8"));
}
async function writeState(dir: string, s: NovelState): Promise<void> {
  await writeFile(statePath(dir), JSON.stringify(s, null, 2));
}

export async function setPhase(dir: string, phase: Phase): Promise<void> {
  if (!VALID_PHASES.includes(phase)) {
    throw new Error(
      `非法 phase: ${phase}（合法值：${VALID_PHASES.join("|")}）`,
    );
  }
  const s = await readState(dir);
  s.phase = phase;
  await writeState(dir, s);
}

export async function addDebt(dir: string, debt: Debt): Promise<void> {
  const s = await readState(dir);
  const dup = s.debts.find(
    (d) => d.kind === debt.kind && d.ref === debt.ref && d.note === debt.note,
  );
  if (!dup) s.debts.push(debt);
  await writeState(dir, s);
}

export async function markChapter(
  dir: string,
  n: number,
  patch: Partial<ChapterState>,
): Promise<void> {
  const s = await readState(dir);
  s.chapters[String(n)] = { ...(s.chapters[String(n)] ?? {}), ...patch };
  await writeState(dir, s);
}

// CLI
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "output-dir": { type: "string" },
      "set-phase": { type: "string" },
      "add-debt-kind": { type: "string" },
      "add-debt-ref": { type: "string" },
      "add-debt-note": { type: "string" },
      "mark-chapter": { type: "string" },
      patch: { type: "string" }, // JSON
    },
    strict: true,
  });
  if (!values["output-dir"]) {
    console.error("--output-dir 必填");
    process.exit(1);
  }
  const dir = values["output-dir"] as string;
  if (values["set-phase"]) {
    await setPhase(dir, values["set-phase"] as Phase);
    console.log(`✓ phase=${values["set-phase"]}`);
  }
  if (values["add-debt-kind"]) {
    await addDebt(dir, {
      kind: values["add-debt-kind"] as string,
      ref: (values["add-debt-ref"] as string | undefined) ?? "",
      note: (values["add-debt-note"] as string | undefined) ?? "",
    });
    console.log("✓ debt added");
  }
  if (values["mark-chapter"] && values.patch) {
    const n = parseInt(values["mark-chapter"] as string, 10);
    if (Number.isNaN(n) || n < 1) {
      console.error(
        `--mark-chapter 必须是正整数，收到 "${values["mark-chapter"]}"`,
      );
      process.exit(1);
    }
    let patch: Partial<ChapterState>;
    try {
      patch = JSON.parse(values.patch as string);
    } catch (e) {
      console.error(
        `--patch 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exit(1);
    }
    await markChapter(dir, n, patch);
    console.log("✓ chapter marked");
  }
}
