import { test } from "node:test";
import assert from "node:assert/strict";
import { assist } from "../lib/ai";

test("和 AI 聊天：只回话，不动正文", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const source = "# 支出项目\n\n本月支出 1200 元，比上个月少。";
  const answer = (content: string, finish_reason = "stop") =>
    Response.json({ choices: [{ message: { content }, finish_reason }] });
  try {
    await t.test("回答原样返回给作者", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return answer("这篇记的是本月的支出总额，并和上月做了比较。");
      };
      assert.equal(
        await assist(source, [], "这篇在讲什么？"),
        "这篇记的是本月的支出总额，并和上月做了比较。",
      );
      assert.equal(calls, 1);
    });
    await t.test("请求里带上正文和最近的对话，并且不许 AI 改正文", async () => {
      let body: { messages: { role: string; content: string }[] } = {
        messages: [],
      };
      globalThis.fetch = async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return answer("好。");
      };
      await assist(
        source,
        [
          { role: "user", content: "在吗" },
          { role: "assistant", content: "在的" },
        ],
        "哪段还能更清楚？",
      );
      assert.match(body.messages[0].content, /不要改写/);
      const texts = body.messages.map((message) => message.content);
      assert.ok(texts.includes(source));
      assert.ok(texts.includes("在吗"));
      assert.equal(body.messages.at(-1)?.content, "哪段还能更清楚？");
    });
    await t.test("截断或空回复都算失败", async () => {
      globalThis.fetch = async () => answer("说到一半", "length");
      await assert.rejects(assist(source, [], "怎么样"), /未返回完整内容/);
      globalThis.fetch = async () => answer("   ");
      await assert.rejects(assist(source, [], "怎么样"), /未返回完整内容/);
    });
    await t.test("没配密钥就直接报错", async () => {
      delete process.env.DEEPSEEK_API_KEY;
      await assert.rejects(assist(source, [], "在吗"), /配置 DeepSeek/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
