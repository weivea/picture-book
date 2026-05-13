// .claude/skills/illustrated-audio-novel-creator/scripts/lib/tier-config.ts

export type Tier = "short" | "medium" | "long";

export interface TierConfig {
  tier: Tier;
  chapter_count: number;
  words_per_chapter: number;
  target_words: number;
  beat_structure: "5-act" | "9-beat" | "save-the-cat-15";
  opus_review_enabled: boolean;
}

const TABLE: Record<Tier, Omit<TierConfig, "tier" | "target_words">> = {
  short: {
    chapter_count: 5,
    words_per_chapter: 2000,
    beat_structure: "5-act",
    opus_review_enabled: false,
  },
  medium: {
    chapter_count: 12,
    words_per_chapter: 2500,
    beat_structure: "9-beat",
    opus_review_enabled: false,
  },
  long: {
    chapter_count: 24,
    words_per_chapter: 3000,
    beat_structure: "save-the-cat-15",
    opus_review_enabled: true,
  },
};

export function tierToConfig(tier: Tier): TierConfig {
  const row = TABLE[tier];
  if (!row) throw new Error(`非法 tier: ${tier}（合法值：short|medium|long）`);
  return {
    tier,
    ...row,
    target_words: row.chapter_count * row.words_per_chapter,
  };
}

// CLI 入口
if (import.meta.main) {
  const tier = process.argv[2] as Tier | undefined;
  if (!tier) {
    console.error("用法: bun run tier-config.ts <short|medium|long>");
    process.exit(1);
  }
  console.log(JSON.stringify(tierToConfig(tier), null, 2));
}
