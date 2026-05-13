import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import { resolve } from "path";

const SCRIPT = resolve(
  ".claude/skills/image-generation/scripts/generate-image.ts"
);
const REF = resolve(
  ".claude/skills/image-generation/scripts/test/fixtures/tiny-ref.png"
);

describe("--ref routing", () => {
  it("rejects --ref pointing to non-existent file", () => {
    const out = "/tmp/test-out-noref.png";
    const res = spawnSync(
      "bun",
      ["run", SCRIPT, "--prompt", "x", "--output", out, "--ref", "/no/such/file.png"],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT:
            "https://test.invalid/openai/deployments/x/images/generations?api-version=2024-02-01",
        },
      }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--ref 文件不存在");
  });

  it("rejects more than 3 --ref values", () => {
    const out = "/tmp/test-out-3ref.png";
    const res = spawnSync(
      "bun",
      [
        "run", SCRIPT,
        "--prompt", "x",
        "--output", out,
        "--ref", REF, "--ref", REF, "--ref", REF, "--ref", REF,
      ],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          AZURE_API_KEY: "fake",
          AZURE_IMAGE_ENDPOINT:
            "https://test.invalid/openai/deployments/x/images/generations?api-version=2024-02-01",
        },
      }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("最多支持 3 张参考图");
  });
});
