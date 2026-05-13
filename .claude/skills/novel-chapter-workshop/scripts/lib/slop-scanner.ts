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
  for (const line of md.split("\n")) {
    const head = line.match(/^##\s+Tier\s+(\d)/);
    if (head) {
      const t = parseInt(head[1], 10);
      current = (t === 1 || t === 2 || t === 3 ? t : null) as 1 | 2 | 3 | null;
      continue;
    }
    if (!current) continue;
    const item = line.match(/^-\s+(.+)$/);
    if (item) out[current].push(item[1].trim());
  }
  return out;
}

function stripFrontmatterAndComments(md: string): string {
  // 去 frontmatter；保留行号 → 用换行替换
  let body = md.replace(/^---\n[\s\S]*?\n---\n/, (m) =>
    "\n".repeat(m.split("\n").length - 1),
  );
  // 去 SCENE 注释行（只去 <!-- ... --> 标签本身，正文保留）
  body = body.replace(/<!--[^]*?-->/g, (m) => " ".repeat(m.length));
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
