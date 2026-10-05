import { test } from "node:test";
import assert from "node:assert/strict";
import { complete } from "../lib/ai";

test("润色重试无变化结果，并拒绝空白差异和不完整输出", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const source = "我想记录想法。\n\n整理后更容易回顾。";
  const edited = "# 记录想法\n\n## 目的\n\n整理想法，让回顾更容易。";
  const respond = (content: string, finish_reason = "stop") =>
    Response.json({ choices: [{ message: { content }, finish_reason }] });
  try {
    await t.test("第一次无变化，重试返回整理后的正文", async () => {
      let calls = 0;
      globalThis.fetch = async () => respond(++calls === 1 ? source : edited);
      assert.equal(await complete(source, "polish"), edited);
      assert.equal(calls, 2);
    });
    await t.test("只改空白不算有效修改，两次无变化后明确失败", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return respond(source.replace(/\n\n/g, "\n\n\n"));
      };
      await assert.rejects(complete(source, "polish"), /未做出有效修改/);
      assert.equal(calls, 2);
    });
    await t.test("截断内容不能用于覆盖正文", async () => {
      globalThis.fetch = async () => respond(edited, "length");
      await assert.rejects(complete(source, "polish"), /未返回完整内容/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
