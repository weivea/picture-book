import { existsSync } from "fs";
import { join, dirname, resolve } from "path";

/**
 * 从 cwd 向上递归查找最近的 .venv 目录，返回其中 python 可执行文件的绝对路径。
 * 找不到则返回 null。
 */
export function findVenvPython(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidates = [
      join(dir, ".venv", "Scripts", "python.exe"),
      join(dir, ".venv", "bin", "python"),
      join(dir, ".venv", "bin", "python3"),
    ];
    for (const venvPython of candidates) {
      if (existsSync(venvPython)) return venvPython;
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // hit filesystem root
    dir = parent;
  }
}
