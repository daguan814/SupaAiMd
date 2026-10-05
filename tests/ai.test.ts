import { test } from "node:test";
import assert from "node:assert/strict";
import { assist, complete } from "../lib/ai";

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

test("和 AI 对话：该改就改，只是提问就不动正文", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const source = [
    "# 支出项目",
    "",
    "| 项目 | 金额 |",
    "| --- | --- |",
    "| 甲 | 200 |",
    "| 乙 | 1000 |",
  ].join("\n");
  const changed = source.replace(
    "| 甲 | 200 |\n| 乙 | 1000 |",
    "| 乙 | 1000 |\n| 甲 | 200 |",
  );
  const answer = (payload: unknown, finish_reason = "stop") =>
    Response.json({
      choices: [
        { message: { content: JSON.stringify(payload) }, finish_reason },
      ],
    });
  try {
    await t.test("要求修改时返回改好的正文", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return answer({
          changed: true,
          reply: "已把支出按金额从大到小排序",
          markdown: changed,
        });
      };
      const result = await assist(source, [], "支出项目按金额从大到小排");
      assert.equal(result.changed, true);
      assert.equal(result.markdown, changed);
      assert.equal(result.reply, "已把支出按金额从大到小排序");
      assert.equal(calls, 1);
    });
    await t.test("只是提问就只回答，不动正文", async () => {
      globalThis.fetch = async () =>
        answer({
          changed: false,
          reply: "这篇记的是支出和收入。",
          markdown: "",
        });
      const result = await assist(source, [], "这篇在讲什么？");
      assert.equal(result.changed, false);
      assert.equal(result.markdown, null);
      assert.equal(result.reply, "这篇记的是支出和收入。");
    });
    await t.test("说改了但正文没变，重试后仍然如此就报错", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return answer({ changed: true, reply: "改好了", markdown: source });
      };
      await assert.rejects(assist(source, [], "整理一下"), /没有真的改动正文/);
      assert.equal(calls, 2);
    });
    await t.test("截断的输出不能覆盖正文", async () => {
      globalThis.fetch = async () =>
        answer({ changed: true, reply: "改好了", markdown: changed }, "length");
      await assert.rejects(assist(source, [], "排序"), /未返回完整内容/);
    });
    await t.test("返回的不是合法 JSON 就报错", async () => {
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            {
              message: { content: "这是改好的正文" },
              finish_reason: "stop",
            },
          ],
        });
      await assert.rejects(assist(source, [], "排序"), /格式无效/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
