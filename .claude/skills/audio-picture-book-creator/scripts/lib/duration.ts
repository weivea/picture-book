/**
 * 毫秒 → EPUB3 media:duration 的 ISO 8601 PT 格式。
 * 例：4820 → "PT4.820S"
 */
export function msToISO8601(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const millis = ms % 1000;
  return `PT${seconds}.${String(millis).padStart(3, "0")}S`;
}

/**
 * 毫秒 → SMIL clipBegin/clipEnd 的 "Nms" 格式。
 */
export function msToClipMs(ms: number): string {
  return `${ms}ms`;
}
