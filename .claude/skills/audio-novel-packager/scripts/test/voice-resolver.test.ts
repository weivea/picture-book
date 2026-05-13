// .claude/skills/audio-novel-packager/scripts/test/voice-resolver.test.ts
import { describe, it, expect } from "bun:test";
import { resolveVoice, type CharacterVoice } from "../lib/voice-resolver";

const characters: CharacterVoice[] = [
  { name: "林晚", voice: "zh-CN-XiaoxiaoNeural" },
  { name: "沈渊", voice: "zh-CN-YunyangNeural" },
];
const narratorVoice = "zh-CN-YunyangNeural";

describe("resolveVoice", () => {
  it("narrator 命中 narrator voice", () => {
    expect(resolveVoice("narrator", characters, narratorVoice)).toBe(narratorVoice);
  });
  it("已知角色命中其 voice", () => {
    expect(resolveVoice("林晚", characters, narratorVoice)).toBe("zh-CN-XiaoxiaoNeural");
  });
  it("未知角色 → narrator voice", () => {
    expect(resolveVoice("过路人", characters, narratorVoice)).toBe(narratorVoice);
  });
  it("空 speaker（防御）→ narrator voice", () => {
    expect(resolveVoice("", characters, narratorVoice)).toBe(narratorVoice);
  });
  it("同名角色按 characters 顺序取第一个", () => {
    const dup: CharacterVoice[] = [
      { name: "影", voice: "voice-A" },
      { name: "影", voice: "voice-B" },
    ];
    expect(resolveVoice("影", dup, narratorVoice)).toBe("voice-A");
  });
});
