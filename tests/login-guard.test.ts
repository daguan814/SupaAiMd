import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = await fs.mkdtemp(path.join(os.tmpdir(), "moxu-guard-"));
process.env.NOTES_DIR = folder;
const g = await import("../lib/login-guard");

test("连续 5 次密码错误后锁定，其他来源不受影响", async () => {
  assert.equal(await g.lockedMessage("1.1.1.1"), "");

  for (let i = 1; i < g.maxFailures; i += 1) {
    const result = await g.registerFailure("1.1.1.1");
    assert.equal(result.locked, false);
    assert.equal(result.remaining, g.maxFailures - i);
  }

  const last = await g.registerFailure("1.1.1.1");
  assert.equal(last.locked, true);
  assert.equal(last.remaining, 0);

  assert.match(await g.lockedMessage("1.1.1.1"), /小时/);
  assert.equal(await g.lockedMessage("2.2.2.2"), "");

  const stored = JSON.parse(
    await fs.readFile(path.join(folder, ".app", "login-guard.json"), "utf8"),
  );
  assert.equal(stored["1.1.1.1"].failures, g.maxFailures);
  assert.ok(stored["1.1.1.1"].lockedUntil > Date.now());

  await g.registerSuccess("2.2.2.2");
  assert.equal(await g.lockedMessage("1.1.1.1") !== "", true);
});

test("来源地址取反代写入的可信字段", () => {
  assert.equal(
    g.clientKey(
      new Request("http://local/api/login", {
        headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4", "x-real-ip": "1.2.3.4" },
      }),
    ),
    "1.2.3.4",
  );
  assert.equal(
    g.clientKey(
      new Request("http://local/api/login", {
        headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4" },
      }),
    ),
    "1.2.3.4",
  );
  assert.equal(g.clientKey(new Request("http://local/api/login")), "unknown");
});
