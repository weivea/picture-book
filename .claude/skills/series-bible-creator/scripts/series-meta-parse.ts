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
const SCALAR_REQUIRED = ["slug", "title", "age_range", "language", "genre", "series_scale", "typical_pages_per_volume", "created_at"] as const;

export function parseSeriesMeta(text: string): SeriesMeta {
  const m = text.match(FRONTMATTER_RE);
  if (!m) throw new Error("series-meta missing YAML frontmatter");
  const yaml = parseSimpleYaml(m[1]!);
  const body = m[2] ?? "";

  for (const k of SCALAR_REQUIRED) {
    const v = yaml[k];
    if (v === undefined) {
      throw new Error(`series-meta missing required field: ${k}`);
    }
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`series-meta required field "${k}" is empty or malformed`);
    }
  }
  const scale = yaml.series_scale;
  if (scale !== "short" && scale !== "medium" && scale !== "long") {
    throw new Error(`series-meta invalid series_scale "${scale}" (allowed: short|medium|long)`);
  }

  const pagesRaw = yaml.typical_pages_per_volume;
  const pages = typeof pagesRaw === "string" ? Number(pagesRaw.trim()) : NaN;
  if (!Number.isInteger(pages) || pages <= 0) {
    throw new Error(`series-meta typical_pages_per_volume must be a positive integer, got "${pagesRaw}"`);
  }

  return {
    slug: String(yaml.slug),
    title: String(yaml.title),
    title_en: yaml.title_en !== undefined ? String(yaml.title_en) : undefined,
    age_range: String(yaml.age_range),
    language: String(yaml.language),
    genre: String(yaml.genre),
    series_scale: scale,
    typical_pages_per_volume: pages,
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
