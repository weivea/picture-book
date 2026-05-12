// .codex/skills/image-generation/scripts/compress-png.ts
/**
 * 把一段 PNG buffer 经 pngquant + oxipng 二级压缩后写到 outputPath。
 *
 * - 任一环节失败 → fallback：把原始 buffer 写到 outputPath，返回 mode=fallback。
 * - 环境变量 SKIP_PNG_COMPRESS=1 → 直接写原图，返回 mode=skipped。
 * - 子进程超时上限 30s。
 *
 * 调用方（generate-image.ts）只关心：函数总会让 outputPath 上有一个能用的 PNG。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rename, unlink, stat } from "fs/promises";
import { dirname, basename, join } from "path";

import pngquantPath from "pngquant-bin";
import oxipngPath from "oxipng-bin";

// 测试 hook：允许测试覆盖 pngquant / oxipng 二进制路径。生产代码无人调用。
let pngquantBin: string = pngquantPath as unknown as string;
let oxipngBin: string = oxipngPath as unknown as string;

export function __setBinariesForTest(opts: {
  pngquant?: string;
  oxipng?: string;
}): () => void {
  const prevP = pngquantBin;
  const prevO = oxipngBin;
  if (opts.pngquant !== undefined) pngquantBin = opts.pngquant;
  if (opts.oxipng !== undefined) oxipngBin = opts.oxipng;
  return () => {
    pngquantBin = prevP;
    oxipngBin = prevO;
  };
}

const execFileP = promisify(execFile);

const TIMEOUT_MS = 30_000;
const PNGQUANT_SKIP_IF_LARGER_EXIT = 98;

export type CompressMode = "compressed" | "fallback" | "skipped";

export interface CompressResult {
  mode: CompressMode;
  finalBytes: number;
  origBytes: number;
  fallbackReason?: string;
}

export async function compressPngInPlace(
  rawBuffer: Buffer,
  outputPath: string,
): Promise<CompressResult> {
  const origBytes = rawBuffer.length;

  if (process.env.SKIP_PNG_COMPRESS === "1") {
    await writeFile(outputPath, rawBuffer);
    return { mode: "skipped", finalBytes: origBytes, origBytes };
  }

  const dir = dirname(outputPath);
  const base = basename(outputPath);
  const rawTmp = join(dir, `${base}.raw.png`);
  const qTmp = join(dir, `${base}.q.png`);

  try {
    // 写 raw 到磁盘（pngquant 需要文件输入）
    await writeFile(rawTmp, rawBuffer);

    // ---- pngquant ----
    let pngquantOk = true;
    try {
      await execFileP(
        pngquantBin,
        [
          rawTmp,
          "--quality=80-95",
          "--speed=1",
          "--strip",
          "--skip-if-larger",
          "--output",
          qTmp,
          "--force",
        ],
        { timeout: TIMEOUT_MS },
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException & { code?: number | string })
        .code;
      if (code === PNGQUANT_SKIP_IF_LARGER_EXIT) {
        // pngquant 觉得量化反而变大，把 raw 当作 oxipng 的输入。
        await rename(rawTmp, qTmp);
      } else {
        pngquantOk = false;
        await fallback(
          rawBuffer,
          outputPath,
          rawTmp,
          qTmp,
          `pngquant failed: ${formatErr(err)}`,
        );
        return {
          mode: "fallback",
          origBytes,
          finalBytes: origBytes,
          fallbackReason: `pngquant failed: ${formatErr(err)}`,
        };
      }
    }

    if (pngquantOk) {
      // ---- oxipng ----
      try {
        await execFileP(
          oxipngBin,
          [
            "-o",
            "4",
            "--strip",
            "safe",
            "--quiet",
            qTmp,
            "--out",
            outputPath,
            "--force",
          ],
          { timeout: TIMEOUT_MS },
        );
      } catch (err) {
        await fallback(
          rawBuffer,
          outputPath,
          rawTmp,
          qTmp,
          `oxipng failed: ${formatErr(err)}`,
        );
        return {
          mode: "fallback",
          origBytes,
          finalBytes: origBytes,
          fallbackReason: `oxipng failed: ${formatErr(err)}`,
        };
      }
    }

    // 清理临时文件
    await Promise.all([
      unlink(rawTmp).catch(() => {}),
      unlink(qTmp).catch(() => {}),
    ]);

    const finalStat = await stat(outputPath);
    return {
      mode: "compressed",
      origBytes,
      finalBytes: finalStat.size,
    };
  } catch (err) {
    await fallback(
      rawBuffer,
      outputPath,
      rawTmp,
      qTmp,
      `unexpected: ${formatErr(err)}`,
    );
    return {
      mode: "fallback",
      origBytes,
      finalBytes: origBytes,
      fallbackReason: `unexpected: ${formatErr(err)}`,
    };
  }
}

async function fallback(
  rawBuffer: Buffer,
  outputPath: string,
  rawTmp: string,
  qTmp: string,
  reason: string,
): Promise<void> {
  // 落盘原图，覆盖任何已存在的 outputPath（可能 oxipng 写到一半失败）
  await writeFile(outputPath, rawBuffer);
  await Promise.all([
    unlink(rawTmp).catch(() => {}),
    unlink(qTmp).catch(() => {}),
  ]);
  // reason 通过返回值传给上层；这里不直接 stderr，让 generate-image 统一打 WARN
  void reason;
}

function formatErr(err: unknown): string {
  if (!err) return "unknown";
  if (err instanceof Error) return err.message.split("\n")[0];
  return String(err);
}
