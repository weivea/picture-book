// .claude/skills/illustrated-audio-novel-creator/scripts/test/state-helpers.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  setPhase,
  addDebt,
  markChapter,
  readState,
  type Phase,
} from "../lib/state-helpers";

const TMP = "/tmp/state-helpers-test";

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  await writeFile(
    join(TMP, "state.json"),
    JSON.stringify({
      version: 1,
      project: "x",
      tier: "short",
      phase: "init",
      seed: "s",
      target_words: 10000,
      chapter_count: 5,
      created_at: "2026-05-13T00:00:00Z",
      debts: [],
      chapters: { "1": {}, "2": {} },
    }),
  );
});
afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("setPhase", () => {
  it("phase 转换合法 → 写回成功", async () => {
    await setPhase(TMP, "foundation_done");
    const s = await readState(TMP);
    expect(s.phase).toBe("foundation_done");
  });
  it("非法 phase 报错", async () => {
    await expect(
      setPhase(TMP, "garbage" as unknown as Phase),
    ).rejects.toThrow(/phase/);
  });
});

describe("addDebt", () => {
  it("追加 debt 不重复（同 kind+ref+note 去重）", async () => {
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "score=4.2" });
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "score=4.2" });
    const s = await readState(TMP);
    expect(s.debts).toHaveLength(1);
  });
  it("不同 ref 各占一条", async () => {
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_03", note: "x" });
    await addDebt(TMP, { kind: "chapter_low_score", ref: "ch_04", note: "x" });
    const s = await readState(TMP);
    expect(s.debts).toHaveLength(2);
  });
});

describe("markChapter", () => {
  it("写入章节状态", async () => {
    await markChapter(TMP, 1, { drafted: true, score: 7.1 });
    const s = await readState(TMP);
    expect(s.chapters["1"]).toEqual({ drafted: true, score: 7.1 });
  });
  it("二次 patch 是合并而不是覆盖", async () => {
    await markChapter(TMP, 1, { drafted: true });
    await markChapter(TMP, 1, { score: 6.5 });
    const s = await readState(TMP);
    expect(s.chapters["1"]).toEqual({ drafted: true, score: 6.5 });
  });
  it("新建未存在章节键", async () => {
    await markChapter(TMP, 9, { drafted: true });
    const s = await readState(TMP);
    expect(s.chapters["9"]).toEqual({ drafted: true });
  });
});
