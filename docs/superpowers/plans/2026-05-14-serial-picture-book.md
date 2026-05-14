# Serial Picture Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-volume serial picture book generation system on top of the existing single-book picture-book-creator, enabling Series Bible → Season Arc → Volume → Omnibus production through four stage-scoped Claude Code skills coordinated by a shared `series-output/<series-slug>/state.json`.

**Architecture:** Four new sibling skills under `.claude/skills/`, each owning one stage: `series-bible-creator` (world/characters/style/portraits), `series-season-planner` (per-season arc & per-volume outline), `series-volume-creator` (full per-volume pipeline that orchestrates `image-generation`, `picture-book-creator/scripts/generate-epub.ts`, and `audio-picture-book-creator`), and `series-omnibus-packager` (multi-volume EPUB combiner that calls `generate-epub.ts --omnibus`). All four read/write a single shared `state.json` via an atomic helper (`series-bible-creator/scripts/lib/state.ts`). Existing skills are unchanged except `generate-epub.ts` gains an `--omnibus` flag.

**Tech Stack:** TypeScript on Bun runtime; `bun test` for unit/integration; `JSZip` for EPUB packaging; existing `picture-book-creator` markdown formats reused verbatim (`world.md`, `characters.md`, `style.md`).

**Spec:** `docs/superpowers/specs/2026-05-14-serial-picture-book-design.md`

---

## Conventions

- All new TS files use ES module syntax (project `package.json` has `"type": "module"`).
- All new scripts run via `bun run <path>`.
- All commits use Conventional Commits scoped to one of: `series-bible`, `series-season`, `series-volume`, `series-omnibus`, `epub-omnibus`, `state`, `docs`.
- Each task ends with a green test run + a single commit.
- Branch: `feature/serial-picture-book` (already created during brainstorming).

---

## Task Roadmap

Tasks are ordered so each builds only on what came before. The first 5 tasks produce shared utilities (no new skills yet, all unit-testable). Task 6 modifies an existing script. Tasks 7-10 introduce the four new skills' SKILL.md and any remaining helper scripts. Tasks 11-12 wire end-to-end fixtures and documentation.

| # | Title | Touches | Why this position |
|---|---|---|---|
| 1 | State helper (`state.ts`) | new lib + tests | Shared by all 4 skills; pure I/O |
| 2 | Outline parse/serialize (`outline-parse.ts`) | new lib + tests | Pure parsing, used by season-planner & volume-creator |
| 3 | Prompt composer (`compose-prompt.ts`) | new lib + tests | Pure function, used by volume-creator |
| 4 | Retry-spec parser (`parse-retry.ts`) | new lib + tests | Pure function, used by volume-creator |
| 5 | Range parser (`parse-range.ts`) | new lib + tests | Pure function, used by omnibus-packager |
| 6 | `generate-epub.ts --omnibus` mode | modify + tests | Single script change, fully testable in isolation |
| 7 | `series-bible-creator` SKILL.md | new SKILL.md + fixtures | First skill (no skill-skill dependencies upstream) |
| 8 | `series-season-planner` SKILL.md | new SKILL.md + fixtures | Depends on bible fixture from Task 7 |
| 9 | `series-volume-creator` SKILL.md | new SKILL.md + fixtures | Largest skill, references all earlier helpers |
| 10 | `series-omnibus-packager` SKILL.md | new SKILL.md + fixtures | Smallest skill, last because it depends on volumes |
| 11 | End-to-end mini-series smoke test | new e2e script + mocks | Validates volume-creator orchestration path |
| 12 | README + .gitignore + package.json scripts | docs only | Final polish |

---

## Task 1: Shared state.json helper

**Files:**
- Create: `.claude/skills/series-bible-creator/scripts/lib/state.ts`
- Create: `.claude/skills/series-bible-creator/scripts/lib/state.test.ts`

The helper is owned by `series-bible-creator` because that skill creates `state.json` first. The other three skills import it via relative path (e.g. `../../../series-bible-creator/scripts/lib/state.ts`).

- [ ] **Step 1: Write the failing tests**

```typescript
// .claude/skills/series-bible-creator/scripts/lib/state.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readState, writeState, loadState, updateState, type SeriesState } from "./state";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "state-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SAMPLE: SeriesState = {
  version: 1,
  series_slug: "demo",
  title: "Demo",
  created_at: "2026-05-14T00:00:00Z",
  bible: { version: 1, frozen_at: "2026-05-14T00:01:00Z" },
  seasons: {},
  volumes: {},
  omnibus: [],
};

describe("readState", () => {
  test("returns null when state.json does not exist", async () => {
    const s = await readState(dir);
    expect(s).toBeNull();
  });

  test("parses a valid state.json", async () => {
    await writeFile(join(dir, "state.json"), JSON.stringify(SAMPLE), "utf-8");
    const s = await readState(dir);
    expect(s).toEqual(SAMPLE);
  });

  test("throws on malformed JSON", async () => {
    await writeFile(join(dir, "state.json"), "{not json", "utf-8");
    await expect(readState(dir)).rejects.toThrow();
  });
});

describe("writeState", () => {
  test("creates state.json with pretty JSON", async () => {
    await writeState(dir, SAMPLE);
    const content = await readFile(join(dir, "state.json"), "utf-8");
    expect(content).toContain("\n  \"series_slug\"");
    const roundtrip = JSON.parse(content);
    expect(roundtrip).toEqual(SAMPLE);
  });

  test("is atomic: temp file does not remain after success", async () => {
    await writeState(dir, SAMPLE);
    await expect(stat(join(dir, "state.json.tmp"))).rejects.toThrow();
  });

  test("does not corrupt existing state.json if rename throws", async () => {
    await writeState(dir, SAMPLE);
    // Force failure by passing a non-existent dir.
    await expect(writeState(join(dir, "no-such-dir"), SAMPLE)).rejects.toThrow();
    // Original survives unchanged.
    const stillThere = await readState(dir);
    expect(stillThere).toEqual(SAMPLE);
  });
});

describe("loadState", () => {
  test("throws when state.json does not exist (vs. readState which returns null)", async () => {
    await expect(loadState(dir)).rejects.toThrow(/state\.json/i);
  });
  test("returns the parsed state when present", async () => {
    await writeState(dir, SAMPLE);
    expect(await loadState(dir)).toEqual(SAMPLE);
  });
});

describe("updateState", () => {
  test("creates state.json by initializing when absent and applying the mutator", async () => {
    await updateState(dir, (s) => {
      s.series_slug = "fresh";
      s.title = "Fresh";
      s.created_at = "2026-05-14T00:00:00Z";
    }, { initialize: () => structuredClone(SAMPLE) });
    const s = await loadState(dir);
    expect(s.series_slug).toBe("fresh");
    expect(s.title).toBe("Fresh");
  });

  test("applies the mutator to existing state and persists atomically", async () => {
    await writeState(dir, SAMPLE);
    await updateState(dir, (s) => {
      s.bible.frozen_at = "2026-05-14T01:00:00Z";
      s.volumes["s1v1"] = { season: "s1", phase: "drafting" };
    });
    const s = await loadState(dir);
    expect(s.bible.frozen_at).toBe("2026-05-14T01:00:00Z");
    expect(s.volumes["s1v1"]).toEqual({ season: "s1", phase: "drafting" });
  });

  test("throws when state.json is absent and no initializer is provided", async () => {
    await expect(updateState(dir, (s) => { s.title = "x"; })).rejects.toThrow(/state\.json/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .claude/skills/series-bible-creator/scripts/lib/state.test.ts`
Expected: FAIL — `Cannot find module './state'`

- [ ] **Step 3: Implement state.ts**

```typescript
// .claude/skills/series-bible-creator/scripts/lib/state.ts
import { readFile, writeFile, rename, unlink } from "fs/promises";
import { join } from "path";

export type Phase = "drafting" | "scripted" | "imaged" | "packaged";

export interface SeasonState {
  title: string;
  volumes_planned: number;
  arc_locked: boolean;
  started_at?: string;
  outline_revision: number;
}

export interface VolumeState {
  season: string | null;
  phase: Phase;
  audio?: boolean;
  pages?: number;
  score?: number;
  built_at?: string;
}

export interface OmnibusEntry {
  range: string;
  built_at: string;
  file: string;
}

export interface SeriesState {
  version: 1;
  series_slug: string;
  title: string;
  created_at: string;
  bible: {
    version: number;
    frozen_at: string | null;
  };
  seasons: Record<string, SeasonState>;
  volumes: Record<string, VolumeState>;
  omnibus: OmnibusEntry[];
}

const FILENAME = "state.json";
const TMP = "state.json.tmp";

export async function readState(seriesRoot: string): Promise<SeriesState | null> {
  let raw: string;
  try {
    raw = await readFile(join(seriesRoot, FILENAME), "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as SeriesState;
}

export async function writeState(seriesRoot: string, state: SeriesState): Promise<void> {
  const tmpPath = join(seriesRoot, TMP);
  const finalPath = join(seriesRoot, FILENAME);
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    // Best-effort cleanup; ignore if temp already gone.
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Convenience wrapper used by every series-* skill: like readState but errors
 * (rather than returning null) when state.json is missing. Most skills depend
 * on it existing — only series-bible-creator's first run uses readState.
 */
export async function loadState(seriesRoot: string): Promise<SeriesState> {
  const s = await readState(seriesRoot);
  if (s === null) {
    throw new Error(`state.json not found in ${seriesRoot} — has the series been created?`);
  }
  return s;
}

/**
 * Atomic read-modify-write. The mutator receives a deep clone of the current
 * state and mutates it in place. If `state.json` does not exist and an
 * `initialize` callback is supplied, that callback's return value is used as
 * the seed before mutation; otherwise this function throws.
 *
 * Concurrency: each call is atomic via tmp-file + rename, but two concurrent
 * callers of updateState() can still race (last-writer-wins). Series skills
 * are session-serial (one Claude session at a time per series), so this is
 * intentional and acceptable.
 */
export async function updateState(
  seriesRoot: string,
  mutator: (state: SeriesState) => void,
  options: { initialize?: () => SeriesState } = {},
): Promise<void> {
  const existing = await readState(seriesRoot);
  let next: SeriesState;
  if (existing === null) {
    if (!options.initialize) {
      throw new Error(`state.json not found in ${seriesRoot} and no initializer was provided`);
    }
    next = options.initialize();
  } else {
    next = structuredClone(existing);
  }
  mutator(next);
  await writeState(seriesRoot, next);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .claude/skills/series-bible-creator/scripts/lib/state.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-bible-creator/scripts/lib/state.ts \
        .claude/skills/series-bible-creator/scripts/lib/state.test.ts
git commit -m "feat(state): atomic series-state helper shared by all serial skills"
```

---

## Task 2: volumes-outline parser & serializer

**Files:**
- Create: `.claude/skills/series-season-planner/scripts/outline-parse.ts`
- Create: `.claude/skills/series-season-planner/scripts/outline-parse.test.ts`

This module parses `seasons/<id>/volumes-outline.md` into structured data and writes it back. `series-volume-creator` will use the writer to bump `revision` and update `planned_pages` when actual page count differs from the plan.

The format (per spec §4.5):

```markdown
---
season_id: s1
revision: 1
---

## s1v1 招牌还没挂上

- beat: 开篇 / 季初状态
- pov: 小熊
- summary: ...一段话...
- characters: [小熊, 邻居老鼠]
- planned_pages: 12
- mood: 温暖 / 期待
```

- [ ] **Step 1: Write the failing tests**

```typescript
// .claude/skills/series-season-planner/scripts/outline-parse.test.ts
import { describe, test, expect } from "bun:test";
import { parseOutline, serializeOutline } from "./outline-parse";

const SAMPLE = `---
season_id: s1
revision: 1
---

## s1v1 招牌还没挂上

- beat: 开篇 / 季初状态
- pov: 小熊
- summary: 小熊搬进新城,在小巷尽头租下旧屋打算开面包房,第一夜在烤面包香气中失眠。
- characters: [小熊, 邻居老鼠]
- planned_pages: 12
- mood: 温暖 / 期待

## s1v2 第一位顾客

- beat: 递进
- pov: 小熊
- summary: 第二天清早一只匆忙的兔子误闯进来,小熊给了他一块还没烤透的可颂。
- characters: [小熊, 兔子顾客]
- planned_pages: 10
- mood: 紧张 / 慌乱
`;

describe("parseOutline", () => {
  test("parses frontmatter", () => {
    const o = parseOutline(SAMPLE);
    expect(o.season_id).toBe("s1");
    expect(o.revision).toBe(1);
  });

  test("parses every volume entry", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes).toHaveLength(2);
    expect(o.volumes[0]!.id).toBe("s1v1");
    expect(o.volumes[0]!.title).toBe("招牌还没挂上");
    expect(o.volumes[0]!.beat).toBe("开篇 / 季初状态");
    expect(o.volumes[0]!.pov).toBe("小熊");
  });

  test("captures characters as array", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes[0]!.characters).toEqual(["小熊", "邻居老鼠"]);
  });

  test("captures planned_pages as number", () => {
    const o = parseOutline(SAMPLE);
    expect(o.volumes[0]!.planned_pages).toBe(12);
    expect(o.volumes[1]!.planned_pages).toBe(10);
  });

  test("throws on missing frontmatter", () => {
    expect(() => parseOutline("## s1v1 no frontmatter\n")).toThrow();
  });
});

describe("serializeOutline", () => {
  test("round-trips a parsed outline", () => {
    const parsed = parseOutline(SAMPLE);
    const out = serializeOutline(parsed);
    const reparsed = parseOutline(out);
    expect(reparsed).toEqual(parsed);
  });

  test("updating planned_pages and revision survives round-trip", () => {
    const parsed = parseOutline(SAMPLE);
    parsed.volumes[0]!.planned_pages = 14;
    parsed.revision = 2;
    const out = serializeOutline(parsed);
    expect(out).toContain("revision: 2");
    expect(out).toContain("planned_pages: 14");
    const reparsed = parseOutline(out);
    expect(reparsed.revision).toBe(2);
    expect(reparsed.volumes[0]!.planned_pages).toBe(14);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .claude/skills/series-season-planner/scripts/outline-parse.test.ts`
Expected: FAIL — `Cannot find module './outline-parse'`

- [ ] **Step 3: Implement outline-parse.ts**

