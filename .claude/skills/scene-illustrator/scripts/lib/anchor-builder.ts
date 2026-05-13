// .claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts

const COLOR_HINTS = [
  "silver", "gold", "golden", "black", "white", "red", "blue", "green",
  "grey", "gray", "auburn", "blonde", "navy", "ivory", "scarlet",
  "violet", "purple", "amber", "pink", "brown", "crimson", "jade",
  "milky", "milky-white",
];
const GARMENT_HINTS = [
  "robe", "coat", "dress", "shirt", "armor", "cloak", "uniform",
  "tunic", "gown", "kimono", "hanfu", "vest", "jacket", "trousers",
];
const FEATURE_HINTS = [
  "scar", "ribbon", "pendant", "eye-patch", "eyepatch", "earring",
  "tattoo", "blind", "mask", "glasses", "hairpin", "horns", "fangs",
];

const CN_RE = /[一-鿿]/;

export function validateAnchor(anchor: string): void {
  if (CN_RE.test(anchor)) throw new Error(`anchor 必须英文，实际: "${anchor}"`);
  const tokens = anchor.split(/\s+/).filter(Boolean);
  if (tokens.length > 25)
    throw new Error(`anchor 超过 25 token (${tokens.length})`);
  const lower = anchor.toLowerCase();
  let categories = 0;
  if (COLOR_HINTS.some((c) => lower.includes(c))) categories++;
  if (GARMENT_HINTS.some((g) => lower.includes(g))) categories++;
  if (FEATURE_HINTS.some((f) => lower.includes(f))) categories++;
  if (categories < 2)
    throw new Error(
      `anchor 不满足"三选二"（颜色/服饰/特征），仅命中 ${categories} 类: "${anchor}"`,
    );
}

export function buildAnchors(charactersMd: string): Map<string, string> {
  const fmMatch = charactersMd.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? charactersMd.slice(fmMatch[0].length) : charactersMd;
  const blocks = body.split(/^## /m).slice(1);
  const map = new Map<string, string>();
  for (const block of blocks) {
    const lines = block.split("\n");
    const name = lines[0].trim();
    const appearance = lines
      .find((l) => /^- appearance:/.test(l))
      ?.replace(/^- appearance:\s*/, "")
      .trim();
    if (!appearance) throw new Error(`角色 "${name}" 缺 appearance`);
    validateAnchor(appearance);
    map.set(name, appearance);
  }
  return map;
}
