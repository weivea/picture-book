import { readFile } from "fs/promises";

export interface PageText {
  pageNum: number;
  text: string;
}

/**
 * 解析 picture-book-creator 产出的 script.md，提取每页的 text 字段。
 *
 * 复用现有 generate-epub.ts 中的正则模式（见 picture-book-creator/scripts/generate-epub.ts:57）。
 */
export async function parseScript(scriptPath: string): Promise<PageText[]> {
  const content = await readFile(scriptPath, "utf-8");
  const pattern = /## 第 (\d+) 页[\s\S]*?\*\*text\*\*[：:]\s*(.+)/g;
  const result: PageText[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    result.push({
      pageNum: parseInt(match[1]!, 10),
      text: match[2]!.trim(),
    });
  }
  return result.sort((a, b) => a.pageNum - b.pageNum);
}
