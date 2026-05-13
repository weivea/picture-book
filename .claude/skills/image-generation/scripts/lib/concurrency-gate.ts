// .claude/skills/image-generation/scripts/lib/concurrency-gate.ts
//
// 跨进程并发上限。算法：MAX 个 slot 目录，靠 mkdir 原子性争抢。
//
// 用法：
//   const release = await acquireSlot();
//   try { /* do work */ } finally { await release(); }
//
// 配置（env，每次 acquireSlot 时读取）：
//   IMAGE_GEN_MAX_CONCURRENCY  整数 1..16，默认 2
//   IMAGE_GEN_SEMA_DIR         信号量根目录，默认 /tmp/image-gen-sema
//
// 异常容错：
//   - 进程崩溃留下的 lock 在下一次 acquire 时被回收，判据：
//     a) lock/pid 中的 pid 已不可被 kill -0（ESRCH）
//     b) lock/started 距今 > STALE_AGE_MS（兜底，避免 pid 复用误判）
//
// 不依赖任何外部包，仅用 node:fs/promises + process.kill(pid, 0)。

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX = 2;
const MAX_LIMIT = 16;
const STALE_AGE_MS = 10 * 60 * 1000; // 10 min
const POLL_BASE_MS = 200;
const POLL_JITTER_MS = 50;

function readMaxConcurrency(): number {
  const raw = process.env.IMAGE_GEN_MAX_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_MAX;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim() || n < 1 || n > MAX_LIMIT) {
    throw new Error(
      `IMAGE_GEN_MAX_CONCURRENCY 必须是 1..${MAX_LIMIT} 的整数，收到 "${raw}"`,
    );
  }
  return n;
}

function readSemaDir(): string {
  return process.env.IMAGE_GEN_SEMA_DIR ?? "/tmp/image-gen-sema";
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = no such process; EPERM = exists but we lack perms (still alive)
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

async function isLockStale(lockDir: string): Promise<boolean> {
  // 1) age fallback first（即使 pid 文件读不到也能兜底）
  try {
    const st = statSync(lockDir);
    if (Date.now() - st.mtimeMs > STALE_AGE_MS) return true;
  } catch {
    // lockDir 已不存在 → 视为 stale（让循环重试该 slot 时拿到）
    return true;
  }
  // 2) pid 死亡判定
  try {
    const pidStr = await readFile(join(lockDir, "pid"), "utf8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!isPidAlive(pid)) return true;
  } catch {
    // 写入 pid 之前的 race window（mkdir 已成 + pid 还没写）→ 保守判活
    return false;
  }
  return false;
}

async function tryReclaim(lockDir: string): Promise<void> {
  // 删 lock 内的所有文件再 rmdir。force:true 容忍并发同样回收。
  await rm(lockDir, { recursive: true, force: true });
}

async function tryAcquireSlot(slotPath: string): Promise<boolean> {
  try {
    await mkdir(slotPath); // 不传 recursive，已存在则抛 EEXIST
    // 持有成功，写 metadata
    await writeFile(join(slotPath, "pid"), String(process.pid));
    await writeFile(join(slotPath, "started"), String(Date.now()));
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    throw e;
  }
}

function jitterSleep(): Promise<void> {
  const jitter = Math.floor((Math.random() * 2 - 1) * POLL_JITTER_MS);
  return new Promise((r) => setTimeout(r, POLL_BASE_MS + jitter));
}

export type ReleaseFn = () => Promise<void>;

export async function acquireSlot(): Promise<ReleaseFn> {
  const max = readMaxConcurrency();
  const dir = readSemaDir();
  await mkdir(dir, { recursive: true });

  while (true) {
    for (let i = 1; i <= max; i++) {
      const slotPath = join(dir, `slot-${i}.lock`);

      // 已存在？先看 stale。
      if (existsSync(slotPath)) {
        if (await isLockStale(slotPath)) {
          await tryReclaim(slotPath);
          // 落空后立即再试该 slot（下一轮 for 循环的 mkdir）
        } else {
          continue;
        }
      }

      const got = await tryAcquireSlot(slotPath);
      if (got) {
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await rm(slotPath, { recursive: true, force: true });
        };
      }
      // EEXIST 竞争失败 → 看下个 slot
    }
    await jitterSleep();
  }
}
