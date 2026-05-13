import { describe, it, expect } from "bun:test";
import { assignVoices, type CharacterForVoice } from "../lib/voice-assigner";

const catalog = `# edge-tts voice catalog (zh-CN)

## 主角推荐
- zh-CN-XiaoxiaoNeural | female | warm, expressive
- zh-CN-YunyangNeural | male | calm, narrator-friendly

## 配角池
- zh-CN-YunjianNeural | male | rough
- zh-CN-XiaoyiNeural | female | youthful
- zh-CN-YunxiNeural | male | bright
- zh-CN-XiaomengNeural | female | sweet

## 旁白
- zh-CN-YunyangNeural | male | calm, narrator-friendly
`;

describe("assignVoices", () => {
  it("主角拿到主角池中的 voice", () => {
    const chars: CharacterForVoice[] = [
      { name: "林晚", role: "主角", gender_hint: "female" },
      { name: "沈渊", role: "导师", gender_hint: "male" },
      { name: "周泽", role: "盟友", gender_hint: "male" },
      { name: "苏雨", role: "对手", gender_hint: "female" },
    ];
    const result = assignVoices(chars, catalog);
    expect(result["林晚"]).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("同性别多个角色 voice 不重复（在池足够时）", () => {
    const chars: CharacterForVoice[] = [
      { name: "A", role: "主角", gender_hint: "female" },
      { name: "B", role: "配角", gender_hint: "female" },
      { name: "C", role: "配角", gender_hint: "female" },
    ];
    const result = assignVoices(chars, catalog);
    const voices = Object.values(result);
    expect(new Set(voices).size).toBe(voices.length);
  });

  it("结果确定性：同输入两次调用结果相同", () => {
    const chars: CharacterForVoice[] = [
      { name: "A", role: "主角", gender_hint: "female" },
      { name: "B", role: "对手", gender_hint: "male" },
    ];
    expect(assignVoices(chars, catalog)).toEqual(assignVoices(chars, catalog));
  });

  it("旁白固定为 catalog 中标注的 narrator voice", () => {
    const chars: CharacterForVoice[] = [
      { name: "旁白", role: "旁白", gender_hint: "male" },
    ];
    const result = assignVoices(chars, catalog);
    expect(result["旁白"]).toBe("zh-CN-YunyangNeural");
  });
});
