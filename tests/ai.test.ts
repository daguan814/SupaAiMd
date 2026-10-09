import { test } from "node:test";
import assert from "node:assert/strict";
import { assist } from "../lib/ai";

test("和 AI 聊天：该改就改，只是提问就不动正文", async (t) => {
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
    await t.test("正文放在系统提示里，对话只留双方轮次", async () => {
      let body: { messages: { role: string; content: string }[] } = {
        messages: [],
      };
      globalThis.fetch = async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return answer({ changed: false, reply: "好。", markdown: "" });
      };
      await assist(
        source,
        [
          { role: "user", content: "在吗" },
          { role: "assistant", content: "在的" },
        ],
        "哪段还能更清楚？",
      );
      const system = body.messages[0];
      assert.equal(system.role, "system");
      assert.match(system.content, /直接给出改好的完整 Markdown/);
      assert.ok(system.content.includes(source), "正文应该在系统提示里");
      assert.deepEqual(
        body.messages
          .slice(1, -1)
          .map((message) => [message.role, message.content]),
        [
          ["user", "在吗"],
          ["assistant", "在的"],
        ],
      );
      assert.equal(body.messages.length, 4);
      assert.equal(body.messages.at(-1)?.content, "哪段还能更清楚？");
    });
    await t.test("空回复会重试，之后正常回答", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return calls === 1
          ? answer("      ")
          : answer({ changed: false, reply: "这篇记的是支出。", markdown: "" });
      };
      const result = await assist(source, [], "这篇在讲什么？");
      assert.equal(result.changed, false);
      assert.equal(result.reply, "这篇记的是支出。");
      assert.equal(calls, 2);
    });
    await t.test("只是说改了却没动正文，三次之后明确报错", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return answer({ changed: true, reply: "改好了", markdown: source });
      };
      await assert.rejects(assist(source, [], "帮我改"), /没有真的改动正文/);
      assert.equal(calls, 3);
    });
    await t.test("被截断的输出不能覆盖正文", async () => {
      globalThis.fetch = async () =>
        answer({ changed: true, reply: "改好了", markdown: changed }, "length");
      await assert.rejects(assist(source, [], "排序"), /没有返回完整内容/);
    });
    await t.test("说了改但 markdown 是空的，会报错而不是写空正文", async () => {
      globalThis.fetch = async () =>
        answer({ changed: true, reply: "改好了", markdown: "" });
      await assert.rejects(assist(source, [], "帮我改"), /没有给出改好的正文/);
    });
    await t.test(
      "给出了改好的正文却把 changed 写成 false，照样采用",
      async () => {
        globalThis.fetch = async () =>
          answer({ changed: false, reply: "顺手排了序", markdown: changed });
        const result = await assist(source, [], "排一下");
        assert.equal(result.changed, true);
        assert.equal(result.markdown, changed);
      },
    );
    await t.test("返回的不是合法 JSON，重试后仍然如此就报错", async () => {
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            { message: { content: "这是改好的正文" }, finish_reason: "stop" },
          ],
        });
      await assert.rejects(assist(source, [], "排序"), /格式无效/);
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
