// .claude/skills/novel-chapter-workshop/scripts/lib/slop-scanner.ts

export interface SlopHit {
  tier: 1 | 2 | 3;
  term: string;
  line: number; // 1-based
  column: number; // 1-based, char index
}

interface TieredVocab {
  1: string[];
  2: string[];
  3: string[];
}

export function parseAntiSlop(md: string): TieredVocab {
  const out: TieredVocab = { 1: [], 2: [], 3: [] };
  let current: 1 | 2 | 3 | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    // 任何 "## " 标题都会重置 tier 上下文，避免后续小节（如示例代码）被误归入上一 Tier
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const tierMatch = heading[1].match(/^Tier\s+(\d)/);
      if (tierMatch) {
        const t = parseInt(tierMatch[1], 10);
        current = t === 1 || t === 2 || t === 3 ? t : null;
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const item = line.match(/^-\s+(.+)$/);
    if (item) out[current].push(item[1].trim());
  }
  return out;
}

function stripFrontmatterAndComments(md: string): string {
  // 先归一化换行，避免 CRLF 让 frontmatter 正则失效
  const normalized = md.replace(/\r\n/g, "\n");
  // 去 frontmatter；保留行号 → 用换行替换
  let body = normalized.replace(/^---\n[\s\S]*?\n---\n/, (m) =>
    "\n".repeat(m.split("\n").length - 1),
  );
  // 去 SCENE 注释块；保留换行 → 行号不漂，列号在每行内部仍准
  body = body.replace(/<!--[^]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  return body;
}

export function scanSlop(chapterMd: string, antiSlopMd: string): SlopHit[] {
  const vocab = parseAntiSlop(antiSlopMd);
  const body = stripFrontmatterAndComments(chapterMd);
  const lines = body.split("\n");
  const hits: SlopHit[] = [];

  const tiers: Array<1 | 2 | 3> = [1, 2, 3];
  for (const tier of tiers) {
    for (const term of vocab[tier]) {
      if (!term) continue;
      for (let i = 0; i < lines.length; i++) {
        let from = 0;
        while (true) {
          const idx = lines[i].indexOf(term, from);
          if (idx === -1) break;
          hits.push({ tier, term, line: i + 1, column: idx + 1 });
          from = idx + term.length;
        }
      }
    }
  }
  return hits;
}
