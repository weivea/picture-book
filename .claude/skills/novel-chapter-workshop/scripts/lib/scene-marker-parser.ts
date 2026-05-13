// .claude/skills/novel-chapter-workshop/scripts/lib/scene-marker-parser.ts

export type Mood =
  | "calm" | "tense" | "ominous" | "melancholy" | "joyful" | "fearful"
  | "awe" | "defiant" | "tender" | "furious" | "lonely" | "mysterious";

const VALID_MOODS = new Set<Mood>([
  "calm", "tense", "ominous", "melancholy", "joyful", "fearful",
  "awe", "defiant", "tender", "furious", "lonely", "mysterious",
]);

export interface Scene {
  index: number; // 0-based 出现顺序
  title: string;
  location: string;
  mood: Mood;
  participants: string[];
  body: string; // 不含 SCENE 标记自身
  startLine: number; // 1-based，open tag 所在行
}

const OPEN = /<!--\s*SCENE:\s*([^|]+)\|\s*location:\s*([^|]+)\|\s*mood:\s*([^|]+)\|\s*participants:\s*([^-]+?)\s*-->/;
const CLOSE = /<!--\s*\/SCENE\s*-->/;

export function parseScenes(chapterMd: string): Scene[] {
  const lines = chapterMd.split("\n");
  const scenes: Scene[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(OPEN);
    if (!open) {
      i++;
      continue;
    }
    const startLine = i + 1;
    const title = open[1].trim();
    const location = open[2].trim();
    const mood = open[3].trim() as Mood;
    if (!VALID_MOODS.has(mood)) {
      throw new Error(`scene-marker-parser: 非法 mood "${mood}" at line ${startLine}`);
    }
    const partsRaw = open[4].trim();
    const participants =
      partsRaw === "none"
        ? []
        : partsRaw.split(",").map((s) => s.trim()).filter(Boolean);

    // 找 closing
    let j = i + 1;
    while (j < lines.length && !CLOSE.test(lines[j])) j++;
    if (j >= lines.length) {
      throw new Error(
        `scene-marker-parser: missing closing </SCENE--> for scene "${title}" at line ${startLine}`,
      );
    }
    const body = lines.slice(i + 1, j).join("\n").trim();
    scenes.push({
      index: scenes.length,
      title,
      location,
      mood,
      participants,
      body,
      startLine,
    });
    i = j + 1;
  }
  return scenes;
}
