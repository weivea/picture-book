export type Tier = "short" | "medium" | "long";
export type Phase =
  | "foundation_done"
  | "drafting"
  | "drafted"
  | "revising"
  | "revised"
  | "illustrated"
  | "audio_done"
  | "packaged";

export interface Character {
  name: string;
  role: string;
  core: string;
  wound: string;
  want: string;
  need: string;
  lie: string;
  appearance: string;
  voice_profile: string; // "auto" 或具体 voice id
}

export interface Chapter {
  n: number;
  title: string;
  beat: string;
  pov: string;
  summary: string;
  sceneCountHint: number;
}

export interface FoundationState {
  version: 1;
  project: string;
  tier: Tier;
  phase: Phase;
  seed: string;
  target_words: number;
  chapter_count: number;
  created_at: string; // ISO8601
  debts: Array<{ kind: string; ref: string; note: string }>;
  chapters: Record<
    string,
    {
      drafted?: boolean;
      revised?: boolean;
      score?: number;
      illustrations?: number;
      audio?: boolean;
    }
  >;
}

const REQUIRED_CHARACTER_FIELDS = [
  "role",
  "core",
  "wound",
  "want",
  "need",
  "lie",
  "appearance",
  "voice_profile",
] as const;

function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("frontmatter not found");
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

export function parseCharactersMd(md: string): {
  count: number;
  characters: Character[];
} {
  const { data, body } = parseFrontmatter(md);
  const expectedCount = parseInt(data.count, 10);
  if (!Number.isFinite(expectedCount)) throw new Error("frontmatter.count missing");

  const blocks = body.split(/^## /m).slice(1);
  const characters: Character[] = blocks.map((block) => {
    const [nameLine, ...rest] = block.split("\n");
    const fields: Record<string, string> = {};
    for (const line of rest) {
      const kv = line.match(/^- ([a-z_]+):\s*(.+)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    for (const f of REQUIRED_CHARACTER_FIELDS) {
      if (!fields[f]) throw new Error(`character "${nameLine.trim()}" missing field: ${f}`);
    }
    return {
      name: nameLine.trim(),
      role: fields.role,
      core: fields.core,
      wound: fields.wound,
      want: fields.want,
      need: fields.need,
      lie: fields.lie,
      appearance: fields.appearance,
      voice_profile: fields.voice_profile,
    };
  });

  if (characters.length !== expectedCount)
    throw new Error(
      `frontmatter.count=${expectedCount} 与实际角色数 ${characters.length} 不匹配`,
    );
  if (characters.length < 4 || characters.length > 8)
    throw new Error(`角色数必须在 4–8 之间（当前 ${characters.length}）`);

  return { count: expectedCount, characters };
}

export function parseOutlineMd(md: string): {
  tier: Tier;
  chapterCount: number;
  targetWordsTotal: number;
  beatStructure: string;
  chapters: Chapter[];
} {
  const { data, body } = parseFrontmatter(md);
  const tier = data.tier as Tier;
  if (!["short", "medium", "long"].includes(tier)) throw new Error("tier 非法");
  const chapterCount = parseInt(data.chapter_count, 10);

  const blocks = body.split(/^## Chapter /m).slice(1);
  const chapters: Chapter[] = blocks.map((block) => {
    const headMatch = block.match(/^(\d+):\s*(.+)/);
    if (!headMatch) throw new Error("章节标题格式错误，需为 '## Chapter N: 标题'");
    const n = parseInt(headMatch[1], 10);
    const title = headMatch[2].trim();
    const fields: Record<string, string> = {};
    for (const line of block.split("\n").slice(1)) {
      const kv = line.match(/^- ([a-z_]+):\s*(.+)$/);
      if (kv) fields[kv[1]] = kv[2].trim();
    }
    for (const f of ["beat", "pov", "summary", "scene_count_hint"]) {
      if (!fields[f]) throw new Error(`Chapter ${n} 缺字段: ${f}`);
    }
    return {
      n,
      title,
      beat: fields.beat,
      pov: fields.pov,
      summary: fields.summary,
      sceneCountHint: parseInt(fields.scene_count_hint, 10),
    };
  });

  if (chapters.length !== chapterCount)
    throw new Error(
      `frontmatter.chapter_count=${chapterCount} 与实际章节数 ${chapters.length} 不匹配`,
    );

  return {
    tier,
    chapterCount,
    targetWordsTotal: parseInt(data.target_words_total, 10),
    beatStructure: data.beat_structure,
    chapters,
  };
}

const VALID_PHASES: Phase[] = [
  "foundation_done",
  "drafting",
  "drafted",
  "revising",
  "revised",
  "illustrated",
  "audio_done",
  "packaged",
];

export function validateState(s: FoundationState): void {
  if (!VALID_PHASES.includes(s.phase as Phase))
    throw new Error(`非法 phase: ${s.phase}`);
  if (!["short", "medium", "long"].includes(s.tier as string))
    throw new Error(`非法 tier: ${s.tier}`);
  if (typeof s.chapter_count !== "number" || s.chapter_count < 1)
    throw new Error(`非法 chapter_count: ${s.chapter_count}`);
}
