import { describe, it, expect, afterEach } from "bun:test";
import { readInputFidelity } from "../../lib/input-fidelity";

const ORIG = process.env.IMAGE_GEN_INPUT_FIDELITY;
afterEach(() => {
  if (ORIG === undefined) delete process.env.IMAGE_GEN_INPUT_FIDELITY;
  else process.env.IMAGE_GEN_INPUT_FIDELITY = ORIG;
});

describe("readInputFidelity", () => {
  it("默认 high（env 未设）", () => {
    delete process.env.IMAGE_GEN_INPUT_FIDELITY;
    expect(readInputFidelity()).toBe("high");
  });
  it("空字符串视为未设 → high", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "";
    expect(readInputFidelity()).toBe("high");
  });
  it("low / auto / off / high 都允许", () => {
    for (const v of ["low", "auto", "off", "high"] as const) {
      process.env.IMAGE_GEN_INPUT_FIDELITY = v;
      expect(readInputFidelity()).toBe(v);
    }
  });
  it("两侧空白被 trim", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "  low  ";
    expect(readInputFidelity()).toBe("low");
  });
  it("非法值抛错（含原始值）", () => {
    process.env.IMAGE_GEN_INPUT_FIDELITY = "HIGH";
    expect(() => readInputFidelity()).toThrow(/IMAGE_GEN_INPUT_FIDELITY/);
    process.env.IMAGE_GEN_INPUT_FIDELITY = "medium";
    expect(() => readInputFidelity()).toThrow(/medium/);
  });
});
