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
