# Design: High-fidelity PNG Compression in `image-generation` Skill

- **Date**: 2026-05-12
- **Skill affected**: `.claude/skills/image-generation/`
- **Status**: Approved (ready for implementation plan)

## Problem

Azure `gpt-image-2` returns PNGs of roughly 2 MB each at 1024×1024.
A 12-page picture book therefore carries about 24 MB of imagery, and the EPUB
that the `picture-book-creator` skill produces inherits that bloat. We want to
shrink each PNG before it is handed to downstream consumers, without changing
its format, dimensions, or any caller's interface.

## Goals

- Compress every PNG written by `generate-image.ts` in place (same `--output`
  path, still PNG).
- Target ≈20–35 % of the original size at perceptually no loss for flat,
  illustration-style images. A 12-page book should drop from ~24 MB to ~6–9 MB.
- Keep the skill's public contract unchanged:
  - `--output` path semantics
  - exit code semantics (0 = a PNG exists at `--output`, 1 = hard failure)
  - stdout still emits one `OK …` line on success
- Never break the picture-book pipeline because compression failed: if the
  compressor can't run, fall back to the original (uncompressed) PNG and log a
  warning.

## Non-Goals

- Changing the output format (no WebP, no JPEG).
- Changing resolution or aspect ratio.
- Touching `picture-book-creator`, `audio-picture-book-creator`, or the EPUB
  generator. They keep working unchanged because the file at `--output` is
  still a PNG with the same path and pixel dimensions.
- Cross-platform binary downloading or WASM fallback. We rely on the npm
  packages, which ship per-platform prebuilt binaries.
- Anything beyond PNG → PNG compression (no `sharp`, no resizing, no
  metadata enrichment).

## Architecture Overview

Two files change. No new modules.

```
package.json
└─ dependencies
   ├─ pngquant-bin   ^9.0.0   (lossy palette quantization)
   └─ oxipng-bin     latest   (lossless re-encode)

.claude/skills/image-generation/scripts/
├─ generate-image.ts      ← Step 6 ("decode + write to disk") delegates to
│                            compress-png.ts before the success log line.
├─ compress-png.ts        ← NEW. Pure helper, no CLI side-effects.
│                            Exports compressPngInPlace().
└─ generate-image.test.ts ← NEW. Unit-tests compress-png.ts with fixtures.
```

The compression logic lives **inline** in the skill (per the user's "一体化"
decision in brainstorming) — it is split into `compress-png.ts` only so it
is testable without triggering `generate-image.ts`'s top-level side-effects
(env loading, arg parsing, `process.exit`). Externally there is still one
entrypoint: `bun run …/generate-image.ts`.

## Compression Pipeline

After Azure returns the base64 PNG, the script:

1. Decodes base64 into a Buffer (unchanged from today).
2. Writes the buffer to a temporary file `<output>.raw.png` (sibling of the
   final output, so it lives on the same filesystem as the destination — a
   later `rename` is then atomic).
3. Runs `pngquant`:
   ```
   pngquant <output>.raw.png \
     --quality=80-95 \
     --speed=1 \
     --strip \
     --skip-if-larger \
     --output <output>.q.png \
     --force
   ```
4. Runs `oxipng`:
   ```
   oxipng -o 4 --strip safe --quiet \
     <output>.q.png \
     --out <output> \
     --force
   ```
5. Deletes the two temporary files (`*.raw.png`, `*.q.png`).
6. Emits the success line on stdout (see "stdout / stderr Contract").

### Parameter rationale

| Flag | Reason |
|---|---|
| pngquant `--quality=80-95` | Lower bound 80 is the "visually indistinguishable" threshold for flat illustration; below it pngquant would refuse and we'd treat that as a fallback signal. Upper bound 95 prevents over-quantization. |
| pngquant `--speed=1` | Slowest, highest-quality palette search. We're processing a single 1024² image; the extra time is negligible vs. the ~60 s API call that produced it. |
| pngquant `--strip` | Removes ancillary chunks (metadata) — PNGs from gpt-image-2 carry none we need. |
| pngquant `--skip-if-larger` | If quantization would *increase* size (rare, only on already-tiny palettes), pngquant exits 98 and writes nothing. The pipeline treats exit 98 as "use the raw file as oxipng's input" rather than a failure. |
| oxipng `-o 4` | Default optimization level; balances ratio vs. CPU. Level 6 squeezes ~1–3 % more at several × the CPU — not worth it. |
| oxipng `--strip safe` | Strip metadata that doesn't affect rendering. |

### Binary discovery

`pngquant-bin` and `oxipng-bin` both export the absolute path to their bundled
binary as the package's default export. The script imports them as:

```ts
import pngquantPath from "pngquant-bin";
import oxipngPath from "oxipng-bin";
```

and invokes them via `node:child_process` `execFile` with a 30 s timeout. No
shell, no PATH lookup.

## Fallback Behavior

The pipeline falls back to the original PNG (i.e., copies `<output>.raw.png`
to `<output>`) and emits a `WARN` to stderr — but **still exits 0** — when
**any** of these happen:

1. The `pngquant-bin` or `oxipng-bin` package fails to resolve / its binary
   isn't executable on this platform.
2. `pngquant` exits non-zero **and** the exit code is **not** 98 (98 means
   "skip-if-larger fired" — handled as a normal branch, see above).
3. `oxipng` exits non-zero.
4. Either child process exceeds a 30 s wall-clock timeout.
5. Any unexpected exception inside the pipeline (filesystem error during
   rename / unlink, etc.).