```typescript
// .claude/skills/series-season-planner/scripts/outline-parse.ts

export interface OutlineVolume {
  id: string;
  title: string;
  beat: string;
  pov: string;
  summary: string;
  characters: string[];
  planned_pages: number;
  mood: string;
}

export interface Outline {
  season_id: string;
  revision: number;
  volumes: OutlineVolume[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const VOLUME_HEADING_RE = /^## (\S+)\s+(.+)$/;

export function parseOutline(text: string): Outline {
  const fmMatch = text.match(FRONTMATTER_RE);
  if (!fmMatch) throw new Error("outline missing YAML frontmatter");
  const fm = parseFrontmatter(fmMatch[1]!);
  const body = text.slice(fmMatch[0].length);

  const volumes: OutlineVolume[] = [];
  // Split on `## ` headings (keep them by lookahead).
  const sections = body.split(/^(?=## )/m).filter((s) => s.trim().length > 0);
  for (const section of sections) {
    const [heading, ...rest] = section.split("\n");
    const headMatch = heading!.match(VOLUME_HEADING_RE);
    if (!headMatch) continue;
    const id = headMatch[1]!;
    const title = headMatch[2]!.trim();
    const fields = parseFields(rest.join("\n"));
    volumes.push({
      id,
      title,
      beat: fields.beat ?? "",
      pov: fields.pov ?? "",
      summary: fields.summary ?? "",
      characters: parseList(fields.characters ?? "[]"),
      planned_pages: parseInt(fields.planned_pages ?? "0", 10),
      mood: fields.mood ?? "",
    });
  }

  return {
    season_id: String(fm.season_id ?? ""),
    revision: parseInt(String(fm.revision ?? "1"), 10),
    volumes,
  };
}

export function serializeOutline(o: Outline): string {
  const fm = `---\nseason_id: ${o.season_id}\nrevision: ${o.revision}\n---\n\n`;
  const blocks = o.volumes.map((v) =>
    [
      `## ${v.id} ${v.title}`,
      ``,
      `- beat: ${v.beat}`,
      `- pov: ${v.pov}`,
      `- summary: ${v.summary}`,
      `- characters: [${v.characters.join(", ")}]`,
      `- planned_pages: ${v.planned_pages}`,
      `- mood: ${v.mood}`,
      ``,
    ].join("\n")
  );
  return fm + blocks.join("\n");
}

function parseFrontmatter(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

function parseFields(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const m = line.match(/^- (\w+):\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

function parseList(s: string): string[] {
  const trimmed = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((x) => x.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .claude/skills/series-season-planner/scripts/outline-parse.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-season-planner/scripts/outline-parse.ts \
        .claude/skills/series-season-planner/scripts/outline-parse.test.ts
git commit -m "feat(series-season): outline parser and serializer with revision support"
```

---

## Task 3: Image-prompt composer

**Files:**
- Create: `.claude/skills/series-volume-creator/scripts/compose-prompt.ts`
- Create: `.claude/skills/series-volume-creator/scripts/compose-prompt.test.ts`

Pure function. Inputs: `BibleStyle`, `BibleCharacter[]` (from `bible/characters.md`), optional per-volume `PatchEntry[]`, and a `PageSpec` (from `script.md`). Output: a single string with five sections concatenated in this fixed order:

1. **STYLE** — `style.promptPrefix`
2. **CHARACTERS** — for each character on the page: `<bible_anchor>` (verbatim), then `, <patch_anchor>` if a patch exists, then ` (mood: <emotion>)`
3. **SCENE** — composed from `page.scene` + `page.action` + `page.composition`
4. **TEXT** — page.text rendering instruction
5. **NEGATIVE** — `style.negative` joined with bible character negatives and a fixed boilerplate

The bible anchor MUST appear verbatim and BEFORE any patch anchor.

- [ ] **Step 1: Write the failing tests**

```typescript
// .claude/skills/series-volume-creator/scripts/compose-prompt.test.ts
import { describe, test, expect } from "bun:test";
import {
  composePrompt,
  composePagePrompt,
  type BibleStyle,
  type BibleCharacter,
  type PageSpec,
  type PatchEntry,
} from "./compose-prompt";

const STYLE: BibleStyle = {
  promptPrefix: "Soft watercolor illustration, gentle pastel palette",
  negative: "no humans, no realistic photo",
};

const BEAR: BibleCharacter = {
  name: "小熊",
  prompt_anchor: "small honey-colored bear cub with round black eyes",
  negative: "no fangs",
};

const PAGE: PageSpec = {
  page_number: 3,
  text: "小熊把面团揉成了圆圆的一团。",
  scene: "厨房中央的木桌上摆着一团白色的面团",
  action: "小熊用两只前爪揉面团",
  emotion: "专注 / 开心",
  composition: "中景,从面团斜上方看下去",
};

describe("composePrompt", () => {
  test("five sections appear in fixed order", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    const styleIdx = out.indexOf("Soft watercolor");
    const charIdx = out.indexOf("small honey-colored bear");
    const sceneIdx = out.indexOf("厨房中央");
    const textIdx = out.indexOf("小熊把面团揉成了");
    const negIdx = out.indexOf("no humans");
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(charIdx).toBeGreaterThan(styleIdx);
    expect(sceneIdx).toBeGreaterThan(charIdx);
    expect(textIdx).toBeGreaterThan(sceneIdx);
    expect(negIdx).toBeGreaterThan(textIdx);
  });

  test("bible anchor appears verbatim", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("small honey-colored bear cub with round black eyes");
  });

  test("patch anchor appended after bible anchor with comma", () => {
    const patches: PatchEntry[] = [
      { name: "小熊", anchor: "wearing a flour-dusted white apron" },
    ];
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches, page: PAGE });
    const bibleIdx = out.indexOf("small honey-colored bear cub with round black eyes");
    const patchIdx = out.indexOf("wearing a flour-dusted white apron");
    expect(bibleIdx).toBeGreaterThanOrEqual(0);
    expect(patchIdx).toBeGreaterThan(bibleIdx);
    const between = out.slice(bibleIdx + "small honey-colored bear cub with round black eyes".length, patchIdx);
    expect(between).toBe(", ");
  });

  test("emotion is included with the character", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("mood: 专注 / 开心");
  });

  test("page text is quoted into the TEXT section", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("小熊把面团揉成了圆圆的一团。");
  });

  test("character negative is merged into NEGATIVE section", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).toContain("no fangs");
    expect(out).toContain("no humans");
  });

  test("characters with no patch render without trailing comma", () => {
    const out = composePrompt({ style: STYLE, characters: [BEAR], patches: [], page: PAGE });
    expect(out).not.toMatch(/,\s*,/);
    expect(out).not.toContain(", (mood");
  });
});

