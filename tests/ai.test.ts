import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, edit } from "../lib/ai";

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

test("让 AI 改正文：只接受完整 JSON，无改动会重试再报错", async (t) => {
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
  const reply = (payload: unknown, finish_reason = "stop") =>
    Response.json({
      choices: [
        { message: { content: JSON.stringify(payload) }, finish_reason },
      ],
    });
  try {
    await t.test("按指令改写，返回新正文和一句说明", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return reply({
          summary: "把支出按金额从大到小排序",
          markdown: changed,
        });
      };
      const result = await edit(source, [], "支出项目按金额从大到小排");
      assert.equal(result.markdown, changed);
      assert.equal(result.summary, "把支出按金额从大到小排序");
      assert.equal(calls, 1);
    });
    await t.test("两次都没改动正文就报错，不覆盖原稿", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return reply({ summary: "看起来不用改", markdown: source });
      };
      await assert.rejects(edit(source, [], "帮我看一眼"), /没有改动正文/);
      assert.equal(calls, 2);
    });
    await t.test("截断的输出不能覆盖正文", async () => {
      globalThis.fetch = async () =>
        reply({ summary: "改好了", markdown: changed }, "length");
      await assert.rejects(edit(source, [], "排序"), /未返回完整内容/);
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
      await assert.rejects(edit(source, [], "排序"), /格式无效/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
