// .claude/skills/audio-novel-packager/scripts/lib/voice-resolver.ts

export interface CharacterVoice {
  name: string;
  voice: string;
}

export function resolveVoice(
  speaker: string,
  characters: CharacterVoice[],
  narratorVoice: string,
): string {
  if (!speaker || speaker === "narrator") return narratorVoice;
  const hit = characters.find((c) => c.name === speaker);
  return hit ? hit.voice : narratorVoice;
}
