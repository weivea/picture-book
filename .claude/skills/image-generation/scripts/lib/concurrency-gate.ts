// .claude/skills/image-generation/scripts/lib/concurrency-gate.ts
//
// 跨进程速率门 + 并发上限。两层约束：
//   1) 并发：MAX 个 slot 目录，靠 mkdir 原子性争抢（in-flight 数 ≤ MAX）。
//   2) 速率：拿到 slot 后再读 last-start.txt，距上次 < MIN_INTERVAL_MS 则 sleep。
//      用于规避 Azure gpt-image-2 的 RPM 限制（默认 2 RPM ⇒ 35s 间隔）。
//
// 用法：
//   const release = await acquireSlot();
//   try { /* do work */ } finally { await release(); }
//
// 配置（env，每次 acquireSlot 时读取）：
//   IMAGE_GEN_MAX_CONCURRENCY  整数 1..16，默认 1（2 RPM 下并发 >1 没有收益）
//   IMAGE_GEN_MIN_INTERVAL_MS  整数 0..600000，默认 35000（30s 上限 + 5s buffer）
//                              0 = 禁用速率门（仅保留并发门）
//   IMAGE_GEN_SEMA_DIR         信号量根目录，默认 /tmp/image-gen-sema
//
// 异常容错：
//   - 进程崩溃留下的 lock 在下一次 acquire 时被回收，判据：
//     a) lock/pid 中的 pid 已不可被 kill -0（ESRCH）
//     b) lock/started 距今 > STALE_AGE_MS（兜底，避免 pid 复用误判）
//   - last-start.txt 损坏 / 缺失 → 视为 0（首次免等）
//
// 不依赖任何外部包，仅用 node:fs/promises + process.kill(pid, 0)。

import { mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX = 1;
const MAX_LIMIT = 16;
const DEFAULT_MIN_INTERVAL_MS = 35_000;
const MAX_INTERVAL_MS = 600_000;
const STALE_AGE_MS = 10 * 60 * 1000; // 10 min
const POLL_BASE_MS = 200;
const POLL_JITTER_MS = 50;
const LAST_START_FILE = "last-start.txt";

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

function readMinIntervalMs(): number {
  const raw = process.env.IMAGE_GEN_MIN_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_MIN_INTERVAL_MS;
  const n = parseInt(raw, 10);
  if (
    !Number.isFinite(n) ||
    String(n) !== raw.trim() ||
    n < 0 ||
    n > MAX_INTERVAL_MS
  ) {
    throw new Error(
      `IMAGE_GEN_MIN_INTERVAL_MS 必须是 0..${MAX_INTERVAL_MS} 的整数（毫秒），收到 "${raw}"`,
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

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 读上次成功 acquire 的时间戳。损坏 / 缺失 → 0（首次免等）。
 */
async function readLastStartMs(dir: string): Promise<number> {
  try {
    const txt = await readFile(join(dir, LAST_START_FILE), "utf8");
    const n = parseInt(txt.trim(), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  } catch {
    return 0;
  }
}

/**
 * 原子写 last-start.txt：写到 .tmp 再 rename。多进程并发写互不损坏，
 * 最终值是最后一个 rename 胜出，不影响正确性（轻微保守 = 多等一拍）。
 */
async function writeLastStartMs(dir: string, ts: number): Promise<void> {
  const target = join(dir, LAST_START_FILE);
  // tmp 文件名带 pid + 随机数，避免不同进程互相覆盖中间态
  const tmp = `${target}.tmp.${process.pid}.${Math.floor(Math.random() * 1e6)}`;
  await writeFile(tmp, String(ts));
  await rename(tmp, target);
}

/**
 * 拿到 slot 后强制等待至少 MIN_INTERVAL_MS 自上次 start。
 * 写入 last-start 之后再返回，保证下一个 acquirer（无论同进程异进程）
 * 看到的是"最近一次真正发出请求的时刻"。
 *
 * 跨进程 race 防御：用 rate.lock 目录原子化 "读 last + 计算 + 写 last" 阶段，
 * 避免两个进程同时读到旧 last-start 都通过的 bug。
 */
async function enforceRateGate(dir: string, minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const rateLock = join(dir, "rate.lock");

  // 1) 抢 rate.lock（短暂持有，仅覆盖 enforce 阶段）
  while (true) {
    try {
      await mkdir(rateLock);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      // 同时检查是否 stale：rate-lock 不应持有超过 MIN_INTERVAL + 缓冲
      try {
        const st = statSync(rateLock);
        if (Date.now() - st.mtimeMs > minIntervalMs + 60_000) {
          await rm(rateLock, { recursive: true, force: true });
          continue;
        }
      } catch {
        // rate-lock 已被别人释放 → 重试
        continue;
      }
      await sleep(50 + Math.floor(Math.random() * 50));
    }
  }

  try {
    while (true) {
      const last = await readLastStartMs(dir);
      const elapsed = Date.now() - last;
      if (elapsed >= minIntervalMs) {
        await writeLastStartMs(dir, Date.now());
        return;
      }
      await sleep(minIntervalMs - elapsed);
    }
  } finally {
    await rm(rateLock, { recursive: true, force: true });
  }
}

export type ReleaseFn = () => Promise<void>;

export async function acquireSlot(): Promise<ReleaseFn> {
  const max = readMaxConcurrency();
  const minInterval = readMinIntervalMs();
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
        // 拿到 slot 之后强制速率门：保证两次 enforce 间隔 ≥ MIN_INTERVAL_MS。
        // 在 release 之前 hold 住 slot，避免别人插队拉高 RPM。
        await enforceRateGate(dir, minInterval);
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
