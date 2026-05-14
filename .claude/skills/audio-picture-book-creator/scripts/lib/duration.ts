/**
 * 毫秒 → EPUB3 `media:duration` 的 SMIL3 clock value（full clock value）。
 *
 * EPUB3 规范要求 `media:duration` 是 SMIL3 clock value（W3C SMIL 3.0 §10.3.1），
 * 不是 ISO 8601 duration。常见错误是写成 `PT445.992S`（ISO 8601）—— epubcheck 会
 * 报 RSC-005 "must be a valid SMIL3 clock value"，Readium / Thorium 也会因此拒绝
 * 启用 Media Overlay 控件。
 *
 * 这里输出 full clock value：`HH:MM:SS.sss`（Readium 兼容性最好）。
 *
 * 例：4820 → "00:00:04.820"；445_992 → "00:07:25.992"
 */
export function msToISO8601(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${String(millis).padStart(3, "0")}`;
}

/**
 * 毫秒 → SMIL clipBegin/clipEnd 的 full clock value 格式 `H:MM:SS.fff`。
 *
 * SMIL3 spec 允许 `Nms`（如 "5328ms"），但 Readium / Thorium 对 ms 后缀有已知
 * 解析 bug —— 一旦解析失败，整个 Media Overlay 就不会被注册（UI 上没有 ▶ 按钮）。
 * 官方 Moby-Dick MO 样本用 full clock value，照搬最稳。
 *
 * 例：5328 → "0:00:05.328"；3_661_500 → "1:01:01.500"
 */
export function msToClipMs(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${String(millis).padStart(3, "0")}`;
}
