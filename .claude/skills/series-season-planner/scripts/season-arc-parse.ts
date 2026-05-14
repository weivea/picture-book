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
const REQUIRED_SCALARS = ["season_id", "title", "opening_state", "ending_state"] as const;

// Known object-list keys; everything else is treated as string-list to avoid
// silently dropping bullets like "- 角色名: 描述" that look like object items.
const OBJECT_LIST_KEYS = new Set(["key_turn_points"]);

export function parseSeasonArc(text: string): SeasonArc {
  const m = text.match(FRONTMATTER_RE);
  if (!m) throw new Error("season-arc missing YAML frontmatter");
  const body = m[2] ?? "";
  const yaml = parseYaml(m[1]!);

  for (const k of REQUIRED_SCALARS) {
    const v = yaml.scalar[k];
    if (v === undefined) {
      throw new Error(`season-arc missing required field: ${k}`);
    }
    if (v.trim() === "") {
      throw new Error(`season-arc required field "${k}" is empty`);
    }
  }

  const planRaw = yaml.scalar.volumes_planned;
  if (planRaw === undefined) {
    throw new Error("season-arc missing required field: volumes_planned");
  }
  const plan = Number(planRaw.trim());
  if (!Number.isInteger(plan) || plan <= 0) {
    throw new Error(`season-arc volumes_planned must be a positive integer, got "${planRaw}"`);
  }

  return {
    season_id: String(yaml.scalar.season_id ?? ""),
    title: String(yaml.scalar.title ?? ""),
    volumes_planned: plan,
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
      // empty list shortcut
      if (i >= lines.length || !/^\s+-\s+/.test(lines[i]!)) {
        out.stringLists[key] = [];
        continue;
      }
      if (OBJECT_LIST_KEYS.has(key)) {
        // object list (parse as KeyTurnPoint)
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
          if (!obj.volume || !obj.event) {
            throw new Error(`season-arc key_turn_points item missing volume or event: ${JSON.stringify(obj)}`);
          }
          items.push({ volume: obj.volume, event: obj.event });
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
