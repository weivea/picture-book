/**
 * 中文句子拆分。
 *
 * 规则（见 spec §6.1）：
 * - 主分隔符 。！？ 切句并保留标点
 * - 引号 ""「」 包裹的对话作为整体不拆（即引号内的句末标点不触发切分）
 * - 拆出的某段 > 25 字时，按 ，； 二次拆短
 * - 过滤空字符串
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  // 阶段 1：按主分隔符切，但引号内的标点不算
  const primary = splitRespectingQuotes(trimmed, /[。！？]/);

  // 阶段 2：长段二次拆
  const result: string[] = [];
  for (const seg of primary) {
    if (seg.length > 25) {
      const parts = splitRespectingQuotes(seg, /[，；]/);
      for (const p of parts) {
        if (p !== "") result.push(p);
      }
    } else {
      if (seg !== "") result.push(seg);
    }
  }
  return result;
}

/**
 * 按 splitter 切分，但跳过 ""「」 引号内的字符。
 * 切分点保留在前一段末尾。
 */
function splitRespectingQuotes(text: string, splitter: RegExp): string[] {
  const result: string[] = [];
  let buf = "";
  let inDQuote = false;
  let inCQuote = false;

  for (const ch of text) {
    buf += ch;
    if (ch === '"') inDQuote = !inDQuote;
    else if (ch === "「") inCQuote = true;
    else if (ch === "」") inCQuote = false;
    else if (!inDQuote && !inCQuote && splitter.test(ch)) {
      result.push(buf);
      buf = "";
    }
  }
  if (buf !== "") result.push(buf);
  return result;
}