describe("composePagePrompt (VolumeContext adapter)", () => {
  test("pulls style from raw style.md text and delegates to composePrompt", () => {
    const out = composePagePrompt({
      ctx: {
        style: "# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n",
        characters: new Map([["小熊", { prompt_anchor: "small honey-colored bear cub", negative: "no fangs" }]]),
        patch: null,
      },
      page: {
        pageNumber: 1,
        text: "小熊很开心。",
        scene: "厨房",
        action: "微笑",
        emotion: "开心",
        composition: "中景",
        characters: ["小熊"],
      },
    });
    expect(out).toContain("warm pastel watercolor");
    expect(out).toContain("small honey-colored bear cub");
    expect(out).toContain("小熊很开心。");
    expect(out).toContain("no fangs");
    expect(out).toContain("no watermark");
  });

  test("applies patch anchors for characters that have them", () => {
    const out = composePagePrompt({
      ctx: {
        style: "- style_prompt: x\n- negative_prompt: y\n",
        characters: new Map([["小熊", { prompt_anchor: "BEAR_ANCHOR" }]]),
        patch: new Map([["小熊", "wearing apron"]]),
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["小熊"],
      },
    });
    const bearIdx = out.indexOf("BEAR_ANCHOR");
    const aprIdx = out.indexOf("wearing apron");
    expect(bearIdx).toBeGreaterThanOrEqual(0);
    expect(aprIdx).toBeGreaterThan(bearIdx);
  });

  test("throws when a page references a character not in the bible", () => {
    expect(() => composePagePrompt({
      ctx: {
        style: "- style_prompt: x\n- negative_prompt: y\n",
        characters: new Map(),
        patch: null,
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["不存在"],
      },
    })).toThrow(/不存在/);
  });

  test("throws when style.md lacks style_prompt", () => {
    expect(() => composePagePrompt({
      ctx: {
        style: "# 风格\n",
        characters: new Map([["小熊", { prompt_anchor: "x" }]]),
        patch: null,
      },
      page: {
        pageNumber: 1, text: "t", scene: "s", action: "a", emotion: "e", composition: "c",
        characters: ["小熊"],
      },
    })).toThrow(/style_prompt/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .claude/skills/series-volume-creator/scripts/compose-prompt.test.ts`
Expected: FAIL — `Cannot find module './compose-prompt'`

- [ ] **Step 3: Implement compose-prompt.ts**

```typescript
// .claude/skills/series-volume-creator/scripts/compose-prompt.ts

export interface BibleStyle {
  promptPrefix: string;
  negative: string;
}

export interface BibleCharacter {
  name: string;
  prompt_anchor: string;
  negative?: string;
}

export interface PatchEntry {
  name: string;
  anchor: string;
}

export interface PageSpec {
  page_number: number;
  text: string;
  scene: string;
  action: string;
  emotion: string;
  composition: string;
}

export interface ComposeInput {
  style: BibleStyle;
  characters: BibleCharacter[];
  patches: PatchEntry[];
  page: PageSpec;
}

const BOILERPLATE_NEGATIVE =
  "no watermark, no signature, no realistic photo, no anatomically incorrect features";

export function composePrompt(input: ComposeInput): string {
  const { style, characters, patches, page } = input;

  // 1. STYLE
  const styleSection = `[STYLE]\n${style.promptPrefix}`;

  // 2. CHARACTERS
  const charLines = characters.map((c) => {
    const patch = patches.find((p) => p.name === c.name);
    const anchor = patch ? `${c.prompt_anchor}, ${patch.anchor}` : c.prompt_anchor;
    return `${c.name}: ${anchor} (mood: ${page.emotion})`;
  });
  const charSection = `[CHARACTERS]\n${charLines.join("\n")}`;

  // 3. SCENE
  const sceneSection =
    `[SCENE]\nscene: ${page.scene}\naction: ${page.action}\ncomposition: ${page.composition}`;

  // 4. TEXT
  const textSection =
    `[TEXT]\nRender the following children's-book line into the page in a position that suits the composition, in the style of the bible: "${page.text}"`;

  // 5. NEGATIVE
  const charNegatives = characters
    .map((c) => c.negative)
    .filter((s): s is string => Boolean(s && s.trim().length > 0));
  const negative = [style.negative, ...charNegatives, BOILERPLATE_NEGATIVE].join(", ");
  const negativeSection = `[NEGATIVE]\n${negative}`;

  return [styleSection, charSection, sceneSection, textSection, negativeSection].join("\n\n");
}

// ----- High-level adapter used by series-volume-creator orchestrator -----

/**
 * Per-page input the orchestrator passes in. Equivalent to PageSpec but
 * named for the orchestrator's vocabulary, plus a `characters` field that
 * lists which character names appear on this page (so the composer doesn't
 * need to grep the scene text).
 */
export interface PageInput {
  pageNumber: number;
  text: string;
  scene: string;
  action: string;
  emotion: string;
  composition: string;
  characters: string[];          // character names from script.md for this page
}

/**
 * Convenience adapter that pulls style/characters/patch out of a loaded
 * VolumeContext and delegates to composePrompt. The orchestrator (Task 9)
 * calls this — keeping VolumeContext-typed dependencies isolated to one
 * function makes composePrompt itself easy to unit-test in isolation.
 */
export interface ComposePageArgs {
  ctx: {
    style: string;                                    // raw style.md text
    characters: Map<string, { prompt_anchor: string; negative?: string }>;
    patch: Map<string, string> | null;
  };
  page: PageInput;
}

export function composePagePrompt(args: ComposePageArgs): string {
  const { ctx, page } = args;
  const style = parseStyle(ctx.style);
  const charactersOnPage: BibleCharacter[] = page.characters.map((name) => {
    const c = ctx.characters.get(name);
    if (!c) throw new Error(`character "${name}" not found in bible characters.md`);
    return { name, prompt_anchor: c.prompt_anchor, negative: c.negative };
  });
  const patches: PatchEntry[] = ctx.patch
    ? page.characters
        .map((name) => {
          const a = ctx.patch!.get(name);
          return a ? { name, anchor: a } : null;
        })
        .filter((p): p is PatchEntry => p !== null)
    : [];
  const pageSpec: PageSpec = {
    page_number: page.pageNumber,
    text: page.text,
    scene: page.scene,
    action: page.action,
    emotion: page.emotion,
    composition: page.composition,
  };
  return composePrompt({ style, characters: charactersOnPage, patches, page: pageSpec });
}

/**
 * Extract `style_prompt` and `negative_prompt` from a bible/style.md.
 * Format (per series-bible-creator output):
 *   - style_prompt: <english phrase>
 *   - negative_prompt: <english phrase>
 */
function parseStyle(md: string): BibleStyle {
  const promptPrefix = field(md, "style_prompt") ?? "";
  const negative = field(md, "negative_prompt") ?? "";
  if (!promptPrefix) throw new Error("style.md missing `- style_prompt: ...` line");
  return { promptPrefix, negative };
}

function field(md: string, key: string): string | undefined {
  const re = new RegExp(`^- ${key}:\\s*(.+)$`, "m");
  const m = md.match(re);
  return m ? m[1]!.trim() : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .claude/skills/series-volume-creator/scripts/compose-prompt.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-volume-creator/scripts/compose-prompt.ts \
        .claude/skills/series-volume-creator/scripts/compose-prompt.test.ts
git commit -m "feat(series-volume): five-section prompt composer with bible-anchor verbatim guarantee"
```

---

## Task 4: Retry-spec parser

**Files:**
- Create: `.claude/skills/series-volume-creator/scripts/parse-retry.ts`
- Create: `.claude/skills/series-volume-creator/scripts/parse-retry.test.ts`

When Step 6 has partial generation failures, the user types a free-form retry instruction like `"重试 5、9 页"` or `"redo pages 3, 7-9"`. This module turns that free text into a deduplicated, sorted `number[]` of page indices, scoped to a known total page count so out-of-range numbers are rejected loudly rather than silently regenerating phantom pages.

- [ ] **Step 1: Write the failing tests**

```typescript
// .claude/skills/series-volume-creator/scripts/parse-retry.test.ts
import { describe, test, expect } from "bun:test";
import { parseRetrySpec } from "./parse-retry";

describe("parseRetrySpec", () => {
  test("parses Chinese comma list", () => {
    expect(parseRetrySpec("重试 5、9 页", 12)).toEqual([5, 9]);
  });

  test("parses Chinese ASCII comma list", () => {
    expect(parseRetrySpec("重试 1, 3, 5 页", 12)).toEqual([1, 3, 5]);
  });

  test("parses English comma list", () => {
    expect(parseRetrySpec("redo pages 2, 4, 6", 12)).toEqual([2, 4, 6]);
  });

  test("parses ranges with hyphen", () => {
    expect(parseRetrySpec("重试 3-6 页", 12)).toEqual([3, 4, 5, 6]);
  });

  test("parses Chinese 至 range", () => {
    expect(parseRetrySpec("重试 3 至 6 页", 12)).toEqual([3, 4, 5, 6]);
  });

  test("mixes ranges and singletons", () => {
    expect(parseRetrySpec("重试 1、3-5、9 页", 12)).toEqual([1, 3, 4, 5, 9]);
  });

  test("dedupes and sorts", () => {
    expect(parseRetrySpec("重试 9、3、5、3 页", 12)).toEqual([3, 5, 9]);
  });

  test("includes page 0 (cover)", () => {
    expect(parseRetrySpec("重试 0 页", 12)).toEqual([0]);
  });

  test("throws when a page is out of range", () => {
    expect(() => parseRetrySpec("重试 15 页", 12)).toThrow(/15/);
  });

  test("throws when a range exceeds total", () => {
    expect(() => parseRetrySpec("重试 10-20 页", 12)).toThrow();
  });

  test("throws when input contains no numbers", () => {
    expect(() => parseRetrySpec("再做一次", 12)).toThrow(/no page numbers/i);
  });

  test("throws on inverted range", () => {
    expect(() => parseRetrySpec("重试 9-3 页", 12)).toThrow(/range/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .claude/skills/series-volume-creator/scripts/parse-retry.test.ts`
Expected: FAIL — `Cannot find module './parse-retry'`

- [ ] **Step 3: Implement parse-retry.ts**

```typescript
// .claude/skills/series-volume-creator/scripts/parse-retry.ts

/**
 * Parse a free-text retry instruction into a sorted, deduplicated list of
 * page indices. `totalPages` is the page count of the volume (cover counts
 * as page 0, so valid range is [0, totalPages]).
 *
 * Accepts mixed Chinese/English punctuation and ranges:
 *   "重试 5、9 页"     → [5, 9]
 *   "重试 3-6 页"      → [3, 4, 5, 6]
 *   "重试 3 至 6 页"   → [3, 4, 5, 6]
 *   "redo pages 1, 4-5"→ [1, 4, 5]
 *
 * Throws if no numbers are found, or any number/range is outside [0, totalPages].
 */
export function parseRetrySpec(input: string, totalPages: number): number[] {
  // Normalize: replace Chinese commas with ASCII; replace 至 with -.
  const normalized = input
    .replace(/[，、]/g, ",")
    .replace(/\s*至\s*/g, "-")
    .replace(/\s+/g, " ");

  // Match either a range "a-b" or a single number.
  const tokens = normalized.match(/\d+\s*-\s*\d+|\d+/g);
  if (!tokens || tokens.length === 0) {
    throw new Error("no page numbers found in retry spec");
  }

  const pages = new Set<number>();
  for (const tok of tokens) {
    const rangeMatch = tok.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      if (lo > hi) {
        throw new Error(`invalid range ${lo}-${hi}: low > high`);
      }
      for (let n = lo; n <= hi; n++) {
        assertInRange(n, totalPages);
        pages.add(n);
      }
    } else {
      const n = parseInt(tok, 10);
      assertInRange(n, totalPages);
      pages.add(n);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function assertInRange(n: number, totalPages: number): void {
  if (n < 0 || n > totalPages) {
    throw new Error(`page ${n} out of range [0, ${totalPages}]`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .claude/skills/series-volume-creator/scripts/parse-retry.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-volume-creator/scripts/parse-retry.ts \
        .claude/skills/series-volume-creator/scripts/parse-retry.test.ts
git commit -m "feat(series-volume): retry-spec parser supporting CJK and ASCII forms"
```

---

## Task 5: Omnibus range parser

**Files:**
- Create: `.claude/skills/series-omnibus-packager/scripts/parse-range.ts`
- Create: `.claude/skills/series-omnibus-packager/scripts/parse-range.test.ts`

The omnibus skill accepts the user's free-text range spec and resolves it against `state.json` into the concrete ordered list of volume ids to merge. Supported inputs (per spec §5.4 Step 0): a season id (`"s1"`, `"第一季"`), the literal `"全部"`/`"all"`, or an explicit comma list of volume ids. Volumes that exist in `state.json` but are not yet `phase=packaged` are skipped with a warning (filtering happens here so the caller can render warnings before invoking `generate-epub.ts`).

Range tokens we must support (from §5.4 + §3 contract row "≥1 册 in range packaged"):

| Input | Resolves to |
|---|---|
| `"s1"` | every volume in `state.json` whose `season === "s1"`, ordered by id |
| `"第一季"` | same as above (Chinese alias for `s1`, `第二季` → `s2`, ...) |
| `"全部"` / `"all"` | every volume id in `state.json`, ordered by season then id |
| `"s1v1, s1v3, s1v5"` | the listed ids, in given order |

The function returns `{ ids: string[]; skipped: { id: string; reason: string }[] }`. It NEVER reads the filesystem — it operates purely on a pre-loaded `SeriesState` (from Task 1's `state.ts`) so the caller controls all I/O.

- [ ] **Step 1: Write the failing tests**

```typescript
// .claude/skills/series-omnibus-packager/scripts/parse-range.test.ts
import { describe, test, expect } from "bun:test";
import { parseRange } from "./parse-range";
import type { SeriesState } from "../../series-bible-creator/scripts/lib/state";

const STATE: SeriesState = {
  version: 1,
  series_slug: "demo",
  title: "demo",
  created_at: "2026-05-14T00:00:00Z",
  bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
  seasons: {
    s1: { title: "S1", volumes_planned: 3, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 },
    s2: { title: "S2", volumes_planned: 2, arc_locked: true, started_at: "2026-05-15T00:00:00Z", outline_revision: 1 },
  },
  volumes: {
    s1v1: { season: "s1", phase: "packaged", audio: true, pages: 12 },
    s1v2: { season: "s1", phase: "packaged", audio: true, pages: 12 },
    s1v3: { season: "s1", phase: "imaged" },              // not yet packaged
    s2v1: { season: "s2", phase: "packaged", audio: false, pages: 10 },
    "standalone-001": { season: null, phase: "packaged", audio: true, pages: 8 },
  },
  omnibus: [],
};

describe("parseRange", () => {
  test("season id selects all packaged volumes in that season", () => {
    const r = parseRange("s1", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2"]);
    expect(r.skipped).toEqual([{ id: "s1v3", reason: "not packaged (phase=imaged)" }]);
  });

  test("Chinese season alias 第一季 maps to s1", () => {
    const r = parseRange("第一季", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2"]);
  });

  test("Chinese season alias 第二季 maps to s2", () => {
    const r = parseRange("第二季", STATE);
    expect(r.ids).toEqual(["s2v1"]);
  });

  test("'全部' selects every packaged volume across seasons + standalones", () => {
    const r = parseRange("全部", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2", "s2v1", "standalone-001"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["s1v3"]);
  });

  test("'all' is an alias for 全部", () => {
    const r = parseRange("all", STATE);
    expect(r.ids).toEqual(["s1v1", "s1v2", "s2v1", "standalone-001"]);
  });

  test("explicit comma list preserves user-given order", () => {
    const r = parseRange("s2v1, s1v1", STATE);
    expect(r.ids).toEqual(["s2v1", "s1v1"]);
    expect(r.skipped).toEqual([]);
  });

  test("explicit list skips not-yet-packaged volumes with reason", () => {
    const r = parseRange("s1v1, s1v3", STATE);
    expect(r.ids).toEqual(["s1v1"]);
    expect(r.skipped).toEqual([{ id: "s1v3", reason: "not packaged (phase=imaged)" }]);
  });

  test("explicit list errors on unknown volume id", () => {
    expect(() => parseRange("s1v1, s9v9", STATE)).toThrow(/s9v9/);
  });

  test("unknown season id throws", () => {
    expect(() => parseRange("s99", STATE)).toThrow(/s99/);
  });

  test("warns when result has only one volume (omnibus of 1 makes no sense)", () => {
    const r = parseRange("s2", STATE);
    expect(r.ids).toEqual(["s2v1"]);
    expect(r.warnings).toEqual(["omnibus of a single volume — output will be a copy of that volume"]);
  });

  test("throws when result is empty", () => {
    const empty: SeriesState = { ...STATE, volumes: {} };
    expect(() => parseRange("全部", empty)).toThrow(/no .*volumes/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test .claude/skills/series-omnibus-packager/scripts/parse-range.test.ts`
Expected: FAIL — `Cannot find module './parse-range'`

- [ ] **Step 3: Implement parse-range.ts**

```typescript
// .claude/skills/series-omnibus-packager/scripts/parse-range.ts

import type { SeriesState } from "../../series-bible-creator/scripts/lib/state";

export interface RangeResolution {
  ids: string[];                              // ordered, packaged-only volume ids
  skipped: { id: string; reason: string }[];  // matched but not packaged
  warnings: string[];                         // non-fatal advisories
}

const CN_SEASON_RE = /^第\s*([一二三四五六七八九十百零〇1234567890]+)\s*季$/;
const CN_NUMERALS: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  "〇": 0, "零": 0,
};

export function parseRange(input: string, state: SeriesState): RangeResolution {
  const trimmed = input.trim();

  // Branch 1: 全部 / all
  if (trimmed === "全部" || trimmed.toLowerCase() === "all") {
    return resolveAll(state);
  }

  // Branch 2: explicit comma list (contains a comma OR matches a volume id pattern)
  if (trimmed.includes(",") || trimmed.includes("，") || /v\d+|standalone-\d+/.test(trimmed)) {
    return resolveExplicit(trimmed, state);
  }

  // Branch 3: season id, either raw "sN" or Chinese "第N季"
  const seasonId = normalizeSeasonId(trimmed);
  if (!(seasonId in state.seasons)) {
    throw new Error(`unknown season "${trimmed}" (resolved to ${seasonId}); known: ${Object.keys(state.seasons).join(", ")}`);
  }
  return resolveBySeason(seasonId, state);
}

function normalizeSeasonId(s: string): string {
  if (/^s\d+$/.test(s)) return s;
  const m = s.match(CN_SEASON_RE);
  if (m) {
    const raw = m[1]!;
    // Try ASCII digits first.
    if (/^\d+$/.test(raw)) return `s${parseInt(raw, 10)}`;
    // Single-char Chinese numeral (一-十).
    if (raw.length === 1 && raw in CN_NUMERALS) return `s${CN_NUMERALS[raw]}`;
    // Compound like 十一, 二十 etc. — minimal support: 十X / X十 / X十Y
    const ten = CN_NUMERALS["十"]!;
    if (raw.length === 2) {
      if (raw[0] === "十" && raw[1]! in CN_NUMERALS) return `s${ten + CN_NUMERALS[raw[1]!]!}`;
      if (raw[1] === "十" && raw[0]! in CN_NUMERALS) return `s${CN_NUMERALS[raw[0]!]! * ten}`;
    }
  }
  return s; // fallthrough; caller will error on unknown
}

function resolveAll(state: SeriesState): RangeResolution {
  const all = sortVolumeIds(Object.keys(state.volumes), state);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of all) {
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error("no packaged volumes to omnibus");
  return { ids, skipped, warnings: warningsFor(ids) };
}

function resolveBySeason(seasonId: string, state: SeriesState): RangeResolution {
  const matched = Object.entries(state.volumes)
    .filter(([, v]) => v.season === seasonId)
    .map(([id]) => id);
  const ordered = sortVolumeIds(matched, state);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ordered) {
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error(`no packaged volumes in season ${seasonId}`);
  return { ids, skipped, warnings: warningsFor(ids) };
}

function resolveExplicit(spec: string, state: SeriesState): RangeResolution {
  const tokens = spec.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of tokens) {
    if (!(id in state.volumes)) {
      throw new Error(`unknown volume id "${id}"; known: ${Object.keys(state.volumes).join(", ")}`);
    }
    const v = state.volumes[id]!;
    if (v.phase === "packaged") ids.push(id);
    else skipped.push({ id, reason: `not packaged (phase=${v.phase})` });
  }
  if (ids.length === 0) throw new Error("no packaged volumes selected");
  return { ids, skipped, warnings: warningsFor(ids) };
}

/**
 * Order: by season key (alphanumeric, with "null" — i.e. standalones — last),
 * then by volume id within season.
 */
function sortVolumeIds(ids: string[], state: SeriesState): string[] {
  return [...ids].sort((a, b) => {
    const sa = state.volumes[a]!.season ?? "￿";
    const sb = state.volumes[b]!.season ?? "￿";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function warningsFor(ids: string[]): string[] {
  if (ids.length === 1) {
    return ["omnibus of a single volume — output will be a copy of that volume"];
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test .claude/skills/series-omnibus-packager/scripts/parse-range.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-omnibus-packager/scripts/parse-range.ts \
        .claude/skills/series-omnibus-packager/scripts/parse-range.test.ts
git commit -m "feat(series-omnibus): range parser for season/全部/explicit-list inputs"
```

---

## Task 6: `generate-epub.ts --omnibus` mode

**Files:**
- Modify: `.claude/skills/picture-book-creator/scripts/generate-epub.ts`
- Create: `.claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts`

Extend the existing single-volume EPUB packager with an `--omnibus` mode that merges multiple already-built volumes into one Fixed-Layout EPUB3. The single-volume code path stays exactly as it is — we only add a new branch when `--omnibus` is set.

**Spec mapping (§6.1):**
- `--omnibus` enables omnibus mode (boolean flag)
- `--volumes "s1v1,s1v2,..."` ordered list of volume folder names under `series-root/volumes/`
- `--series-root <path>` path to `series-output/<series-slug>/`
- `--title`, `--author`, `--lang` reused from single-volume mode

**Behavior:**
- Each listed volume's `volumes/<id>/<n>.png` files are added under EPUB path `OEBPS/images/<volumeId>/<n>.png` (namespaced to avoid filename collisions across volumes)
- Each volume gets a 1-page divider XHTML (volume title, no image) inserted before its content
- Cover of the omnibus = cover of the FIRST listed volume (its `0.png`)
- `nav.xhtml` is grouped: one `<li>` per volume containing a nested `<ol>` of pages
- Per-page text (from `volumes/<id>/script.md`) is preserved exactly like single-volume mode
- Output path defaults to `series-root/omnibus/<title>.epub`

- [ ] **Step 1: Write the failing test**

```typescript
// .claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import JSZip from "jszip";

const SCRIPT = join(import.meta.dir, "generate-epub.ts");

// Tiny valid 1×1 PNG (red pixel). Reused across all fixture pages.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);

let root: string;
let seriesRoot: string;
let outPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "omnibus-test-"));
  seriesRoot = join(root, "demo-series");
  // Build two minimal "packaged" volumes.
  for (const vid of ["s1v1", "s1v2"]) {
    const vdir = join(seriesRoot, "volumes", vid);
    await mkdir(vdir, { recursive: true });
    for (const n of [0, 1, 2]) {
      await writeFile(join(vdir, `${n}.png`), TINY_PNG);
    }
    await writeFile(
      join(vdir, "script.md"),
      `# ${vid}\n\n## 第 0 页\n**text**：${vid} 封面\n\n## 第 1 页\n**text**：${vid} 第一页\n\n## 第 2 页\n**text**：${vid} 第二页\n`
    );
  }
  await mkdir(join(seriesRoot, "omnibus"), { recursive: true });
  outPath = join(seriesRoot, "omnibus", "demo.epub");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("generate-epub.ts --omnibus", () => {
  test("produces an EPUB containing both volumes' images", async () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--volumes", "s1v1,s1v2",
      "--title", "合订本测试",
      "--author", "tester",
      "--lang", "zh",
      "--output", outPath,
    ], { encoding: "utf-8" });
    expect(r.status).toBe(0);

    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);

    // Images namespaced by volume id.
    expect(zip.file("OEBPS/images/s1v1/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v1/1.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v1/2.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v2/0.png")).not.toBeNull();
    expect(zip.file("OEBPS/images/s1v2/2.png")).not.toBeNull();

    // Per-volume divider XHTML present.
    expect(zip.file("OEBPS/divider-s1v1.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/divider-s1v2.xhtml")).not.toBeNull();
  });

  test("nav.xhtml groups pages by volume", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    // Each volume id appears in nav as a group label.
    expect(nav).toContain("s1v1");
    expect(nav).toContain("s1v2");
    // Nested ordered list (group → pages).
    expect(nav.match(/<ol>/g)!.length).toBeGreaterThanOrEqual(3); // 1 outer + 2 inner
  });

  test("opf spine starts with first volume cover then alternates dividers + pages", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    // Cover of omnibus is first volume's page 0.
    expect(opf).toMatch(/properties="cover-image"[^>]*href="images\/s1v1\/0\.png"|href="images\/s1v1\/0\.png"[^>]*properties="cover-image"/);
    // Both volumes' page 1 idrefs in spine.
    expect(opf).toContain('idref="page-s1v1-1"');
    expect(opf).toContain('idref="page-s1v2-1"');
  });

  test("per-page text from each volume's script.md is rendered", async () => {
    const buf = await readFile(outPath);
    const zip = await JSZip.loadAsync(buf);
    const p1 = await zip.file("OEBPS/page-s1v1-1.xhtml")!.async("string");
    expect(p1).toContain("s1v1 第一页");
    const p2 = await zip.file("OEBPS/page-s1v2-2.xhtml")!.async("string");
    expect(p2).toContain("s1v2 第二页");
  });

  test("--omnibus errors if --volumes is missing", () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--title", "x",
    ], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--volumes/);
  });

  test("--omnibus errors if a listed volume directory is missing", () => {
    const r = spawnSync("bun", [
      "run", SCRIPT,
      "--omnibus",
      "--series-root", seriesRoot,
      "--volumes", "s1v1,sNOPE",
      "--title", "x",
    ], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/sNOPE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts`
Expected: FAIL — script exits non-zero (`--omnibus` flag unrecognized) or assertions fail.

- [ ] **Step 3: Refactor `generate-epub.ts` to extract a shared body builder**

The current script is top-level imperative. Wrap the existing single-volume body in an exported function `buildSingleVolumeEpub({ inputDir, title, author, lang, output, vpW, vpH })` and add a sibling `buildOmnibusEpub({ seriesRoot, volumes, title, author, lang, output, vpW, vpH })`. The CLI dispatcher chooses between them based on the `--omnibus` flag.

Replace the entire current contents of `.claude/skills/picture-book-creator/scripts/generate-epub.ts` with:

```typescript
/**
 * 将绘本图片目录转换为 Fixed-Layout EPUB 电子书
 * 支持两种模式:
 *   1) 单册:  --input <dir> --title <title>
 *   2) 合订:  --omnibus --series-root <dir> --volumes "id1,id2,..." --title <title>
 */

import { parseArgs } from "util";
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { resolve, join } from "path";
import JSZip from "jszip";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    // shared
    title: { type: "string" },
    author: { type: "string", default: "AI Picture Book Creator" },
    lang: { type: "string", default: "zh" },
    output: { type: "string" },
    width: { type: "string", default: "2048" },
    height: { type: "string", default: "2048" },
    // single-volume
    input: { type: "string" },
    // omnibus
    omnibus: { type: "boolean", default: false },
    "series-root": { type: "string" },
    volumes: { type: "string" },
  },
});

const vpW = parseInt(values.width!);
const vpH = parseInt(values.height!);

if (!values.title) {
  console.error("--title is required");
  process.exit(1);
}

if (values.omnibus) {
  if (!values["series-root"] || !values.volumes) {
    console.error("Omnibus mode requires --series-root and --volumes");
    process.exit(1);
  }
  const seriesRoot = resolve(values["series-root"]!);
  const volumeIds = values.volumes!.split(",").map((s) => s.trim()).filter(Boolean);
  const out = values.output ?? join(seriesRoot, "omnibus", `${values.title}.epub`);
  await buildOmnibusEpub({
    seriesRoot, volumeIds, title: values.title!, author: values.author!,
    lang: values.lang!, output: out, vpW, vpH,
  });
} else {
  if (!values.input) {
    console.error("Single-volume mode requires --input");
    process.exit(1);
  }
  const inputDir = resolve(values.input!);
  const out = values.output ?? join(inputDir, `${values.title}.epub`);
  await buildSingleVolumeEpub({
    inputDir, title: values.title!, author: values.author!,
    lang: values.lang!, output: out, vpW, vpH,
  });
}

// ---------------- shared helpers ----------------

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function readPageTexts(scriptPath: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const content = await readFile(scriptPath, "utf-8");
    const re = /## 第 (\d+) 页[\s\S]*?\*\*text\*\*[：:]\s*(.+)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      map.set(parseInt(m[1]!), m[2]!.trim());
    }
  } catch {
    // missing script.md is OK
  }
  return map;
}

async function listPngFiles(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  return all.filter((f) => /^\d+\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
}

function pageXhtmlImg(imgHref: string, pageNum: number, text: string | undefined, vpW: number, vpH: number): string {
  const textHtml = text
    ? `\n  <p style="position:absolute;bottom:2%;left:5%;right:5%;text-align:center;font-size:2.5em;color:#333;font-family:serif;line-height:1.6;margin:0;">${escapeXml(text)}</p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${vpW}, height=${vpH}"/>
  <title>第 ${pageNum} 页</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <img src="${imgHref}" alt="第${pageNum}页"/>${textHtml}
</body>
</html>`;
}

function dividerXhtml(label: string, vpW: number, vpH: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${vpW}, height=${vpH}"/>
  <title>${escapeXml(label)}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #faf6ef; font-family: serif; }
    h1 { font-size: 4em; color: #444; text-align: center; }
  </style>
</head>
<body><h1>${escapeXml(label)}</h1></body>
</html>`;
}

function baseOpfMeta(bookId: string, title: string, author: string, lang: string, now: string): string {
  return `    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${now}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:orientation">auto</meta>`;
}

function makeBaseZip(): JSZip {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  return zip;
}

// ---------------- single-volume builder ----------------

interface SingleArgs {
  inputDir: string; title: string; author: string; lang: string;
  output: string; vpW: number; vpH: number;
}

async function buildSingleVolumeEpub(a: SingleArgs): Promise<void> {
  const pngFiles = await listPngFiles(a.inputDir);
  if (pngFiles.length === 0) {
    console.error(`No numbered PNG files found in ${a.inputDir}`);
    process.exit(1);
  }
  const pageTexts = await readPageTexts(join(a.inputDir, "script.md"));
  if (pageTexts.size > 0) console.log(`Extracted text for ${pageTexts.size} pages from script.md`);

  const coverFile = pngFiles.find((f) => parseInt(f) === 0) ?? pngFiles[0]!;
  const contentPages = pngFiles.filter((f) => f !== coverFile);

  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const zip = makeBaseZip();
  for (const f of pngFiles) zip.file(`OEBPS/images/${f}`, await readFile(join(a.inputDir, f)));
  zip.file("OEBPS/cover.xhtml", pageXhtmlImg(`images/${coverFile}`, 0, pageTexts.get(0), a.vpW, a.vpH));
  for (const f of contentPages) {
    const n = parseInt(f);
    zip.file(`OEBPS/page-${n}.xhtml`, pageXhtmlImg(`images/${f}`, n, pageTexts.get(n), a.vpW, a.vpH));
  }

  const manifest = [
    `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `    <item id="cover-image" href="images/${coverFile}" media-type="image/png" properties="cover-image"/>`,
    ...contentPages.map((f) => `    <item id="page-${parseInt(f)}" href="page-${parseInt(f)}.xhtml" media-type="application/xhtml+xml"/>`),
    ...contentPages.map((f) => `    <item id="img-${parseInt(f)}" href="images/${f}" media-type="image/png"/>`),
  ];
  const spine = [
    `    <itemref idref="cover"/>`,
    ...contentPages.map((f) => `    <itemref idref="page-${parseInt(f)}"/>`),
  ];
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${baseOpfMeta(bookId, a.title, a.author, a.lang, now)}
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifest.join("\n")}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spine.join("\n")}
  </spine>
</package>`);

  const navItems = [
    `      <li><a href="cover.xhtml">封面</a></li>`,
    ...contentPages.map((f) => `      <li><a href="page-${parseInt(f)}.xhtml">第 ${parseInt(f)} 页</a></li>`),
  ];
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${navItems.join("\n")}
    </ol>
  </nav>
</body>
</html>`);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(a.output, buffer);
  console.log(`EPUB generated: ${a.output}`);
  console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Pages: ${contentPages.length} (+ cover)`);
}

// ---------------- omnibus builder ----------------

interface OmnibusArgs {
  seriesRoot: string; volumeIds: string[]; title: string; author: string; lang: string;
  output: string; vpW: number; vpH: number;
}

async function buildOmnibusEpub(a: OmnibusArgs): Promise<void> {
  // Validate every volume directory exists and collect its pages.
  const perVolume: { id: string; dir: string; files: string[]; texts: Map<number, string> }[] = [];
  for (const id of a.volumeIds) {
    const dir = join(a.seriesRoot, "volumes", id);
    try {
      await stat(dir);
    } catch {
      console.error(`Volume directory missing: ${dir}`);
      process.exit(1);
    }
    const files = await listPngFiles(dir);
    if (files.length === 0) {
      console.error(`Volume ${id} has no numbered PNGs in ${dir}`);
      process.exit(1);
    }
    const texts = await readPageTexts(join(dir, "script.md"));
    perVolume.push({ id, dir, files, texts });
  }

  const bookId = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const zip = makeBaseZip();

  // Add all images namespaced by volume.
  for (const v of perVolume) {
    for (const f of v.files) {
      zip.file(`OEBPS/images/${v.id}/${f}`, await readFile(join(v.dir, f)));
    }
  }

  // Cover = first volume's page 0 (or its first page if no 0).
  const firstVol = perVolume[0]!;
  const coverFile = firstVol.files.find((f) => parseInt(f) === 0) ?? firstVol.files[0]!;
  const coverHref = `images/${firstVol.id}/${coverFile}`;
  zip.file("OEBPS/cover.xhtml", pageXhtmlImg(coverHref, 0, firstVol.texts.get(0), a.vpW, a.vpH));

  // Per-volume divider + content pages.
  const manifestItems: string[] = [
    `    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `    <item id="cover-image" href="${coverHref}" media-type="image/png" properties="cover-image"/>`,
  ];
  const spineItems: string[] = [`    <itemref idref="cover"/>`];
  const navGroups: string[] = [];

  for (const v of perVolume) {
    // Divider.
    zip.file(`OEBPS/divider-${v.id}.xhtml`, dividerXhtml(v.id, a.vpW, a.vpH));
    manifestItems.push(`    <item id="divider-${v.id}" href="divider-${v.id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="divider-${v.id}"/>`);

    const navInner: string[] = [`        <li><a href="divider-${v.id}.xhtml">${escapeXml(v.id)}</a></li>`];

    // Content pages: skip the cover image of the FIRST volume only (already used as omnibus cover);
    // for all other volumes, include their page 0 as a normal interior page.
    const pagesToEmit = v === firstVol
      ? v.files.filter((f) => f !== coverFile)
      : v.files;

    for (const f of pagesToEmit) {
      const n = parseInt(f);
      const xhtmlName = `page-${v.id}-${n}.xhtml`;
      zip.file(`OEBPS/${xhtmlName}`, pageXhtmlImg(`images/${v.id}/${f}`, n, v.texts.get(n), a.vpW, a.vpH));
      manifestItems.push(`    <item id="page-${v.id}-${n}" href="${xhtmlName}" media-type="application/xhtml+xml"/>`);
      manifestItems.push(`    <item id="img-${v.id}-${n}" href="images/${v.id}/${f}" media-type="image/png"/>`);
      spineItems.push(`    <itemref idref="page-${v.id}-${n}"/>`);
      navInner.push(`        <li><a href="${xhtmlName}">第 ${n} 页</a></li>`);
    }

    // Also register the cover image of the first volume (used by cover.xhtml) — but as cover-image, not duplicated as img.
    navGroups.push(`      <li>${escapeXml(v.id)}\n        <ol>\n${navInner.join("\n")}\n        </ol>\n      </li>`);
  }

  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${baseOpfMeta(bookId, a.title, a.author, a.lang, now)}
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifestItems.join("\n")}
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`);

  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="cover.xhtml">封面</a></li>
${navGroups.join("\n")}
    </ol>
  </nav>
</body>
</html>`);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(a.output, buffer);
  console.log(`Omnibus EPUB generated: ${a.output}`);
  console.log(`Size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Volumes: ${perVolume.length}, total pages: ${perVolume.reduce((s, v) => s + v.files.length, 0)}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Smoke-test single-volume mode is unchanged**

Run: `bun test .claude/skills/`
Expected: PASS — including any pre-existing single-volume tests; no regressions in `output/zhouwu-yuehao` workflow (manual eyeball if no test exists).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/picture-book-creator/scripts/generate-epub.ts \
        .claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts
git commit -m "feat(epub-omnibus): add --omnibus mode that merges multiple volumes into one EPUB"
```

---

## Task 7: `series-bible-creator` skill

**Files:**
- Create: `.claude/skills/series-bible-creator/SKILL.md`
- Create: `.claude/skills/series-bible-creator/references/bible-templates.md`
- Create: `.claude/skills/series-bible-creator/scripts/test/fixtures/series-meta.md`
- Create: `.claude/skills/series-bible-creator/scripts/series-meta-parse.ts`
- Create: `.claude/skills/series-bible-creator/scripts/series-meta-parse.test.ts`

This skill is the entry point for "建系列 / create a series". It writes the frozen Bible (`world.md`, `characters.md`, `style.md`, `portraits/*.png`, `series-meta.md`) and registers `bible.frozen_at` in `state.json`.

The SKILL.md is the **operational contract** read by Claude at runtime — it must declare triggers, prerequisites, the 6-step flow from spec §5.1, and the output schema. The supporting `references/bible-templates.md` holds copy-pasteable Markdown templates so the skill body stays short.

The unit-testable code in this task is just the `series-meta.md` frontmatter parser (other files use templates parsed/written by Claude in-flight, not by scripts).

- [ ] **Step 1: Write the failing test**

```typescript
// .claude/skills/series-bible-creator/scripts/series-meta-parse.test.ts
import { describe, test, expect } from "bun:test";
import { parseSeriesMeta } from "./series-meta-parse";

const SAMPLE = `---
slug: xiaoxiong-mianbaofang
title: 小熊面包房的故事
title_en: The Bear's Bakery
age_range: 4-6
language: zh
genre: 治愈 / 日常生活
series_scale: medium
typical_pages_per_volume: 12
education_goals:
  - 学会等待
  - 认识团队合作
taboos:
  - 不出现现实人类
created_at: 2026-05-14T08:30:00Z
---

# 系列概述

一段散文形式的整体介绍。
`;

describe("parseSeriesMeta", () => {
  test("parses scalar fields", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.slug).toBe("xiaoxiong-mianbaofang");
    expect(m.title).toBe("小熊面包房的故事");
    expect(m.age_range).toBe("4-6");
    expect(m.language).toBe("zh");
    expect(m.series_scale).toBe("medium");
    expect(m.typical_pages_per_volume).toBe(12);
  });

  test("parses list fields", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.education_goals).toEqual(["学会等待", "认识团队合作"]);
    expect(m.taboos).toEqual(["不出现现实人类"]);
  });

  test("captures markdown body after frontmatter", () => {
    const m = parseSeriesMeta(SAMPLE);
    expect(m.body).toContain("# 系列概述");
    expect(m.body).toContain("一段散文形式的整体介绍。");
  });

  test("rejects missing required field 'slug'", () => {
    const bad = SAMPLE.replace(/slug:.*\n/, "");
    expect(() => parseSeriesMeta(bad)).toThrow(/slug/);
  });

  test("rejects invalid series_scale", () => {
    const bad = SAMPLE.replace("series_scale: medium", "series_scale: huge");
    expect(() => parseSeriesMeta(bad)).toThrow(/series_scale/);
  });

  test("rejects missing frontmatter", () => {
    expect(() => parseSeriesMeta("# just markdown\n")).toThrow(/frontmatter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .claude/skills/series-bible-creator/scripts/series-meta-parse.test.ts`
Expected: FAIL — `Cannot find module './series-meta-parse'`

- [ ] **Step 3: Implement series-meta-parse.ts**

```typescript
// .claude/skills/series-bible-creator/scripts/series-meta-parse.ts

export type SeriesScale = "short" | "medium" | "long";

export interface SeriesMeta {
  slug: string;
  title: string;
  title_en?: string;
  age_range: string;
  language: string;
  genre: string;
  series_scale: SeriesScale;
  typical_pages_per_volume: number;
  education_goals: string[];
  taboos: string[];
  created_at: string;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const REQUIRED = ["slug", "title", "age_range", "language", "genre", "series_scale", "typical_pages_per_volume", "created_at"] as const;

export function parseSeriesMeta(text: string): SeriesMeta {
  const m = text.match(FRONTMATTER_RE);
  if (!m) throw new Error("series-meta missing YAML frontmatter");
  const yaml = parseSimpleYaml(m[1]!);
  const body = m[2] ?? "";

  for (const k of REQUIRED) {
    if (!(k in yaml)) throw new Error(`series-meta missing required field: ${k}`);
  }
  const scale = yaml.series_scale;
  if (scale !== "short" && scale !== "medium" && scale !== "long") {
    throw new Error(`series-meta invalid series_scale "${scale}" (allowed: short|medium|long)`);
  }

  return {
    slug: String(yaml.slug),
    title: String(yaml.title),
    title_en: yaml.title_en !== undefined ? String(yaml.title_en) : undefined,
    age_range: String(yaml.age_range),
    language: String(yaml.language),
    genre: String(yaml.genre),
    series_scale: scale,
    typical_pages_per_volume: parseInt(String(yaml.typical_pages_per_volume), 10),
    education_goals: Array.isArray(yaml.education_goals) ? yaml.education_goals.map(String) : [],
    taboos: Array.isArray(yaml.taboos) ? yaml.taboos.map(String) : [],
    created_at: String(yaml.created_at),
    body,
  };
}

/**
 * Minimal YAML subset: scalar `key: value` and list-of-strings (`key:\n  - a\n  - b`).
 * Sufficient for the strict series-meta schema; not a general parser.
 */
function parseSimpleYaml(yaml: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.startsWith("#")) { i++; continue; }
    const scalar = line.match(/^(\w+):\s*(.*)$/);
    if (scalar && scalar[2]!.length > 0) {
      out[scalar[1]!] = scalar[2]!.trim();
      i++;
      continue;
    }
    const listHead = line.match(/^(\w+):\s*$/);
    if (listHead) {
      const key = listHead[1]!;
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s+-\s+/, "").trim());
        i++;
      }
      out[key] = items;
      continue;
    }
    i++;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .claude/skills/series-bible-creator/scripts/series-meta-parse.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the SKILL.md**

Create `.claude/skills/series-bible-creator/SKILL.md` with this exact content:

````markdown
---
name: series-bible-creator
description: |
  连载绘本系列的"圣经"建立 skill。把用户对一个新系列的模糊设想
  转化为可冻结的 World Bible + Character Bible（含 voice_profile + prompt_anchor）
  + Style Bible + 角色 portraits。
  当用户说"我想做一个连载绘本"、"建一个绘本系列"、"create a picture book series"、
  "design world bible"、"做一套世界观一致的多册绘本" 时，触发此 skill。
  本 skill 仅写 bible/，不生成任何单册——单册由 series-volume-creator 负责。
---

# Series Bible Creator

把用户的连载绘本想法 → 一份**冻结的、跨册共享的**资产包，作为后续 Season Planner 与
Volume Creator 的唯一事实来源。

## When to Use

- 用户首次提出做一个**连载/系列绘本**
- 用户想为已有的单本扩展成系列（先把单本的角色/世界提炼为 Bible）

## When NOT to Use

- 已存在 `series-output/<slug>/bible/` 且 `state.json` 中 `bible.frozen_at != null`
  → 跳过本 skill，直接调 series-season-planner
- 单本绘本（无连载意图）→ 用 picture-book-creator

## Output Layout

```
series-output/<slug>/
├── state.json                       ← 创建/更新 bible.frozen_at
└── bible/
    ├── series-meta.md               ← 系列卡片（schema 见 spec §4.3）
    ├── world.md                     ← 复用 novel-output/.../world.md frontmatter
    ├── characters.md                ← 含 voice_profile + prompt_anchor (英文)
    ├── style.md                     ← Prompt 前缀 + 调色板
    └── portraits/
        ├── <角色1>.png              ← 1024×1024 正面参考图
        └── <角色1>.meta.json        ← 生图 prompt + 时间戳
```

## Flow (6 steps)

### Step 1 — 系列定位收集

只在缺信息时问。需收集（参见 spec §4.3）:
- 系列 slug（kebab-case，用于目录名）
- 系列中文/英文标题
- 目标年龄段（0-2/2-4/4-6/6-8）
- 主语言
- 体裁 / 题材
- 规模档位：`short` (≈6 册) / `medium` (≈12 册) / `long` (24+ 册)
- `typical_pages_per_volume`（默认 12，单册可在 8-20 间调整）
- 教育目标列表（可空）
- 禁忌清单（可空）

写出 `series-output/<slug>/bible/series-meta.md`（schema 见 spec §4.3）。

### Step 2 — World Bible

复用 `novel-output/.../world.md` 的 frontmatter 格式（已验证）。
关键字段：时空设定、地理结构、社会结构、关键设定（不超过 3 条）、风格关键词。

写出 `bible/world.md` → **暂停 / 用户审阅**。

### Step 3 — Character Bible

为每个长期角色输出 character card（复用 `novel-output/.../characters.md` 格式）。
**必填字段：**
- 物种 / 体型 / 外貌 / 服装 / 标志性特征
- `prompt_anchor`：英文一段话，长期不变；这是后续每页生图角色一致性的关键。
  例如：`A small white bear cub, round body, head-to-body 1:1.5, dark
  beady eyes, pink nose, wearing a cream linen apron with a tiny bear-paw
  embroidery on the chest pocket.`
- `voice_profile`：edge-tts voice 名 + rate/pitch（全系列锁定，第一册有声后不再换）
- `appearance`：详细外观叙述（中文）
- `negative`：绝不出现的特征（如"不要尖牙、不要现代服装"）

写出 `bible/characters.md` → **暂停 / 用户审阅**。

校验：每个角色的 `prompt_anchor` 字段非空且为英文。

### Step 4 — Style Bible

输出风格设定卡（复用 `novel-output/.../style.md` 格式）：
- `style_prompt`（英文 prompt 前缀，用于每页拼接）
- `color_palette`：主色 + 辅色 + 强调色（含 hex）
- `negative_prompt`（英文负面）
- `character_anchor_index`：本系列所有 `prompt_anchor` 的速查表（去重后的引用，方便 volume-creator 读取）

写出 `bible/style.md` → **暂停 / 用户审阅**。

### Step 5 — Portraits 并行生成

为 `characters.md` 中的每个角色生成一张正面参考图：
- 调用 `image-generation` skill（一次一图）
- Prompt = `bible/style.md` 的 `style_prompt` + 角色 `prompt_anchor` + "neutral pose, neutral expression, plain background, full body view"
- `--ratio 1:1`，`--size 1024x1024`
- 输出到 `bible/portraits/<角色>.png`
- 写 `bible/portraits/<角色>.meta.json`：`{ prompt, model, generated_at, anchor_hash: <prompt_anchor 的 sha256 前 8 位> }`
- 并发上限 4

完成后 → **硬闸门审阅**：用户必须逐个确认每张 portrait。
不通过 → 回 Step 3 改 `prompt_anchor` 重做整张（不允许"用别的图代替")。

### Step 6 — Bible Freeze

更新 `state.json`：
```jsonc
{
  "bible": { "version": 1, "frozen_at": "<now ISO>" }
}
```

使用 `scripts/lib/state.ts` 的 `updateState(seriesRoot, (s) => { s.bible = { version: 1, frozen_at: new Date().toISOString() }; })`（Task 1 提供的原子更新）。

冻结后输出指引：
```
✅ Series Bible 已冻结 (v1)
📂 series-output/<slug>/bible/
下一步：
  • 规划本季弧线 → 召唤 series-season-planner
  • 直接做一本不属于任何季的游离册 → 召唤 series-volume-creator --no-season
```

## Cross-Skill Contract (我产出的文件 schema)

下游 skill 依赖以下文件且**永不修改**它们（除非走未来的 Bible 修订流程）：

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `bible/series-meta.md` | season-planner, volume-creator, omnibus-packager | slug, title, age_range, language, typical_pages_per_volume |
| `bible/world.md` | season-planner, volume-creator | 时空、地理、社会结构、风格关键词 |
| `bible/characters.md` | volume-creator (生图+有声), season-planner (角色清单) | `prompt_anchor` (英文，原样复制), `voice_profile` |
| `bible/style.md` | volume-creator | `style_prompt`, `negative_prompt`, `color_palette` |
| `bible/portraits/<n>.png` + `.meta.json` | volume-creator (视觉参考) | `anchor_hash` 用于检测 anchor 漂移 |

## Common Mistakes

- **修改已冻结的 bible/**：禁止；如需修订请走 v2 流程（本期不做）
- **prompt_anchor 写中文**：图像模型对英文锚定语义更稳定，必须英文
- **portraits 用其他角度**：必须正面、中性表情、纯背景，便于 volume-creator 的每页参考
- **跳过 Step 5 用户审阅**：portraits 是跨册一致性的最早 ground truth；漂了就全系列漂

## Implementation

- 解析 `series-meta.md`：`scripts/series-meta-parse.ts`（含单测）
- 模板：`references/bible-templates.md`（拷贝即用的 markdown 骨架）
- state 写入：复用 `series-bible-creator/scripts/lib/state.ts`（Task 1）
- portraits 生图：调用 `image-generation` skill，不写新脚本
````

- [ ] **Step 6: Write fixtures + reference templates**

Create `.claude/skills/series-bible-creator/scripts/test/fixtures/series-meta.md` — copy the `SAMPLE` constant body from the test (frontmatter + `# 系列概述` body).

Create `.claude/skills/series-bible-creator/references/bible-templates.md` containing four labeled markdown templates the skill body references:

- `### Template: series-meta.md` — frontmatter from spec §4.3 with placeholders like `<slug>`, `<title>`, `<age_range>`, etc.
- `### Template: world.md` — copy frontmatter shape from `novel-output/2026-05-13-chuzuche-zijiayou/world.md`
- `### Template: characters.md` — copy from same novel-output file with `prompt_anchor`/`voice_profile`/`appearance`/`negative` placeholders
- `### Template: style.md` — copy from same novel-output's style file

(The reference doc is mostly inert text; no test needed. The skill prompt instructs Claude to copy + fill.)

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/series-bible-creator/
git commit -m "feat(series-bible): SKILL.md, series-meta parser, templates, fixtures"
```

---

## Task 8: `series-season-planner` skill

**Files:**
- Create: `.claude/skills/series-season-planner/SKILL.md`
- Create: `.claude/skills/series-season-planner/scripts/season-arc-parse.ts`
- Create: `.claude/skills/series-season-planner/scripts/season-arc-parse.test.ts`
- Create: `.claude/skills/series-season-planner/scripts/test/fixtures/mini-bible/` (sub-tree)

This skill takes a frozen Bible and produces one season's `season-arc.md` + `volumes-outline.md`. Outline parser/serializer (`outline-parse.ts`) was already built in Task 2; this task adds the season-arc parser and the SKILL.md.

The season-arc parser is needed so the skill can detect "the previous season's foreshadowing" (last `# 给下一季的伏笔` block) when planning a sequel season — per spec §5.2 "Step 1 主动询问'是否承接上季伏笔'".

- [ ] **Step 1: Write the failing test**

```typescript
// .claude/skills/series-season-planner/scripts/season-arc-parse.test.ts
import { describe, test, expect } from "bun:test";
import { parseSeasonArc } from "./season-arc-parse";

const SAMPLE = `---
season_id: s1
title: 第一季：开张啦
volumes_planned: 6
opening_state: 主角小熊刚搬进新城,面包房还没招牌
ending_state: 小熊学会让顾客等待中的小欢喜
key_turn_points:
  - volume: s1v3
    event: 第一次面包烤糊但顾客反而喜欢
  - volume: s1v5
    event: 邻居老猫给小熊送来祖传食谱
new_characters:
  - 老猫先生（s1v5 出现）
arc_locked: true
---

# 季弧线叙述

散文形式叙述本季成长主线。

# 给下一季的伏笔

- 老猫先生临别提到"北边的小狐狸面包师"
- 小熊还没学会做生日蛋糕
`;

describe("parseSeasonArc", () => {
  test("parses scalar frontmatter", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.season_id).toBe("s1");
    expect(a.title).toBe("第一季：开张啦");
    expect(a.volumes_planned).toBe(6);
    expect(a.arc_locked).toBe(true);
  });

  test("parses key_turn_points as list of {volume, event}", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.key_turn_points).toHaveLength(2);
    expect(a.key_turn_points[0]).toEqual({ volume: "s1v3", event: "第一次面包烤糊但顾客反而喜欢" });
    expect(a.key_turn_points[1]).toEqual({ volume: "s1v5", event: "邻居老猫给小熊送来祖传食谱" });
  });

  test("parses new_characters as string list", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.new_characters).toEqual(["老猫先生（s1v5 出现）"]);
  });

  test("captures '给下一季的伏笔' bullets as foreshadowing array", () => {
    const a = parseSeasonArc(SAMPLE);
    expect(a.foreshadowing_for_next_season).toEqual([
      `老猫先生临别提到"北边的小狐狸面包师"`,
      "小熊还没学会做生日蛋糕",
    ]);
  });

  test("foreshadowing is empty when section missing", () => {
    const noFore = SAMPLE.replace(/# 给下一季的伏笔[\s\S]*$/, "");
    const a = parseSeasonArc(noFore);
    expect(a.foreshadowing_for_next_season).toEqual([]);
  });

  test("rejects missing frontmatter", () => {
    expect(() => parseSeasonArc("# bare\n")).toThrow(/frontmatter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .claude/skills/series-season-planner/scripts/season-arc-parse.test.ts`
Expected: FAIL — `Cannot find module './season-arc-parse'`

- [ ] **Step 3: Implement season-arc-parse.ts**

```typescript
// .claude/skills/series-season-planner/scripts/season-arc-parse.ts

export interface KeyTurnPoint {
  volume: string;
  event: string;
}

export interface SeasonArc {
  season_id: string;
  title: string;
  volumes_planned: number;
  opening_state: string;
  ending_state: string;
  key_turn_points: KeyTurnPoint[];
  new_characters: string[];
  arc_locked: boolean;
  body: string;
  foreshadowing_for_next_season: string[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseSeasonArc(text: string): SeasonArc {
  const m = text.match(FRONTMATTER_RE);
  if (!m) throw new Error("season-arc missing YAML frontmatter");
  const body = m[2] ?? "";
  const yaml = parseYaml(m[1]!);

  return {
    season_id: String(yaml.scalar.season_id ?? ""),
    title: String(yaml.scalar.title ?? ""),
    volumes_planned: parseInt(String(yaml.scalar.volumes_planned ?? "0"), 10),
    opening_state: String(yaml.scalar.opening_state ?? ""),
    ending_state: String(yaml.scalar.ending_state ?? ""),
    arc_locked: String(yaml.scalar.arc_locked ?? "false") === "true",
    key_turn_points: yaml.objectLists.key_turn_points ?? [],
    new_characters: yaml.stringLists.new_characters ?? [],
    body,
    foreshadowing_for_next_season: extractForeshadowing(body),
  };
}

interface ParsedYaml {
  scalar: Record<string, string>;
  stringLists: Record<string, string[]>;
  objectLists: Record<string, KeyTurnPoint[]>;
}

/**
 * Subset YAML supporting:
 *  - `key: scalar`
 *  - `key:\n  - string item\n  - ...`
 *  - `key:\n  - inner_key: v\n    inner_key2: v\n  - ...`
 */
function parseYaml(yaml: string): ParsedYaml {
  const out: ParsedYaml = { scalar: {}, stringLists: {}, objectLists: {} };
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "" || line.startsWith("#")) { i++; continue; }
    const scalar = line.match(/^(\w+):\s*(.+)$/);
    if (scalar) {
      out.scalar[scalar[1]!] = scalar[2]!.trim();
      i++;
      continue;
    }
    const head = line.match(/^(\w+):\s*$/);
    if (head) {
      const key = head[1]!;
      i++;
      // Decide string-list vs object-list by looking at the first item.
      if (i >= lines.length || !/^\s+-\s+/.test(lines[i]!)) {
        // empty list
        out.stringLists[key] = [];
        continue;
      }
      const firstItem = lines[i]!.replace(/^\s+-\s+/, "");
      if (firstItem.match(/^\w+:\s*.+/)) {
        // object list
        const items: KeyTurnPoint[] = [];
        while (i < lines.length && /^\s+-\s+/.test(lines[i]!)) {
          const obj: Record<string, string> = {};
          const headLine = lines[i]!.replace(/^\s+-\s+/, "");
          const headField = headLine.match(/^(\w+):\s*(.+)$/);
          if (headField) obj[headField[1]!] = headField[2]!.trim();
          i++;
          while (i < lines.length && /^\s{4,}\w+:\s*.+$/.test(lines[i]!)) {
            const f = lines[i]!.trim().match(/^(\w+):\s*(.+)$/)!;
            obj[f[1]!] = f[2]!.trim();
            i++;
          }
          items.push({ volume: obj.volume ?? "", event: obj.event ?? "" });
        }
        out.objectLists[key] = items;
      } else {
        // string list
        const items: string[] = [];
        while (i < lines.length && /^\s+-\s+/.test(lines[i]!)) {
          items.push(lines[i]!.replace(/^\s+-\s+/, "").trim());
          i++;
        }
        out.stringLists[key] = items;
      }
      continue;
    }
    i++;
  }
  return out;
}

function extractForeshadowing(body: string): string[] {
  const re = /^# 给下一季的伏笔\s*$/m;
  const m = body.match(re);
  if (!m) return [];
  const start = body.indexOf(m[0]) + m[0].length;
  const after = body.slice(start);
  // Up to next H1 or end.
  const nextH1 = after.search(/^# /m);
  const block = nextH1 === -1 ? after : after.slice(0, nextH1);
  const items: string[] = [];
  for (const line of block.split("\n")) {
    const li = line.match(/^\s*-\s+(.+)$/);
    if (li) items.push(li[1]!.trim());
  }
  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .claude/skills/series-season-planner/scripts/season-arc-parse.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the SKILL.md**

Create `.claude/skills/series-season-planner/SKILL.md`:

````markdown
---
name: series-season-planner
description: |
  连载绘本"季"的规划 skill。基于已冻结的 Series Bible，为某一季产出
  季弧线（season-arc.md）和分册大纲（volumes-outline.md）。
  当用户说"规划第 N 季"、"plan season 2"、"列出本季要做的几册"、
  "design this season's arc" 时，触发此 skill。
  本 skill 不生成单册——单册由 series-volume-creator 负责。
---

# Series Season Planner

为某一季产出可被 volume-creator 直接消费的"季蓝图"。

## When to Use

- Bible 已冻结（`state.json` 中 `bible.frozen_at != null`），用户要规划某一季
- 用户已经做了若干游离册（standalone-N），想"把它们整理成一季"——可读取已存在的 standalone metadata 作为参考

## When NOT to Use

- Bible 未冻结 → 报错并提示先跑 series-bible-creator
- 用户只想做一本游离册（不属于任何季）→ 直接调 series-volume-creator --no-season

## Output Layout

```
series-output/<slug>/
├── state.json                           ← 更新 seasons[<id>]
└── seasons/<id>/
    ├── season-arc.md                    ← spec §4.4
    └── volumes-outline.md               ← spec §4.5
```

## Flow (5 steps)

### Step 0 — 上下文加载

读 `state.json`（用 `series-bible-creator/scripts/lib/state.ts` 的 `loadState`）。
- 报告：当前 Bible 版本、已存在的 season 列表（含 arc_locked 状态）、各册 phase 计数。
- 若用户给的 season-id 已存在且 `arc_locked=true` → 询问是覆盖（生成 revision +1）还是退出。

### Step 1 — 本季定位收集

需收集：
- season-id（默认 `s<下一序号>`）
- 季标题
- volumes_planned（参考 series-meta.typical_pages_per_volume × 本季册数）
- 是否承接上季伏笔：若上季 `season-arc.md` 存在，调用 `parseSeasonArc` 提取
  `foreshadowing_for_next_season` 列出来让用户勾选哪些回收。

### Step 2 — 生成 season-arc.md

按 spec §4.4 的 schema 写出，包含：
- 季弧线散文（成长主线）
- `# 给下一季的伏笔` 段（即使是末季也写——可后续被 omnibus 包装时省略）

→ **暂停 / 用户审阅**

### Step 3 — 生成 volumes-outline.md

按 spec §4.5 的 schema 为每册写一段：
```
## <vid> <册名>

- beat: 开篇/递进/转折/高潮/落幕
- pov: ...
- summary: 1-2 句
- characters: [...]
- planned_pages: <int>
- mood: ...
```

使用 `outline-parse.ts` 的 `serializeOutline()` 写出，保证后续 `parseOutline` 可读。

→ **暂停 / 用户审阅**

### Step 4 — 可制作性自检

自动检查（在 SKILL.md 内逐项执行 + 报告）：
- 标题去重：每册标题不重复
- 弧线递进：beat 序列符合"开篇 → 递进 ×N → 转折 → 高潮 → 落幕"模式
- 角色覆盖：所有 `key_turn_points[*].volume` 在 outline 中存在
- 新角色提示：`new_characters` 中提到的角色，若不在 Bible characters.md，提示
  "需先回 series-bible-creator 追加角色卡"
- 字数：每册 summary 不超过 100 字

不通过项 → **直接修改** outline，重新检查；全部通过 → 报告。

### Step 5 — Season Arc Lock

调 `updateState` 写入：
```jsonc
{
  "seasons": {
    "<id>": {
      "title": "...",
      "volumes_planned": <n>,
      "arc_locked": true,
      "started_at": "<now ISO>",
      "outline_revision": 1
    }
  }
}
```

输出指引：
```
✅ 第 <N> 季弧线锁定 (revision 1)
📂 series-output/<slug>/seasons/<id>/
下一步：召唤 series-volume-creator 做第一册
```

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `seasons/<id>/season-arc.md` | volume-creator | opening/ending state, key_turn_points, new_characters |
| `seasons/<id>/volumes-outline.md` | volume-creator (按册取); season-planner 自身（回写 planned_pages 与 revision） | 每册 beat/pov/summary/characters/planned_pages/mood |

volume-creator 在生成单册结束时若实际页数偏离 `planned_pages`，**必须**用
`outline-parse.ts` 的 `parseOutline + serializeOutline` 回写并 `outline_revision++`，
本 skill 在下次执行时会读取最新 revision。

## Common Mistakes

- **跳过 Step 4 自检**：弧线缺角色或重复标题 → 后续 volume-creator 卡死
- **手写 outline 而不调 serializeOutline**：会导致解析失败，下游报错
- **跨季强行加新角色而不回 bible-creator**：当前期不支持 Bible 修订；新角色应作为
  "Season-Local Character" 注释写在 outline 里，但 prompt_anchor 仍需走 bible 流程

## Implementation

- season-arc 解析：`scripts/season-arc-parse.ts`（含单测）
- outline 解析+序列化：复用 `series-season-planner/scripts/outline-parse.ts`（Task 2）
- state 更新：复用 `series-bible-creator/scripts/lib/state.ts`（Task 1）
````

- [ ] **Step 6: Write fixtures**

Create `.claude/skills/series-season-planner/scripts/test/fixtures/mini-bible/`:
- `state.json` — minimal state with `bible.frozen_at` set, no seasons yet
- `bible/series-meta.md` — copy of fixture from Task 7
- `bible/world.md`, `bible/characters.md`, `bible/style.md` — one-paragraph minimal versions
- `bible/portraits/main.png` — 1×1 placeholder PNG (base64 from Task 6 test)

This fixture becomes the input for the e2e smoke test in Task 11.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/series-season-planner/
git commit -m "feat(series-season): SKILL.md, season-arc parser, mini-bible fixture"
```

---

## Task 9: `series-volume-creator` skill

**Files:**
- Create: `.claude/skills/series-volume-creator/SKILL.md`
- Create: `.claude/skills/series-volume-creator/scripts/load-context.ts`
- Create: `.claude/skills/series-volume-creator/scripts/load-context.test.ts`
- Create: `.claude/skills/series-volume-creator/scripts/verify-pages.ts`
- Create: `.claude/skills/series-volume-creator/scripts/verify-pages.test.ts`

This is the **orchestration** skill. It binds together: the state helper (Task 1), the outline parser (Task 2), the prompt composer (Task 3), the retry parser (Task 4), and the existing `image-generation`, `picture-book-creator/scripts/generate-epub.ts`, `audio-picture-book-creator` skills.

The two new scripts are pure I/O / pure logic helpers:
- `load-context.ts` — given `seriesRoot + volumeId`, loads Bible + season + outline entry + (optional) volume patch, returns a typed `VolumeContext`. Pure I/O composition; test verifies it errors on missing prereqs.
- `verify-pages.ts` — checks `volumes/<id>/<n>.png` for each page index, returns `{ ok: number[]; failed: { page: number; reason: string }[] }`. Used by Step 6.3 verification.

- [ ] **Step 1: Write the failing tests for load-context**

```typescript
// .claude/skills/series-volume-creator/scripts/load-context.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadVolumeContext } from "./load-context";

let root: string;
let seriesRoot: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vol-ctx-"));
  seriesRoot = join(root, "demo");
  await mkdir(join(seriesRoot, "bible"), { recursive: true });
  await mkdir(join(seriesRoot, "seasons", "s1"), { recursive: true });

  await writeFile(join(seriesRoot, "state.json"),
    JSON.stringify({
      version: 1, series_slug: "demo", title: "Demo",
      created_at: "2026-05-14T00:00:00Z",
      bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
      seasons: { s1: { title: "S1", volumes_planned: 2, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 } },
      volumes: {}, omnibus: [],
    }, null, 2));
  await writeFile(join(seriesRoot, "bible", "series-meta.md"),
    `---\nslug: demo\ntitle: Demo\nage_range: 4-6\nlanguage: zh\ngenre: test\nseries_scale: short\ntypical_pages_per_volume: 10\ncreated_at: 2026-05-14T00:00:00Z\n---\n# meta\n`);
  await writeFile(join(seriesRoot, "bible", "world.md"), "# world\nminimal\n");
  await writeFile(join(seriesRoot, "bible", "characters.md"),
    `# 角色\n## 小熊\n- prompt_anchor: A small white bear cub.\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
  await writeFile(join(seriesRoot, "bible", "style.md"),
    `# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"),
    `---\nseason_id: s1\nrevision: 1\n---\n\n## s1v1 first volume\n\n- beat: 开篇\n- pov: 小熊\n- summary: a short summary.\n- characters: [小熊]\n- planned_pages: 10\n- mood: 温暖\n\n## s1v2 second volume\n\n- beat: 递进\n- pov: 小熊\n- summary: another summary.\n- characters: [小熊]\n- planned_pages: 12\n- mood: 期待\n`);
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("loadVolumeContext", () => {
  test("loads bible + outline entry + season for an in-season volume", async () => {
    const ctx = await loadVolumeContext(seriesRoot, "s1v1");
    expect(ctx.meta.slug).toBe("demo");
    expect(ctx.season?.id).toBe("s1");
    expect(ctx.outlineEntry?.title).toBe("first volume");
    expect(ctx.outlineEntry?.planned_pages).toBe(10);
    expect(ctx.characters.size).toBeGreaterThan(0);
    expect(ctx.style).toContain("warm pastel watercolor");
    expect(ctx.patch).toBeNull();
  });

  test("loads patch when characters-patch.md exists in volume dir", async () => {
    await mkdir(join(seriesRoot, "volumes", "s1v1"), { recursive: true });
    await writeFile(join(seriesRoot, "volumes", "s1v1", "characters-patch.md"),
      `---\nvolume_id: s1v1\napplies_to: 本册全部页\n---\n## 小熊\n- 追加锚定: wearing a flour-dusted apron\n`);
    const ctx = await loadVolumeContext(seriesRoot, "s1v1");
    expect(ctx.patch).not.toBeNull();
    expect(ctx.patch!.get("小熊")).toContain("flour-dusted apron");
  });

  test("supports standalone volume (--no-season) with no outline entry", async () => {
    await mkdir(join(seriesRoot, "volumes", "standalone-001"), { recursive: true });
    const ctx = await loadVolumeContext(seriesRoot, "standalone-001");
    expect(ctx.season).toBeNull();
    expect(ctx.outlineEntry).toBeNull();
  });

  test("throws when bible.frozen_at is null", async () => {
    const unfrozen = await mkdtemp(join(tmpdir(), "unfrozen-"));
    await writeFile(join(unfrozen, "state.json"),
      JSON.stringify({ version: 1, series_slug: "x", title: "x", created_at: "", bible: { version: 0, frozen_at: null }, seasons: {}, volumes: {}, omnibus: [] }));
    await expect(loadVolumeContext(unfrozen, "s1v1")).rejects.toThrow(/bible.*not frozen/i);
    await rm(unfrozen, { recursive: true, force: true });
  });

  test("throws on unknown volume in a known season (outline missing entry)", async () => {
    await expect(loadVolumeContext(seriesRoot, "s1v9")).rejects.toThrow(/s1v9/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test .claude/skills/series-volume-creator/scripts/load-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement load-context.ts**

```typescript
// .claude/skills/series-volume-creator/scripts/load-context.ts
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { loadState } from "../../series-bible-creator/scripts/lib/state";
import { parseSeriesMeta, type SeriesMeta } from "../../series-bible-creator/scripts/series-meta-parse";
import { parseOutline, type OutlineVolume } from "../../series-season-planner/scripts/outline-parse";

export interface VolumeContext {
  seriesRoot: string;
  volumeId: string;
  meta: SeriesMeta;
  world: string;                            // raw markdown
  style: string;                            // raw markdown (composer reads keys from it)
  characters: Map<string, CharacterCard>;   // by name
  season: { id: string; arcMd: string } | null;
  outlineEntry: OutlineVolume | null;
  patch: Map<string, string> | null;        // patch anchors keyed by character name
}

export interface CharacterCard {
  name: string;
  prompt_anchor: string;
  voice_profile?: string;
  appearance?: string;
  negative?: string;
  raw: string;
}

export async function loadVolumeContext(seriesRoot: string, volumeId: string): Promise<VolumeContext> {
  const state = await loadState(seriesRoot);
  if (!state.bible.frozen_at) throw new Error("Series bible is not frozen — run series-bible-creator first");

  const meta = parseSeriesMeta(await readFile(join(seriesRoot, "bible", "series-meta.md"), "utf-8"));
  const world = await readFile(join(seriesRoot, "bible", "world.md"), "utf-8");
  const style = await readFile(join(seriesRoot, "bible", "style.md"), "utf-8");
  const charactersMd = await readFile(join(seriesRoot, "bible", "characters.md"), "utf-8");
  const characters = parseCharacters(charactersMd);

  // Resolve season + outline entry.
  let season: VolumeContext["season"] = null;
  let outlineEntry: OutlineVolume | null = null;

  // Volume id pattern "sNvM" → season "sN".
  const m = volumeId.match(/^(s\d+)v\d+$/);
  if (m) {
    const seasonId = m[1]!;
    if (!(seasonId in state.seasons)) {
      throw new Error(`volume ${volumeId} references unknown season ${seasonId}`);
    }
    const arcPath = join(seriesRoot, "seasons", seasonId, "season-arc.md");
    const outlinePath = join(seriesRoot, "seasons", seasonId, "volumes-outline.md");
    const arcMd = await readFile(arcPath, "utf-8");
    const outline = parseOutline(await readFile(outlinePath, "utf-8"));
    const entry = outline.volumes.find((v) => v.id === volumeId);
    if (!entry) throw new Error(`volume ${volumeId} not found in ${outlinePath}`);
    season = { id: seasonId, arcMd };
    outlineEntry = entry;
  } else if (!/^standalone-\d+$/.test(volumeId)) {
    throw new Error(`unrecognized volume id "${volumeId}" (expected sNvM or standalone-NNN)`);
  }

  // Load patch if present.
  let patch: Map<string, string> | null = null;
  const patchPath = join(seriesRoot, "volumes", volumeId, "characters-patch.md");
  try {
    await stat(patchPath);
    patch = parsePatch(await readFile(patchPath, "utf-8"));
  } catch {
    // no patch
  }

  return { seriesRoot, volumeId, meta, world, style, characters, season, outlineEntry, patch };
}

function parseCharacters(md: string): Map<string, CharacterCard> {
  const out = new Map<string, CharacterCard>();
  // Each character starts with "## <name>".
  const sections = md.split(/^(?=## )/m).filter((s) => s.trim().length > 0);
  for (const sec of sections) {
    const head = sec.match(/^## (.+)$/m);
    if (!head) continue;
    const name = head[1]!.trim();
    if (name === "角色") continue; // top-level "# 角色" already split off
    const anchor = field(sec, "prompt_anchor");
    if (!anchor) continue; // must have anchor to be usable
    out.set(name, {
      name,
      prompt_anchor: anchor,
      voice_profile: field(sec, "voice_profile"),
      appearance: field(sec, "appearance"),
      negative: field(sec, "negative"),
      raw: sec,
    });
  }
  return out;
}

function parsePatch(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const sections = md.split(/^(?=## )/m).filter((s) => s.trim().length > 0);
  for (const sec of sections) {
    const head = sec.match(/^## (.+)$/m);
    if (!head) continue;
    const name = head[1]!.trim();
    const append = sec.match(/^- 追加锚定:\s*(.+)$/m);
    if (append) out.set(name, append[1]!.trim());
  }
  return out;
}

function field(section: string, key: string): string | undefined {
  const re = new RegExp(`^- ${key}:\\s*(.+)$`, "m");
  const m = section.match(re);
  return m ? m[1]!.trim() : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test .claude/skills/series-volume-creator/scripts/load-context.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Write the failing test for verify-pages**

```typescript
// .claude/skills/series-volume-creator/scripts/verify-pages.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { verifyPages } from "./verify-pages";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);
// Real-ish 110KB filler so it passes the >100KB threshold.
const BIG_PNG = Buffer.concat([TINY_PNG, Buffer.alloc(110_000)]);

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "verify-pages-"));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "0.png"), BIG_PNG);  // ok
  await writeFile(join(root, "1.png"), BIG_PNG);  // ok
  await writeFile(join(root, "2.png"), TINY_PNG); // too small
  // page 3 missing
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("verifyPages", () => {
  test("flags missing page", async () => {
    const r = await verifyPages(root, 4);
    expect(r.ok).toContain(0);
    expect(r.ok).toContain(1);
    expect(r.failed.find((f) => f.page === 3)?.reason).toMatch(/missing/i);
  });
  test("flags too-small page (<100KB)", async () => {
    const r = await verifyPages(root, 4);
    expect(r.failed.find((f) => f.page === 2)?.reason).toMatch(/too small/i);
  });
  test("ok pages excluded from failed list", async () => {
    const r = await verifyPages(root, 2);
    expect(r.ok).toEqual([0, 1]);
    expect(r.failed).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test .claude/skills/series-volume-creator/scripts/verify-pages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement verify-pages.ts**

```typescript
// .claude/skills/series-volume-creator/scripts/verify-pages.ts
import { stat } from "fs/promises";
import { join } from "path";

const MIN_BYTES = 100 * 1024; // <100KB → suspect failure (per spec §6.3 + parent doc)

export interface VerifyResult {
  ok: number[];
  failed: { page: number; reason: string }[];
}

/** Check that volumeDir/<n>.png exists for n in [0, totalPages] and is >100KB. */
export async function verifyPages(volumeDir: string, totalPages: number): Promise<VerifyResult> {
  const ok: number[] = [];
  const failed: { page: number; reason: string }[] = [];
  for (let n = 0; n < totalPages; n++) {
    const p = join(volumeDir, `${n}.png`);
    try {
      const s = await stat(p);
      if (s.size < MIN_BYTES) {
        failed.push({ page: n, reason: `too small (${s.size} < ${MIN_BYTES} bytes)` });
      } else {
        ok.push(n);
      }
    } catch {
      failed.push({ page: n, reason: "missing file" });
    }
  }
  return { ok, failed };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test .claude/skills/series-volume-creator/scripts/verify-pages.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 9: Write the SKILL.md**

Create `.claude/skills/series-volume-creator/SKILL.md`:

````markdown
---
name: series-volume-creator
description: |
  连载绘本"单册"全流程 skill。从已冻结的 Series Bible + 已锁定的 Season Outline
  出发,做出某一册的脚本、图、静态 EPUB,并自动衔接调 audio-picture-book-creator
  出有声版。
  当用户说"做这个系列的下一册"、"出第 X 册"、"把 outline 第 N 册做出来"、
  "build volume 3"、"做一本游离册" 时,触发此 skill。
  内部调用 image-generation、generate-epub.ts、audio-picture-book-creator,
  本 skill 不重写底层能力。
---

# Series Volume Creator

把"已规划的某一册"做成 packaged + audio 完成态。**全流程仅在 Step 0 与 Step 3 暂停**。

## When to Use

- Bible 已冻结，且要做的册属于某锁定 season 的 outline；OR
- 用户明确要做游离册（`--no-season`），volume id 形如 `standalone-NNN`

## When NOT to Use

- 单本绘本（无系列）→ picture-book-creator
- 系列还没冻结 Bible → series-bible-creator
- 季还没锁 → series-season-planner

## Output Layout

```
series-output/<slug>/volumes/<vid>/
├── script.md                      ← Step 2,复用 picture-book-creator 阶段 3 格式
├── characters-patch.md            ← Step 4,可选
├── prompts/
│   ├── 0.txt                      ← Step 5,本页完整 prompt
│   ├── 1.txt
│   └── ...
├── 0.png ~ N.png                  ← Step 6,1024×1024
├── meta.json                      ← Step 7 末尾写入,spec §4.7
├── <册名>.epub                    ← Step 7
├── <册名>.pdf                     ← Step 7
└── <册名>-audio.epub              ← Step 8
```

## Flow (10 steps; only Step 0 + Step 3 stop)

### Step 0 — 上下文加载 + 目标确认（**唯一启动暂停**）

调用 `scripts/load-context.ts` 的 `loadVolumeContext(seriesRoot, volumeId)`。
- 报告：bible 版本、季信息、本册大纲条目（beat/pov/summary/characters/planned_pages）、
  patch 是否存在
- 要求用户口头确认"开始做 <vid>"或调整 volumeId

### Step 1 — 本册微定位（仅游离册或 outline 不够细时）

游离册（`standalone-NNN`）outline 缺失 → 当场用 picture-book-creator 阶段 1
的提问框架补齐；产物即时写入 `volumes/<vid>/meta.json` 草稿（不写 outline）。

### Step 2 — 分页脚本

完全复用 picture-book-creator 阶段 3 的格式与 reference（`age-standards.md`）。
保存到 `volumes/<vid>/script.md`。

state 登记：调 `updateState` → `volumes[vid] = { season, phase: "drafting" }`。

### Step 3 — 可读性测试（**用户确认必经闸门**）

复用 picture-book-creator 阶段 4 的「可读性校验清单」，自动检查 → 自动修 → 报告。
全部通过后 → 暂停等用户最终确认。
确认后 state 登记 `phase: "scripted"`。

### Step 4 — 角色补丁（默认跳过）

仅当：
- 用户在 Step 0 显式要求；OR
- 脚本中出现 Bible 主锚定不覆盖的关键细节（如"穿围裙第一次出现"）

则按 spec §4.6 写出 `volumes/<vid>/characters-patch.md`。

### Step 5 — 图像 Prompt 生成

对每一页（0 ~ N）调用 `scripts/compose-prompt.ts`（Task 3）的
`composePagePrompt({ ctx, page })`，把返回的字符串写到
`volumes/<vid>/prompts/<n>.txt`。

便于：(a) 用户人工审 prompt；(b) 失败重试时复用同一 prompt 而不重新 LLM 生成。

### Step 6 — 并行生图

按页号 0..N 派发 `image-generation` skill，**每批 4 个并发**。
- 每个 fork 任务的指令字符串：`prompt: <prompts/<n>.txt 内容> | output: volumes/<vid>/<n>.png`
- 必传：`--ratio 1:1 --size 1024x1024`
- **不传** `--size 4K`

#### 6.3 验证

调 `scripts/verify-pages.ts` 的 `verifyPages(volumeDir, totalPages)`。
- 全部 OK → state 登记 `phase: "imaged"`
- 有失败页 → 列出失败页 + reason + `prompts/<n>.txt` 路径，
  接受用户自然语言（"重试 5、9 页" / "改 5 页 prompt 后重试"）。
  - 解析用 `scripts/parse-retry.ts`（Task 4）的 `parseRetrySpec(input, totalPages)`
  - 仅对解析出的页号重新派发 image-generation
- 失败页数 > 50% → 报告 + 退出，不强行继续

### Step 7 — 静态 EPUB + PDF 打包

```bash
bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts \
  --input series-output/<slug>/volumes/<vid> \
  --title "<册名>" \
  --author "<series-meta.author 或默认>" \
  --lang <series-meta.language>
```

PDF 暂走与单本相同流程（如有）。
写出 `volumes/<vid>/meta.json`（spec §4.7），state 登记 `phase: "packaged"`。

### Step 8 — 自动衔接有声 EPUB

调用 `audio-picture-book-creator` skill。给它的输入：
- 静态 EPUB 路径
- voice_profile 来自 `bible/characters.md` 的主角字段（不询问用户）

成功 → state 登记 `audio: true, built_at: <now>`。
失败 → state 登记 `audio: false`，输出"Step 8 失败但 packaged 已完成,可手动重试"，**不**让 Step 7 的成果回滚。

### Step 9 — 登记 + outline 回写

如果实际页数 ≠ outline `planned_pages`：
- 调 `outline-parse.ts` 的 `parseOutline + serializeOutline` 回写
  `seasons/<season>/volumes-outline.md`，更新 `planned_pages` 与
  `outline_revision++`
- 在 state 中写 `volumes[vid].pages = <actual>`

最后输出指引：
```
✅ 第 <N> 册 packaged + audio 完成
📂 series-output/<slug>/volumes/<vid>/
   ├── <册名>.epub
   └── <册名>-audio.epub
下一步：
  • 做下一册 → 继续召唤本 skill
  • 出本季合订本 → 召唤 series-omnibus-packager
```

## 与 picture-book-creator 阶段对照

| picture-book-creator 阶段 | 本 skill 对应 | 关键差异 |
|---|---|---|
| 阶段 1 需求收集 | Step 0 (+ 可选 Step 1) | 大量字段从 Bible/outline 继承 |
| 阶段 2 故事方案（3 选 1） | **删除** | outline 已定梗概 |
| 阶段 3 分页脚本 | Step 2 | 格式相同 |
| 阶段 4 可读性测试 | Step 3 | 完全相同 |
| 阶段 5 角色与风格 | **删除** | Bible 已定 |
| 阶段 6 Prompt + 生图 | Step 5 + 6 | Prompt 来源不同；写死 1024×1024 |
| 阶段 7 EPUB 打包 | Step 7 | 完全相同 |
| (无) | Step 8 自动有声 | 连载独有 |

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `volumes/<vid>/meta.json` | omnibus-packager | volume_id, season, title, pages, outputs.epub |
| `volumes/<vid>/<n>.png` | omnibus-packager | 文件名按 0,1,2,... 严格命名 |
| `volumes/<vid>/<title>.epub` | 用户 | Fixed-Layout EPUB3 |
| `volumes/<vid>/<title>-audio.epub` | 用户 | Media Overlays EPUB3 |

omnibus-packager **不读** script.md / characters-patch.md / prompts/。

## Common Mistakes

- **改写 prompt_anchor**：禁止；compose-prompt 已强制原样复制 Bible 锚定
- **传 `--size 4K`**：连载多册 4K 成本翻倍；只用 1024×1024
- **失败时全部重做**：用 parse-retry 只跑失败页
- **Step 8 失败时回滚 Step 7**：不允许；packaged + audio:false 是合法状态

## Implementation

| 模块 | 路径 | 来源 |
|---|---|---|
| state I/O | `series-bible-creator/scripts/lib/state.ts` | Task 1 |
| outline parser | `series-season-planner/scripts/outline-parse.ts` | Task 2 |
| compose prompt | `series-volume-creator/scripts/compose-prompt.ts` | Task 3 |
| parse retry | `series-volume-creator/scripts/parse-retry.ts` | Task 4 |
| load context | `series-volume-creator/scripts/load-context.ts` | this task |
| verify pages | `series-volume-creator/scripts/verify-pages.ts` | this task |
| EPUB 打包 | `picture-book-creator/scripts/generate-epub.ts` | existing |
| 单图生成 | `image-generation` skill | existing |
| 有声版 | `audio-picture-book-creator` skill | existing |
````

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/series-volume-creator/
git commit -m "feat(series-volume): SKILL.md, load-context, verify-pages helpers + tests"
```

---

## Task 10: `series-omnibus-packager` skill

**Files:**
- Create: `.claude/skills/series-omnibus-packager/SKILL.md`
- Create: `.claude/skills/series-omnibus-packager/scripts/test/fixtures/two-packaged-volumes/` (sub-tree)

The packager is the smallest of the four skills. The range parser (Task 5) and the `generate-epub.ts --omnibus` mode (Task 6) already do the heavy lifting; this skill is mostly orchestration glue documented in SKILL.md plus a fixture for the e2e test.

No new TypeScript code is required — verifying it works happens in the e2e smoke test (Task 11) and through the existing unit tests for parse-range + generate-epub.omnibus.

- [ ] **Step 1: Write the SKILL.md**

Create `.claude/skills/series-omnibus-packager/SKILL.md`:

````markdown
---
name: series-omnibus-packager
description: |
  把一个连载绘本系列里若干已 packaged 的册合并为一本合订 EPUB。
  接受范围:某季 (s1 / 第一季)、全部 (全部 / all)、显式列表 (s1v1,s1v3)。
  当用户说"出第一季合订本"、"把这几册合订"、"package omnibus"、
  "merge volumes 1-5 into one EPUB" 时,触发此 skill。
  本 skill 不重新生图,只重新打包既有 PNG;不出有声合集本。
---

# Series Omnibus Packager

把一组已 packaged 的单册 → 一个 Fixed-Layout EPUB3 合订本。

## When to Use

- 用户已用 series-volume-creator 完成至少 1 册（实际值得合订需 ≥2 册）
- 用户希望把若干册组合成一个文件分享 / 上架

## When NOT to Use

- 还没有任何 `phase=packaged` 的册 → 报错并提示先做单册
- 用户想出有声合集本 → 当前不支持（合集页数过多，audio 任务过重）；保持单册有声

## Output Layout

```
series-output/<slug>/
├── state.json                                 ← 追加 omnibus 条目
└── omnibus/
    └── <slug>-<range>.epub                    ← 例如 demo-s1.epub / demo-all.epub
```

## Flow (4 steps; only Step 0 stops)

### Step 0 — 上下文加载 + 范围确认（**唯一暂停**）

读 `state.json`，把用户输入的范围（季 id / 全部 / 显式列表）传给
`series-omnibus-packager/scripts/parse-range.ts` 的 `parseRange(input, state)`：
- `ids` → 待合订的有序册列表
- `skipped` → 在范围内但未 packaged 的册（连同 reason 报告）
- `warnings` → 例如"omnibus of a single volume"

报告完整解析结果 → 暂停等用户确认（或调整范围）。

### Step 1 — 元信息

- 合订 title 默认 `"<series-meta.title> · <range 描述>"`，例如
  `"小熊面包房的故事 · 第一季"`、`"小熊面包房的故事 · 全集"`
- author 沿用 `series-meta`
- lang 沿用 `series-meta.language`
- 输出路径默认 `series-output/<slug>/omnibus/<slug>-<range-slug>.epub`
  - range-slug：`s1` → `s1`；`全部` → `all`；显式列表 → `vN1-vN2-...`
    （超过 5 册取首末 + 总数：`s1v1-...-s2v3-9vols`）

### Step 2 — 调 generate-epub.ts --omnibus

```bash
bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts \
  --omnibus \
  --series-root series-output/<slug> \
  --volumes "<id1>,<id2>,..." \
  --title "<合订 title>" \
  --author "<author>" \
  --lang <lang> \
  --output omnibus/<slug>-<range-slug>.epub
```

### Step 3 — 登记 + 输出

调 `updateState`：
```jsonc
{
  "omnibus": [...existing, {
    "range": "<range-spec 原文>",
    "built_at": "<now ISO>",
    "file": "omnibus/<slug>-<range-slug>.epub"
  }]
}
```

输出指引：
```
✅ 合订本已生成
📂 series-output/<slug>/omnibus/<slug>-<range-slug>.epub
   合并了 <N> 册（跳过 <M> 册：<原因>）
```

## Cross-Skill Contract (我产出的文件 schema)

| 文件 | 读者 | 关键字段 |
|---|---|---|
| `omnibus/<slug>-<range>.epub` | 用户 | Fixed-Layout EPUB3，每册以 divider XHTML 分隔 |
| `state.json` 中的 `omnibus[]` 条目 | 本 skill 自身 / 用户审计 | range, built_at, file |

## Common Mistakes

- **合订一册**：parse-range 已警告，但仍会成功；建议至少 2 册
- **合订未 packaged 的册**：parse-range 自动跳过并报告，**不**触发生图
- **改名 PNG 文件**：volume-creator 写出的 `<n>.png` 命名是约定的合同，omnibus 直接按编号顺序读
- **想出有声合集本**：本期不支持

## Implementation

| 模块 | 路径 | 来源 |
|---|---|---|
| 范围解析 | `series-omnibus-packager/scripts/parse-range.ts` | Task 5 |
| EPUB 合订 | `picture-book-creator/scripts/generate-epub.ts --omnibus` | Task 6 |
| state I/O | `series-bible-creator/scripts/lib/state.ts` | Task 1 |
````

- [ ] **Step 2: Write fixture for the e2e test in Task 11**

Create `.claude/skills/series-omnibus-packager/scripts/test/fixtures/two-packaged-volumes/` containing:

```
state.json                                  ← bible frozen + 2 packaged volumes
bible/series-meta.md                        ← copy of fixture from Task 7
bible/world.md                              ← 1-paragraph minimal
bible/characters.md                         ← 1 character with prompt_anchor
bible/style.md                              ← minimal
seasons/s1/season-arc.md                    ← minimal valid arc
seasons/s1/volumes-outline.md               ← 2 volumes, both planned_pages=3
volumes/s1v1/0.png ~ 2.png                  ← TINY_PNG fixtures
volumes/s1v1/script.md                      ← matches per-page text
volumes/s1v1/meta.json                      ← spec §4.7
volumes/s1v1/<title>.epub                   ← can be empty placeholder; omnibus doesn't read it
volumes/s1v2/0.png ~ 2.png
volumes/s1v2/script.md
volumes/s1v2/meta.json
volumes/s1v2/<title>.epub
```

`state.json` registers both s1v1 and s1v2 with `phase: "packaged"`.

This fixture is used by Task 11's e2e smoke test to exercise:
1. `parseRange("s1", state)` → returns both volume ids
2. The packager invocation pipes those ids into `generate-epub.ts --omnibus`
3. The resulting EPUB contains both volumes' images and per-volume dividers

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/series-omnibus-packager/
git commit -m "feat(series-omnibus): SKILL.md and two-volume fixture for e2e"
```

---

## Task 11: End-to-end mini-series smoke test

**Files:**
- Create: `.claude/skills/series-volume-creator/scripts/test/e2e-mini-series.test.ts`
- Create: `.claude/skills/series-volume-creator/scripts/orchestrate-volume.ts`

The orchestrator script wires together the helpers from Tasks 1-4 and the existing `generate-epub.ts` to do **everything in Step 5-7 of `series-volume-creator`** in one programmatic call. The SKILL.md flow normally calls these helpers from a Claude session, but for end-to-end testing we need a single entry point that:

1. Reads context (Task 9's `loadVolumeContext`)
2. Composes per-page prompts (Task 3's `composePagePrompt`)
3. Writes them to `prompts/<n>.txt`
4. Calls a **mock** `image-generation` (we don't hit Azure in tests) — the mock writes a valid >100KB PNG per page
5. Runs `verifyPages`
6. Calls `generate-epub.ts` (single-volume mode) via subprocess
7. Updates `state.json`

The test then exercises the full pipeline from a mini-series fixture and asserts the final state is `phase: "packaged"` with the EPUB on disk. Audio (Step 8) is **not** in this test (would require edge-tts network); we cover Step 0-7 + Step 9.

- [ ] **Step 1: Implement orchestrate-volume.ts**

```typescript
// .claude/skills/series-volume-creator/scripts/orchestrate-volume.ts
import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { spawnSync } from "child_process";
import { loadVolumeContext } from "./load-context";
import { composePagePrompt, type PageInput } from "./compose-prompt";
import { verifyPages } from "./verify-pages";
import { updateState } from "../../series-bible-creator/scripts/lib/state";
import { parseOutline, serializeOutline } from "../../series-season-planner/scripts/outline-parse";

export interface OrchestrateOptions {
  seriesRoot: string;
  volumeId: string;
  pages: PageInput[];          // pre-parsed per-page script (cover + body)
  title: string;
  /** Caller-supplied image generator. Tests pass in a mock; real callers shell out. */
  generateImage: (prompt: string, outputPath: string) => Promise<void>;
  /** Caller-supplied EPUB builder; defaults to invoking generate-epub.ts. */
  buildEpub?: (volumeDir: string, title: string, lang: string) => Promise<string>;
}

export async function orchestrateVolume(opts: OrchestrateOptions): Promise<{ phase: string; epubPath: string }> {
  const ctx = await loadVolumeContext(opts.seriesRoot, opts.volumeId);
  const volumeDir = join(opts.seriesRoot, "volumes", opts.volumeId);
  await mkdir(join(volumeDir, "prompts"), { recursive: true });

  // Step 5: write per-page prompts.
  for (const page of opts.pages) {
    const prompt = composePagePrompt({ ctx, page });
    await writeFile(join(volumeDir, "prompts", `${page.pageNumber}.txt`), prompt, "utf-8");
  }

  // Step 6: generate images (caller controls actual mechanism; tests mock).
  for (const page of opts.pages) {
    const prompt = await readFile(join(volumeDir, "prompts", `${page.pageNumber}.txt`), "utf-8");
    await opts.generateImage(prompt, join(volumeDir, `${page.pageNumber}.png`));
  }

  // Step 6.3: verify.
  const totalPages = opts.pages.length;
  const v = await verifyPages(volumeDir, totalPages);
  if (v.failed.length > 0) {
    throw new Error(`page generation failures: ${JSON.stringify(v.failed)}`);
  }
  await updateState(opts.seriesRoot, (s) => {
    s.volumes[opts.volumeId] = { ...(s.volumes[opts.volumeId] ?? { season: ctx.season?.id ?? null }), phase: "imaged" };
  });

  // Step 7: build EPUB.
  const builder = opts.buildEpub ?? defaultBuildEpub;
  const epubPath = await builder(volumeDir, opts.title, ctx.meta.language);

  // Step 7 (cont.): write per-volume meta.json (spec §4.7).
  const meta = {
    volume_id: opts.volumeId,
    season: ctx.season?.id ?? null,
    title: opts.title,
    pages: totalPages,
    built_at: new Date().toISOString(),
    outputs: {
      epub: epubPath.split("/").pop()!,
    },
  };
  await writeFile(join(volumeDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");

  // Step 9: update state + outline if pages changed.
  await updateState(opts.seriesRoot, (s) => {
    s.volumes[opts.volumeId] = {
      ...(s.volumes[opts.volumeId] ?? {}),
      season: ctx.season?.id ?? null,
      phase: "packaged",
      pages: totalPages,
      built_at: new Date().toISOString(),
    };
  });
  if (ctx.outlineEntry && ctx.outlineEntry.planned_pages !== totalPages && ctx.season) {
    const outlinePath = join(opts.seriesRoot, "seasons", ctx.season.id, "volumes-outline.md");
    const outline = parseOutline(await readFile(outlinePath, "utf-8"));
    const entry = outline.volumes.find((v) => v.id === opts.volumeId);
    if (entry) entry.planned_pages = totalPages;
    outline.revision++;
    await writeFile(outlinePath, serializeOutline(outline), "utf-8");
  }

  return { phase: "packaged", epubPath };
}

async function defaultBuildEpub(volumeDir: string, title: string, lang: string): Promise<string> {
  const script = ".claude/skills/picture-book-creator/scripts/generate-epub.ts";
  const r = spawnSync("bun", ["run", script, "--input", volumeDir, "--title", title, "--lang", lang], {
    encoding: "utf-8", stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`generate-epub.ts exited ${r.status}`);
  return join(volumeDir, `${title}.epub`);
}
```

- [ ] **Step 2: Write the e2e smoke test**

```typescript
// .claude/skills/series-volume-creator/scripts/test/e2e-mini-series.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { orchestrateVolume } from "../orchestrate-volume";
import { loadState } from "../../../series-bible-creator/scripts/lib/state";

// 110KB filler PNG that passes the >100KB verifier.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFAQH/cWlOIQAAAABJRU5ErkJggg==",
  "base64"
);
const FAT_PNG = Buffer.concat([TINY_PNG, Buffer.alloc(110_000)]);

let root: string;
let seriesRoot: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "e2e-mini-"));
  seriesRoot = join(root, "demo");

  // Build a minimal Bible + outline by hand (could also `cp` the Task 8 fixture).
  await mkdir(join(seriesRoot, "bible", "portraits"), { recursive: true });
  await mkdir(join(seriesRoot, "seasons", "s1"), { recursive: true });

  await writeFile(join(seriesRoot, "state.json"), JSON.stringify({
    version: 1, series_slug: "demo", title: "Demo",
    created_at: "2026-05-14T00:00:00Z",
    bible: { version: 1, frozen_at: "2026-05-14T00:00:00Z" },
    seasons: { s1: { title: "S1", volumes_planned: 1, arc_locked: true, started_at: "2026-05-14T00:00:00Z", outline_revision: 1 } },
    volumes: {}, omnibus: [],
  }, null, 2));
  await writeFile(join(seriesRoot, "bible", "series-meta.md"),
    `---\nslug: demo\ntitle: Demo\nage_range: 4-6\nlanguage: zh\ngenre: test\nseries_scale: short\ntypical_pages_per_volume: 3\ncreated_at: 2026-05-14T00:00:00Z\n---\n# meta\n`);
  await writeFile(join(seriesRoot, "bible", "world.md"), "# world\nminimal\n");
  await writeFile(join(seriesRoot, "bible", "characters.md"),
    `# 角色\n## 小熊\n- prompt_anchor: A small white bear cub.\n- voice_profile: zh-CN-XiaoxiaoNeural rate=+0% pitch=+5%\n`);
  await writeFile(join(seriesRoot, "bible", "style.md"),
    `# 风格\n- style_prompt: warm pastel watercolor\n- negative_prompt: no text, no watermark\n- color_palette: cream, soft pink, sage\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "season-arc.md"),
    `---\nseason_id: s1\ntitle: S1\nvolumes_planned: 1\nopening_state: start\nending_state: end\narc_locked: true\n---\n# arc\n`);
  await writeFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"),
    `---\nseason_id: s1\nrevision: 1\n---\n\n## s1v1 first volume\n\n- beat: 开篇\n- pov: 小熊\n- summary: short.\n- characters: [小熊]\n- planned_pages: 5\n- mood: 温暖\n`);
});

afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("end-to-end mini-series volume creation", () => {
  test("orchestrateVolume runs Step 5-9 and ends in packaged state", async () => {
    const pages = [
      { pageNumber: 0, text: "封面", scene: "bear cub holding a sign", action: "smiling", emotion: "happy", composition: "full body, centered", characters: ["小熊"] },
      { pageNumber: 1, text: "第一页", scene: "kitchen", action: "kneading dough", emotion: "focused", composition: "medium shot", characters: ["小熊"] },
      { pageNumber: 2, text: "第二页", scene: "oven", action: "watching", emotion: "curious", composition: "close-up", characters: ["小熊"] },
    ];

    const result = await orchestrateVolume({
      seriesRoot,
      volumeId: "s1v1",
      pages,
      title: "首册",
      // mock image-generation: write FAT_PNG to the requested output path.
      generateImage: async (_prompt, outputPath) => {
        await writeFile(outputPath, FAT_PNG);
      },
    });

    expect(result.phase).toBe("packaged");
    const epubStat = await stat(result.epubPath);
    expect(epubStat.size).toBeGreaterThan(1024); // sane EPUB size
  });

  test("state.json reflects packaged + correct page count", async () => {
    const s = await loadState(seriesRoot);
    expect(s.volumes["s1v1"]?.phase).toBe("packaged");
    expect(s.volumes["s1v1"]?.pages).toBe(3);
    expect(s.volumes["s1v1"]?.season).toBe("s1");
  });

  test("outline planned_pages was rewritten + revision bumped", async () => {
    const text = await readFile(join(seriesRoot, "seasons", "s1", "volumes-outline.md"), "utf-8");
    expect(text).toContain("revision: 2");
    expect(text).toContain("planned_pages: 3");
  });

  test("per-page prompt files were written", async () => {
    for (const n of [0, 1, 2]) {
      const p = await readFile(join(seriesRoot, "volumes", "s1v1", "prompts", `${n}.txt`), "utf-8");
      expect(p).toContain("warm pastel watercolor");          // style prefix
      expect(p).toContain("A small white bear cub.");          // bible anchor verbatim
    }
  });

  test("per-volume meta.json was written with spec §4.7 fields", async () => {
    const text = await readFile(join(seriesRoot, "volumes", "s1v1", "meta.json"), "utf-8");
    const meta = JSON.parse(text);
    expect(meta.volume_id).toBe("s1v1");
    expect(meta.season).toBe("s1");
    expect(meta.title).toBe("首册");
    expect(meta.pages).toBe(3);
    expect(meta.outputs.epub).toContain(".epub");
  });

  test("omnibus mode merges this single packaged volume (with warning)", async () => {
    // After Task 5/6, parse-range warns on single-volume omnibus.
    const { parseRange } = await import("../../../series-omnibus-packager/scripts/parse-range");
    const s = await loadState(seriesRoot);
    const r = parseRange("s1", s);
    expect(r.ids).toEqual(["s1v1"]);
    expect(r.warnings).toContain("omnibus of a single volume — output will be a copy of that volume");
  });
});
```

- [ ] **Step 3: Run the e2e test to verify it passes**

Run: `bun test .claude/skills/series-volume-creator/scripts/test/e2e-mini-series.test.ts`
Expected: PASS — 6 tests. (This is the proof that Tasks 1, 2, 3, 5, 6, 9 wire together correctly.)

- [ ] **Step 4: Run the entire test suite**

Run: `bun test`
Expected: ALL PASS — every unit test from Tasks 1-10 plus this e2e.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/series-volume-creator/scripts/orchestrate-volume.ts \
        .claude/skills/series-volume-creator/scripts/test/e2e-mini-series.test.ts
git commit -m "test(series-volume): end-to-end mini-series smoke test with mocked image gen"
```

---

## Task 12: README + .gitignore + package.json polish

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Modify: `package.json`

Final docs pass: surface the new system in `README.md`, ensure `series-output/` is ignored (already added during spec commit but verify), and add convenience npm scripts so users can invoke the helpers without remembering paths.

- [ ] **Step 1: Verify .gitignore**

Run: `grep -n "series-output" .gitignore`
Expected: a line `series-output` (or `series-output/`). If absent, add it. (Was added during spec commit on `feature/serial-picture-book`; this step is a guard.)

- [ ] **Step 2: Add npm scripts**

Modify `package.json` `scripts` section to add three new entries (alphabetized after the existing ones):

```json
"epub-omnibus": "bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts --omnibus",
"series-test": "bun test ./.claude/skills/series-bible-creator/ ./.claude/skills/series-season-planner/ ./.claude/skills/series-volume-creator/ ./.claude/skills/series-omnibus-packager/ ./.claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts",
"test": "bun test ./.claude/skills/"
```

(The existing `"test": "bun test ./.claude/skills/"` line stays; only `epub-omnibus` and `series-test` are new.)

Final scripts block should look like:

```json
"scripts": {
  "setup": "bun install && bun run setup:venv",
  "setup:venv": "python3 -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r requirements.txt",
  "image": "bun run .claude/skills/image-generation/scripts/generate-image.ts",
  "epub": "bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts",
  "epub-omnibus": "bun run .claude/skills/picture-book-creator/scripts/generate-epub.ts --omnibus",
  "audio": "bun run .claude/skills/text-to-speech/scripts/generate-audio.ts",
  "audio-epub": "bun run .claude/skills/audio-picture-book-creator/scripts/generate-audio-epub.ts",
  "test": "bun test ./.claude/skills/",
  "series-test": "bun test ./.claude/skills/series-bible-creator/ ./.claude/skills/series-season-planner/ ./.claude/skills/series-volume-creator/ ./.claude/skills/series-omnibus-packager/ ./.claude/skills/picture-book-creator/scripts/generate-epub.omnibus.test.ts"
}
```

- [ ] **Step 3: Append "连载绘本（多册系列）" section to README.md**

Add this as a new top-level section, placed AFTER the existing "## 有声绘本（实验功能）" section:

```markdown
## 连载绘本（多册系列）

把单本工作流升级为**多册同一世界**的连载绘本系列。每册独立可读，全系列共享世界观、角色和画风。

### 三层结构

```
建系列（一次）
  └─ Series Bible: world.md / characters.md / style.md / portraits/
     └─ 规划本季弧线（每季一次）
        └─ Season Arc + volumes-outline
           └─ 生成单册（每册一次,可隔天/隔周/隔月）
              └─ script + 图 + 静态 EPUB + 自动有声 EPUB
              └─ 出合订本（按需）
                 └─ omnibus EPUB
```

### 4 个 skill

| Skill | 触发关键词 | 何时用 |
|---|---|---|
| `series-bible-creator` | "建一个绘本系列"、"create series" | 一个系列只跑一次 |
| `series-season-planner` | "规划第 N 季"、"plan season 2" | 每季跑一次 |
| `series-volume-creator` | "做下一册"、"build volume 3" | 每册跑一次 |
| `series-omnibus-packager` | "出第一季合订本"、"merge volumes" | 按需 |

### 输出目录

```
series-output/<series-slug>/
├── state.json                      ← 跨会话进度
├── bible/                          ← 冻结资产
│   ├── series-meta.md
│   ├── world.md
│   ├── characters.md               ← 含 voice_profile + prompt_anchor
│   ├── style.md
│   └── portraits/
├── seasons/<id>/
│   ├── season-arc.md
│   └── volumes-outline.md
├── volumes/<id>/
│   ├── script.md
│   ├── 0.png ~ N.png               ← 1024×1024
│   ├── <册名>.epub
│   └── <册名>-audio.epub
└── omnibus/<series>-<range>.epub
```

`series-output/` 已被 .gitignore，不会进仓库。

### 跨册一致性

- **角色**：Bible 里的 `prompt_anchor`（英文短语）每册原样复制；可加 per-volume 补丁但 Bible 锚定永远在前
- **画风**：Bible 的 `style.md` 提供全系列 prompt 前缀
- **声音**：Bible 角色卡里的 `voice_profile` 全系列锁定，第一册定声后永不更换

### 跨会话恢复

每次启动任一 series-* skill，都会先读 `state.json` 报告进度（已冻结的 bible 版本、已锁的 season、各册 phase 计数），用户可从中断处继续。

### 手动调用合订脚本

```bash
bun run epub-omnibus -- \
  --series-root series-output/<slug> \
  --volumes "s1v1,s1v2,s1v3" \
  --title "第一季合集" \
  --lang zh
```

### 设计与实现文档

- 设计 spec: `docs/superpowers/specs/2026-05-14-serial-picture-book-design.md`
- 实施 plan: `docs/superpowers/plans/2026-05-14-serial-picture-book.md`
```

- [ ] **Step 4: Run the full series test suite as a final smoke**

Run: `bun run series-test`
Expected: PASS — every series-related test (state, outline, compose, retry, range, generate-epub omnibus, season-arc, series-meta, load-context, verify-pages, e2e).

- [ ] **Step 5: Commit**

```bash
git add README.md package.json .gitignore
git commit -m "docs: README section for serial picture books + npm scripts polish"
```

---

## Self-Review Checklist (run after Task 12 completes)

After all 12 tasks are done, verify:

- [ ] `bun test` (entire suite) → all green
- [ ] `bun run series-test` → all green
- [ ] Spec coverage: every section in `2026-05-14-serial-picture-book-design.md` is implemented or explicitly out-of-scope:
  - §1 (range/non-range): bible-creator + season-planner + volume-creator + omnibus-packager all created
  - §2 (decisions): all reflected in code/skill behavior
  - §3 (architecture): state.json + 4 skills + flat output dirs
  - §4.1-4.7 (data contracts): every file has a writer skill
  - §5.1-5.4 (skill flows): each SKILL.md follows the prescribed Step ordering
  - §6.1 (--omnibus extension): Task 6 implements
  - §7 (testing strategy): all unit tests + e2e present
  - §8 (error handling): each error row has corresponding code path or skill instruction
  - §9 (output overview): matches generated structure
  - §10 (docs updates): README + .gitignore done in Task 12
  - §11 (non-goals): not implemented (correct)
- [ ] No SKILL.md references a script that doesn't exist
- [ ] No test calls a function that doesn't exist
- [ ] Type names are consistent: `SeriesState`, `VolumeContext`, `Outline`, `OutlineVolume`, `SeasonArc`, `SeriesMeta`, `CharacterCard`, `RangeResolution`, `VerifyResult`, `OrchestrateOptions`, `PageInput`
- [ ] Every commit message uses the conventions from the top of this plan

If any item fails, fix it inline and re-run the relevant tests before declaring done.
