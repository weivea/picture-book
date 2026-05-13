// .claude/skills/scene-illustrator/scripts/lib/scene-prompt-builder.ts

import { join } from "node:path";
import type { Scene, Mood } from "../../../novel-chapter-workshop/scripts/lib/scene-marker-parser";

export interface StyleInfo {
  promptPrefix: string;
  negative: string;
}

export interface BuildOpts {
  portraitsDir: string;
}

export interface BuildResult {
  prompt: string;
  refPath: string | null; // 第一个 participant 的立绘路径
}

const MOOD_DESCRIPTOR: Record<Mood, string> = {
  calm: "calm atmosphere, soft natural light",
  tense: "tense atmosphere, harsh contrast lighting",
  ominous: "ominous atmosphere, deep shadows, low key light",
  melancholy: "melancholy atmosphere, muted tones, overcast light",
  joyful: "joyful atmosphere, warm sunlight, bright palette",
  fearful: "fearful atmosphere, sharp shadows, off-center composition",
  awe: "awe-inspiring atmosphere, vast scale, golden hour light",
  defiant: "defiant atmosphere, strong silhouette, backlight",
  tender: "tender atmosphere, soft warm light, intimate framing",
  furious: "furious atmosphere, dynamic motion blur, red accents",
  lonely: "lonely atmosphere, wide empty space, cold palette",
  mysterious: "mysterious atmosphere, fog, partial silhouette",
};

function describeBody(body: string): string {
  // 极简：截前 80 字 → 让模型当场景动作描述
  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80) + "…" : cleaned;
}

export function buildScenePrompt(
  scene: Scene,
  anchors: Map<string, string>,
  style: StyleInfo,
  opts: BuildOpts,
): BuildResult {
  const parts: string[] = [];
  parts.push(style.promptPrefix);
  parts.push(MOOD_DESCRIPTOR[scene.mood]);

  const anchorParts: string[] = [];
  for (const name of scene.participants) {
    const a = anchors.get(name);
    if (!a) throw new Error(`参与者 "${name}" 不在 characters.md 锚定表中`);
    anchorParts.push(a);
  }
  if (anchorParts.length) parts.push(anchorParts.join("; "));
  parts.push(describeBody(scene.body));
  parts.push(style.negative);

  const prompt = parts.filter(Boolean).join(", ");
  const refPath = scene.participants.length
    ? join(opts.portraitsDir, `${scene.participants[0]}.png`)
    : null;
  return { prompt, refPath };
}
