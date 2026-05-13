import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { findVenvPython } from "../lib/env";

const roots: string[] = [];

async function makeRoot(name: string): Promise<string> {
  const root = join(tmpdir(), `tts-env-${name}-${Date.now()}-${roots.length}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("findVenvPython", () => {
  test("finds Windows venv python", async () => {
    const root = await makeRoot("windows");
    const python = join(root, ".venv", "Scripts", "python.exe");
    await mkdir(join(root, ".venv", "Scripts"), { recursive: true });
    await writeFile(python, "");

    expect(findVenvPython(root)).toBe(python);
  });

  test("finds macOS/Linux venv python", async () => {
    const root = await makeRoot("posix");
    const python = join(root, ".venv", "bin", "python");
    await mkdir(join(root, ".venv", "bin"), { recursive: true });
    await writeFile(python, "");

    expect(findVenvPython(root)).toBe(python);
  });

  test("walks upward from nested directories", async () => {
    const root = await makeRoot("nested");
    const nested = join(root, "output", "book");
    const python = join(root, ".venv", "bin", "python3");
    await mkdir(nested, { recursive: true });
    await mkdir(join(root, ".venv", "bin"), { recursive: true });
    await writeFile(python, "");

    expect(findVenvPython(nested)).toBe(python);
  });
});
