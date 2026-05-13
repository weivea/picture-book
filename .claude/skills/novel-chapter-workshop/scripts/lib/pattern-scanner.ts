// .claude/skills/novel-chapter-workshop/scripts/lib/pattern-scanner.ts

export interface PatternHit {
  code: string;
  message: string;
  line: number;
}

interface RuleCtx {
  bodyLines: string[]; // 去 frontmatter 后的行
  fmOffset: number; // body 起始对应原文的行号偏移
}

type Rule = (ctx: RuleCtx) => PatternHit[];

const RULES: Rule[] = [
  // 1) 开篇双极对仗："在那个X与Y交织的Z"等
  (ctx) => {
    const firstNonEmpty = ctx.bodyLines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmpty < 0) return [];
    const line = ctx.bodyLines[firstNonEmpty];
    if (/^在那个.{0,15}[与和].{0,15}交织的/.test(line)) {
      return [
        {
          code: "ARCHETYPE_OPENING_BIPOLAR",
          message: '开篇套路："在那个X与Y交织的Z"',
          line: ctx.fmOffset + firstNonEmpty + 1,
        },
      ];
    }
    return [];
  },
  // 2) 对话连续两段无归属
  (ctx) => {
    const hits: PatternHit[] = [];
    let prevWasAttribFreeDialog = false;
    for (let i = 0; i < ctx.bodyLines.length; i++) {
      const line = ctx.bodyLines[i].trim();
      const isDialog = /^["“].*["”]\s*$/.test(line);
      if (isDialog) {
        if (prevWasAttribFreeDialog) {
          hits.push({
            code: "DIALOG_ATTRIB_MISSING",
            message: "连续对话缺归属（说话人）",
            line: ctx.fmOffset + i + 1,
          });
          prevWasAttribFreeDialog = false;
        } else {
          prevWasAttribFreeDialog = true;
        }
      } else if (line.length > 0) {
        prevWasAttribFreeDialog = false;
      }
    }
    return hits;
  },
  // 3) 形容词命名情绪："感到 + N + 的 + 情绪名"
  (ctx) => {
    const hits: PatternHit[] = [];
    for (let i = 0; i < ctx.bodyLines.length; i++) {
      if (
        /感到.{0,8}(悸动|温暖|寒意|绝望|希望|喜悦|愤怒|悲伤|恐惧)/.test(
          ctx.bodyLines[i],
        )
      ) {
        hits.push({
          code: "TELL_NOT_SHOW_EMOTION",
          message: '"感到X的Y"式情绪命名',
          line: ctx.fmOffset + i + 1,
        });
      }
    }
    return hits;
  },
];

export function scanPatterns(chapterMd: string): PatternHit[] {
  // 与 slop-scanner 保持一致：CRLF 归一化，避免 frontmatter 正则失效
  const normalized = chapterMd.replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(/^---\n[\s\S]*?\n---\n/);
  const fmOffset = fmMatch ? fmMatch[0].split("\n").length - 1 : 0;
  const body = fmMatch ? normalized.slice(fmMatch[0].length) : normalized;
  const ctx: RuleCtx = { bodyLines: body.split("\n"), fmOffset };
  return RULES.flatMap((r) => r(ctx));
}
