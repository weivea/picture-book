const SAMPLE_RATE = 24000;
const SAMPLES_PER_FRAME = 576;
const FRAME_DURATION_MS = (SAMPLES_PER_FRAME / SAMPLE_RATE) * 1000;

// Matches edge-tts' default MP3 stream: MPEG-2 Layer III, 24kHz, 48kbps, mono.
const SILENT_MP3_FRAME = Buffer.from([
  0xff, 0xf3, 0x64, 0xc4,
  ...new Array(140).fill(0x00),
]);

export function buildSilentMp3(durationMs: number): Buffer {
  if (durationMs <= 0) return Buffer.alloc(0);

  const frameCount = Math.ceil(durationMs / FRAME_DURATION_MS);
  return Buffer.concat(new Array(frameCount).fill(SILENT_MP3_FRAME));
}
