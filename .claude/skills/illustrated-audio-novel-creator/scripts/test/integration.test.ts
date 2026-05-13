// .claude/skills/illustrated-audio-novel-creator/scripts/test/integration.test.ts
//
// 端到端无外部依赖路径：
//   (a) foundation init → state.json
//   (b) state-helpers 流转 phase
//   (c) chapter-workshop 的 scanner 三件套能在 fixture chapter 上工作
//
// 不调任何远程 API（Azure / edge-tts 都不动）。

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { tierToConfig } from "../lib/tier-config";
import {
  setPhase,
  readState,
  addDebt,
  markChapter,
} from "../lib/state-helpers";
import {
  parseCharactersMd,
  parseOutlineMd,
} from "../../../novel-foundation-builder/scripts/lib/schemas";
import { scanSlop } from "../../../novel-chapter-workshop/scripts/lib/slop-scanner";
import { scanPatterns } from "../../../novel-chapter-workshop/scripts/lib/pattern-scanner";
import { parseScenes } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";
import { buildAnchors } from "../../../scene-illustrator/scripts/lib/anchor-builder";

const FIX = resolve(import.meta.dir, "fixtures/mini-foundation");
const TMP = "/tmp/iaa-novel-integration";

beforeAll(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  for (const f of [
    "characters.md",
    "outline.md",
    "world.md",
    "voice.md",
    "style.md",
  ]) {
    await cp(join(FIX, f), join(TMP, f));
  }
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("integration: foundation init → state", () => {
  it("init-foundation.ts 能写出 state.json 且 phase=foundation_done", async () => {
    await new Promise<void>((res, rej) => {
      const cp = spawn(
        "bun",
        [
          "run",
          ".claude/skills/novel-foundation-builder/scripts/init-foundation.ts",
          "--output-dir",
          TMP,
          "--seed",
          "测试种子",
          "--tier",
          "short",
        ],
        { stdio: "inherit" },
      );
      cp.on("exit", (c) => (c === 0 ? res() : rej(new Error(`exit ${c}`))));
    });
    const state = await readState(TMP);
    expect(state.phase).toBe("foundation_done");
    expect(state.chapter_count).toBe(5);
    expect(Object.keys(state.chapters)).toHaveLength(5);
  });

  it("characters.md 中 voice_profile 不再含 'auto'", async () => {
    const md = await readFile(join(TMP, "characters.md"), "utf8");
    expect(md).not.toContain("voice_profile: auto");
  });
});

describe("integration: schemas + anchors 一致", () => {
  it("foundation 通过的 characters.md 可以被 anchor-builder 解析", async () => {
    const md = await readFile(join(TMP, "characters.md"), "utf8");
    const parsed = parseCharactersMd(md);
    const anchors = buildAnchors(md);
    expect(anchors.size).toBe(parsed.count);
    expect(anchors.get("林晚")).toContain("silver hair");
  });
});

describe("integration: tier-config 与 outline 一致", () => {
  it("tier-config short 与 fixture outline.md 互相印证", async () => {
    const cfg = tierToConfig("short");
    const md = await readFile(join(TMP, "outline.md"), "utf8");
    const o = parseOutlineMd(md);
    expect(cfg.chapter_count).toBe(o.chapterCount);
    expect(cfg.target_words).toBe(o.targetWordsTotal);
  });
});

describe("integration: 章节 scanner 三件套联跑", () => {
  it("把 ch-good fixture 当作 ch_01 处理 → 三件套全过", async () => {
    const goodMd = await readFile(
      ".claude/skills/novel-chapter-workshop/scripts/test/fixtures/ch-good.md",
      "utf8",
    );
    await mkdir(join(TMP, "chapters"), { recursive: true });
    await writeFile(join(TMP, "chapters", "ch_01.md"), goodMd);
    // anti-slop-zh.md 实际位于 novel-foundation-builder/references/ 下
    // （由 brainstorm 时归档给 foundation 阶段，chapter-workshop 通过相对路径引用）。
    const slopFile = await readFile(
      ".claude/skills/novel-foundation-builder/references/anti-slop-zh.md",
      "utf8",
    );
    const slop = scanSlop(goodMd, slopFile);
    const pat = scanPatterns(goodMd);
    const scenes = parseScenes(goodMd);
    expect(slop.filter((h) => h.tier === 1)).toHaveLength(0);
    expect(pat).toHaveLength(0);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("integration: state-helpers 跨 phase", () => {
  it("流转 init → drafted → packaged，debt 累积，chapter mark 持久化", async () => {
    await setPhase(TMP, "drafted");
    await markChapter(TMP, 1, { drafted: true, score: 7.5 });
    await addDebt(TMP, {
      kind: "chapter_low_score",
      ref: "ch_03",
      note: "score=5.4",
    });
    await setPhase(TMP, "packaged");
    const s = await readState(TMP);
    expect(s.phase).toBe("packaged");
    expect(s.chapters["1"]).toEqual({ drafted: true, score: 7.5 });
    expect(s.debts).toHaveLength(1);
  });
});
