// .claude/skills/scene-illustrator/scripts/lib/anchor-builder.ts

// 锚定提示词表。匹配采用词边界（\b）以避免子串污染：
//   "silver" 不会误中 "silvery/silverware"，"blind" 不会误中 "blinding/blindfold"。
// 同源词只保留一个最短形：
//   "milky-white" 已被 "milky" + "white" 覆盖；"golden" 含 "gold" 词根但词形不同，保留。
const COLOR_HINTS = [
  "silver", "gold", "golden", "black", "white", "red", "blue", "green",
  "grey", "gray", "auburn", "blonde", "navy", "ivory", "scarlet",
  "violet", "purple", "amber", "pink", "brown", "crimson", "jade",
  "milky",
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHint(text: string, hints: readonly string[]): boolean {
  // 用 \b 词边界避免 "silver" 命中 "silverware"、"blind" 命中 "blindfold" 等子串污染
  return hints.some((h) => new RegExp(`\\b${escapeRe(h)}\\b`).test(text));
}

export function validateAnchor(anchor: string): void {
  if (CN_RE.test(anchor)) throw new Error(`anchor 必须英文，实际: "${anchor}"`);
  const tokens = anchor.split(/\s+/).filter(Boolean);
  if (tokens.length > 25)
    throw new Error(`anchor 超过 25 token (${tokens.length})`);
  const lower = anchor.toLowerCase();
  let categories = 0;
  if (hasHint(lower, COLOR_HINTS)) categories++;
  if (hasHint(lower, GARMENT_HINTS)) categories++;
  if (hasHint(lower, FEATURE_HINTS)) categories++;
  if (categories < 2)
    throw new Error(
      `anchor 不满足"三选二"（颜色/服饰/特征），仅命中 ${categories} 类: "${anchor}"`,
    );
}

export function buildAnchors(charactersMd: string): Map<string, string> {
  // 与 slop/pattern/scene-marker 保持一致：CRLF 归一化
  const normalized = charactersMd.replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? normalized.slice(fmMatch[0].length) : normalized;
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
