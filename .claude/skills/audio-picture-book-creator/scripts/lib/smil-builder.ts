import { msToClipMs } from "./duration";

export interface Sentence {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface BuildSmilInput {
  pageNum: number;
  sentences: Sentence[];
}

/**
 * 生成单页 SMIL 文件内容。
 * 输出位置约定：OEBPS/smil/page-N.smil
 * 引用约定：xhtml 在 ../page-N.xhtml，audio 在 ../audio/N.mp3
 */
export function buildSmil(input: BuildSmilInput): string {
  const { pageNum, sentences } = input;
  const pars = sentences
    .map((_, i) => {
      const sIdx = i + 1;
      return `      <par id="par${pageNum}-${sIdx}">
        <text src="../page-${pageNum}.xhtml#p${pageNum}-s${sIdx}"/>
        <audio src="../audio/${pageNum}.mp3" clipBegin="${msToClipMs(
        sentences[i]!.start_ms
      )}" clipEnd="${msToClipMs(sentences[i]!.end_ms)}"/>
      </par>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"
      xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq${pageNum}" epub:textref="../page-${pageNum}.xhtml" epub:type="bodymatter chapter">
${pars}
    </seq>
  </body>
</smil>`;
}
