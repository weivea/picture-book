export interface Word {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface Sentence {
  text: string;
  start_ms: number;
  end_ms: number;
}

/**
 * 按句子在原文中的位置区间，把 words 分组为句级时间戳。
 * 见 spec §6.2。
 */
export function aggregateToSentences(
  text: string,
  sentences: string[],
  words: Word[]
): Sentence[] {
  // 计算每个句子在原文中的 [charStart, charEnd) 位置
  const positions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of sentences) {
    const idx = text.indexOf(s, cursor);
    positions.push({ start: idx, end: idx + s.length });
    cursor = idx + s.length;
  }

  // 给每个 word 标注它在原文中的字符位置（顺序匹配，避免重复词混淆）
  const wordPositions: Array<{ word: Word; charStart: number }> = [];
  let wcursor = 0;
  for (const w of words) {
    const idx = text.indexOf(w.text, wcursor);
    if (idx === -1) continue; // word 找不到（罕见），跳过
    wordPositions.push({ word: w, charStart: idx });
    wcursor = idx + w.text.length;
  }

  const result: Sentence[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const pos = positions[i]!;
    const matched = wordPositions.filter(
      (wp) => wp.charStart >= pos.start && wp.charStart < pos.end
    );

    if (matched.length > 0) {
      result.push({
        text: sentences[i]!,
        start_ms: matched[0]!.word.start_ms,
        end_ms: matched[matched.length - 1]!.word.end_ms,
      });
    } else {
      // 兜底：取前句 end_ms 作为 start，后句的第一个 word 的 start_ms 作为 end
      const prevEnd = i > 0 ? result[i - 1]!.end_ms : 0;
      let nextStart = 0;
      for (let j = i + 1; j < sentences.length; j++) {
        const npos = positions[j]!;
        const nm = wordPositions.find((wp) => wp.charStart >= npos.start);
        if (nm) {
          nextStart = nm.word.start_ms;
          break;
        }
      }
      if (nextStart === 0) nextStart = prevEnd;
      result.push({
        text: sentences[i]!,
        start_ms: prevEnd,
        end_ms: nextStart,
      });
    }
  }
  return result;
}

/**
 * 时间戳健全性校验（spec §6.3）。
 * 若 words 报告总时长与 mp3 实际 duration 偏差 > 10%，按比例线性重整。
 */
export function sanityCheck(
  sentences: Sentence[],
  actualDurationMs: number
): { sentences: Sentence[]; adjusted: boolean } {
  if (sentences.length === 0) {
    return { sentences: [], adjusted: true };
  }

  const reportedDuration = sentences[sentences.length - 1]!.end_ms;
  if (reportedDuration === 0) {
    return { sentences, adjusted: false };
  }

  const ratio = actualDurationMs / reportedDuration;
  const deviation = Math.abs(ratio - 1);

  if (deviation <= 0.1) {
    return { sentences, adjusted: false };
  }

  const adjusted = sentences.map((s) => ({
    text: s.text,
    start_ms: Math.round(s.start_ms * ratio),
    end_ms: Math.round(s.end_ms * ratio),
  }));
  return { sentences: adjusted, adjusted: true };
}
