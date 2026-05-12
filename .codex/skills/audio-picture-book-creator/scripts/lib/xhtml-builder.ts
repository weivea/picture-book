export interface BuildPageXhtmlInput {
  pageNum: number;
  imageFile: string;        // 如 "1.png"
  sentences: string[];      // 已拆好的句子（直接来自 tts 产出 json 的 sentences[].text）
  viewportWidth: number;
  viewportHeight: number;
}

export function buildPageXhtml(input: BuildPageXhtmlInput): string {
  const { pageNum, imageFile, sentences, viewportWidth, viewportHeight } = input;

  const spans = sentences
    .map(
      (s, i) =>
        `    <span id="p${pageNum}-s${i + 1}">${escapeXml(s)}</span>`
    )
    .join("\n");

  const captionBlock =
    sentences.length > 0
      ? `\n  <p class="caption">\n${spans}\n  </p>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${viewportWidth}, height=${viewportHeight}"/>
  <title>第 ${pageNum} 页</title>
  <style>
    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; }
    img { display:block; width:100%; height:100%; object-fit:contain; }
    .caption { position:absolute; bottom:2%; left:5%; right:5%;
               text-align:center; font-size:2.5em; color:#333;
               font-family:serif; line-height:1.6; margin:0; }
    .caption .-epub-media-overlay-active { background:#fff5b3; }
  </style>
</head>
<body>
  <img src="images/${imageFile}" alt="第${pageNum}页"/>${captionBlock}
</body>
</html>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
