import { promises as fs } from "node:fs";
import path from "node:path";
import { root } from "./storage";

// 连续输错 5 次密码后，按来源地址锁定 5 小时。
export const maxFailures = 5;
export const lockMs = 5 * 60 * 60 * 1000;

type Attempt = { failures: number; lockedUntil: number };
type Attempts = Record<string, Attempt>;

const file = path.join(root, ".app", "login-guard.json");

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}

async function read(): Promise<Attempts> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    // 每次都从磁盘读，删掉记录文件就能立刻解锁，不必重启服务。
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Attempts)
      : {};
  } catch {
    return {};
  }
}

async function write(state: Attempts) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(state), "utf8");
  } catch {
    // 存储不可写时只保留进程内的限制，不影响登录本身
  }
}

function duration(ms: number) {
  const total = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`;
  return hours ? `${hours} 小时` : `${minutes} 分钟`;
}

// 反代会重写 x-real-ip，并把它自己的来源地址追加到 x-forwarded-for 末尾，
// 所以这里优先取这两个可信值，而不是客户端可以伪造的转发链首段。
export function clientKey(request: Request) {
  const real = request.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    return hops[hops.length - 1].trim();
  }
  return "unknown";
}

/** 已锁定时返回剩余时间文案，未锁定返回空串。 */
export function lockedMessage(key: string): Promise<string> {
  return serialize(async () => {
    const state = await read();
    const entry = state[key];
    if (!entry?.lockedUntil) return "";
    if (entry.lockedUntil <= Date.now()) {
      delete state[key];
      await write(state);
      return "";
    }
    return duration(entry.lockedUntil - Date.now());
  });
}

/** 记录一次密码错误，返回是否触发了锁定以及剩余可尝试次数。 */
export function registerFailure(
  key: string,
): Promise<{ locked: boolean; remaining: number }> {
  return serialize(async () => {
    const state = await read();
    const now = Date.now();
    const entry = state[key] ?? { failures: 0, lockedUntil: 0 };
    if (entry.lockedUntil && entry.lockedUntil <= now) {
      entry.failures = 0;
      entry.lockedUntil = 0;
    }
    entry.failures += 1;
    const locked = entry.failures >= maxFailures;
    if (locked) entry.lockedUntil = now + lockMs;
    state[key] = entry;
    await write(state);
    return { locked, remaining: Math.max(0, maxFailures - entry.failures) };
  });
}

/** 登录成功后清空该来源的错误记录。 */
export function registerSuccess(key: string) {
  return serialize(async () => {
    const state = await read();
    if (state[key]) {
      delete state[key];
      await write(state);
    }
  });
}
