import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSendOnEnter } from "../lib/chat";

test("回车发送；Shift + 回车换行；输入法组词时不误发", () => {
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: false }), true);
  assert.equal(
    shouldSendOnEnter({ key: "Enter", shiftKey: true }),
    false,
    "Shift + 回车应该换行",
  );
  assert.equal(
    shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: true }),
    false,
    "中文输入法正在组词时不能发送",
  );
  assert.equal(
    shouldSendOnEnter({ key: "Enter", shiftKey: false, keyCode: 229 }),
    false,
    "老式输入法用 keyCode 229 标记组词",
  );
  assert.equal(shouldSendOnEnter({ key: "a", shiftKey: false }), false);
  assert.equal(
    shouldSendOnEnter({ key: "Enter", shiftKey: true, isComposing: false }),
    false,
  );
});