In all cases the temporary files (`*.raw.png`, `*.q.png`) are best-effort
deleted before exit.

The rationale for `exit 0` even on fallback: the skill's contract is "after
exit 0 there is a usable PNG at `--output`". A fallback still satisfies that;
forcing a hard failure would waste the API call that just succeeded and
cascade into picture-book-creator's "failed page" handling.

## Bypass Switch

`SKIP_PNG_COMPRESS=1` in the environment causes the script to skip steps 3–5
entirely and write the raw buffer straight to `<output>` — useful for
debugging quality regressions or producing a "before" baseline. The success
line in this mode says `(uncompressed, SKIP_PNG_COMPRESS=1)`.

A `--no-compress` CLI flag is **not** added; an env var is enough and avoids
expanding the public CLI surface.

## stdout / stderr Contract

### Success, compression worked

```
OK <abs path> (<final_kb> KB, 1024x1024, quality=high, compressed from <orig_kb> KB / <ratio>%)
```

Example:
```
OK /…/output/foo/0.png (478.3 KB, 1024x1024, quality=high, compressed from 2034.1 KB / 23%)
```

### Success, fallback to raw

```
[generate-image] WARN: 压缩失败 (<reason>)，已落盘原始 PNG
OK <abs path> (<orig_kb> KB, 1024x1024, quality=high, uncompressed)
```

### Success, bypass via env

```
OK <abs path> (<orig_kb> KB, 1024x1024, quality=high, uncompressed, SKIP_PNG_COMPRESS=1)
```

### Hard failure (unchanged from today)

`exit 1` and a single stderr line as today (network error, missing
AZURE_API_KEY, write failure, …).

The `OK …` prefix and absolute-path field are preserved so any downstream
log-parser keeps working.

## Testing Strategy

A new `generate-image.test.ts` (Bun test) covers compression in isolation —
no Azure call, no `AZURE_API_KEY` needed.

To make this possible, the compression pipeline is extracted into a sibling
file `compress-png.ts` that exports one async function:

```ts
export async function compressPngInPlace(
  rawBuffer: Buffer,
  outputPath: string,
): Promise<{ finalBytes: number; origBytes: number; mode: "compressed" | "fallback" | "skipped" }>;
```

`generate-image.ts` is the sole importer of this file. The split exists only
to keep `generate-image.ts` free of top-level CLI side-effects (env-var
loading, `parseArgs`, `process.exit`) so the test file can import the
compression helper without those firing. From the caller's point of view the
skill is still "一体化": one CLI script, one entry point.

### Cases

1. **Happy path**: feed a real 1024×1024 PNG fixture (~1.5–2 MB) into
   `compressPngInPlace`. Assert:
   - Output file exists at the requested path.
   - Output file size < input size.
   - First 8 bytes of the output match the PNG magic number.
   - PNG IHDR width/height equal 1024 (parsed manually from bytes 16–23).
2. **Skip env**: set `SKIP_PNG_COMPRESS=1`, assert output equals input
   bytewise and `mode === "skipped"`.
3. **Fallback (binary missing)**: monkey-patch the resolved `pngquantPath`
   to a non-existent path before calling. Assert `mode === "fallback"`,
   output equals input, stderr contains `WARN`.
4. **Fallback (oxipng fails)**: same trick on `oxipngPath`.

Fixture lives at
`.claude/skills/image-generation/tests/fixtures/sample-2mb.png` — a real
generated page from `output/zhouwu-yuehao/` copied in (and committed; ~2 MB
in the repo is fine for a test fixture).

End-to-end Azure call is **not** tested here, matching today's behavior.

## Documentation Updates

`SKILL.md`:
- Top "Image Generation" paragraph: add a sentence noting that PNGs are
  passed through `pngquant + oxipng` for high-fidelity compression, target
  size ≈ 400–700 KB.
- Prerequisites section: add "首次使用前需在仓库根目录运行 `bun install`
  以拉取 `pngquant-bin` 和 `oxipng-bin`。"
- Quick Reference table: add a row for `SKIP_PNG_COMPRESS=1` env var.
- Behavior on Error table: add a `[generate-image] WARN: 压缩失败` row
  noting it is a warning, not an error (exit 0).

`README.md`: no change required — it doesn't enumerate skill internals.

## Risks & Tradeoffs

| Risk | Mitigation |
|---|---|
| `pngquant-bin` last released May 2024; could be abandoned | Binary itself is stable; if the package goes truly dead we can swap to `@jsquash/oxipng` (WASM) without changing the pipeline shape. Fallback path keeps things working in the meantime. |
| `node_modules` grows ~10 MB from two prebuilt binaries | Dev-only; doesn't ship into EPUB output. Acceptable. |
| Compression adds 1–3 s per image | At 4-way concurrency for 12 pages, that's ≤ 9 s added end-to-end against ~60 s/image API time. Negligible. |
| Quantization to 256-color palette could band subtle gradients | `--quality=80-95` keeps pngquant in the perceptually-lossless range for flat illustration. Worst case the user sees it and re-runs with `SKIP_PNG_COMPRESS=1`. |
| Two binary downloads on `bun install` could fail offline | Standard install-time failure mode for any prebuilt-binary package; `bun install` will surface it loudly. Not our problem to solve. |

## Open Questions

None. All design decisions were settled during brainstorming.

## Out of Scope (Explicitly)

- Resizing / down-rendering PNGs to lower resolution.
- WebP or AVIF output.
- A standalone `compress-png` skill or CLI.
- Compressing pre-existing PNGs in `output/` (a one-off script the user
  could run by hand if they want — not part of this skill).
