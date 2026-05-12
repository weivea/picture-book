import { describe, expect, test } from "bun:test";
import { buildSilentMp3 } from "../lib/silent-mp3";

describe("buildSilentMp3", () => {
  test("生成至少指定时长的 MP3 静音帧", () => {
    const audio = buildSilentMp3(2000);

    expect(audio.length).toBe(84 * 144);
    expect([...audio.subarray(0, 4)]).toEqual([0xff, 0xf3, 0x64, 0xc4]);
    expect(audio.subarray(144, 148).equals(audio.subarray(0, 4))).toBe(true);
  });

  test("非正数时长生成空 buffer", () => {
    expect(buildSilentMp3(0).length).toBe(0);
    expect(buildSilentMp3(-100).length).toBe(0);
  });
});
