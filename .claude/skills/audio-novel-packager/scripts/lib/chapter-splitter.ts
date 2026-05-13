// .claude/skills/audio-novel-packager/scripts/lib/chapter-splitter.ts

export interface Sentence {
  idx: number;
  text: string;
  speaker: string; // "narrator" 或角色名
}

const SENT_END_CHARS = new Set(["。", "！", "？", "!", "?", "…"]);
const OPEN_QUOTES = new Set(['"', "“", "「", "『"]);
const CLOSE_QUOTES = new Set(['"', "”", "」", "』"]);

// 把文本切成句子。规则：
// - 在引号外遇到句末标点 → 当前句到此结束（吃掉连续的句末标点，但不要贪心地吃后面的引号——
//   ASCII 直引号 " 是 open/close 同形的，贪心会把下一句的开引号当成本句的闭引号）。
// - 在引号内的标点不算句末。
// - 自然地，"X说。"形式的对话+归属会作为一句留下：因为对话里的 。 在 inQuote=true 期间被跳过，
//   只有归属末尾的 。 才触发分句。
function splitChinese(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    buf += ch;
    if (!inQuote && OPEN_QUOTES.has(ch)) {
      inQuote = true;
      i++;
      continue;
    }
    if (inQuote && CLOSE_QUOTES.has(ch)) {
      inQuote = false;
      i++;
      continue;
    }
    if (!inQuote && SENT_END_CHARS.has(ch)) {
      while (i + 1 < text.length && SENT_END_CHARS.has(text[i + 1])) {
        buf += text[++i];
      }
      const piece = buf.trim();
      if (piece) out.push(piece);
      buf = "";
    }
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ATTRIB_VERBS = "(说|道|低声|问|答|喊|笑|叹|怒|喝|呢喃|低吼)";

function detectExplicitSpeaker(
  sentence: string,
  participants: string[],
): string | null {
  for (const name of participants) {
    const re = new RegExp(`${escapeRe(name)}${ATTRIB_VERBS}`);
    if (re.test(sentence)) return name;
  }
  return null;
}

function isDialog(sentence: string): boolean {
  return /["“「『][^"”」』]*["”」』]/.test(sentence);
}

export function splitToSentences(
  body: string,
  participants: string[],
): Sentence[] {
  const normalized = body.replace(/\r\n/g, "\n");
  const raw = splitChinese(normalized);
  return raw.map((text, idx) => {
    let speaker = "narrator";
    const explicit = detectExplicitSpeaker(text, participants);
    if (explicit) speaker = explicit;
    else if (isDialog(text) && participants.length === 1)
      speaker = participants[0];
    return { idx, text, speaker };
  });
}
