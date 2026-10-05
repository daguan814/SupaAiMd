/**
 * 真机自检：用无头 Chrome 打开本地应用，确认页面能渲染、没有运行时异常。
 *
 *   npm run dev            # 另开一个终端
 *   npm run smoke          # 默认检查 http://127.0.0.1:3000
 *   SMOKE_NOTE="重要密码.md" npm run smoke    # 顺便检查这篇笔记能打开
 *
 * 环境变量：SMOKE_URL、SMOKE_NOTE、CHROME_PATH。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = process.env.SMOKE_URL || "http://127.0.0.1:3000/";
const NOTE = process.env.SMOKE_NOTE || "";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.SMOKE_PORT || 9333);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "moxu-smoke-"));
const failures = [];

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,1000",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let socket;
let nextId = 0;
const pending = new Map();
const exceptions = [];

const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function launch() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("无头 Chrome 没起来，请检查 CHROME_PATH");
}

try {
  const version = await launch();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(
        message.params?.exceptionDetails?.exception?.description?.slice(0, 300),
      );
  });
  await new Promise((resolve) => socket.addEventListener("open", resolve));

  const { result: target } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { result: attached } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const evaluate = async (expression) => {
    const response = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    return response.result?.exceptionDetails
      ? undefined
      : response.result?.result?.value;
  };
  const waitFor = async (expression, timeout = 25000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(400);
    }
    return false;
  };

  await send("Page.navigate", { url: APP }, sessionId);
  if (!(await waitFor(`!!document.querySelector(".workspace")`)))
    failures.push("页面没有渲染出工作区");

  if (NOTE) {
    await evaluate(
      `localStorage.setItem("moxu-last-note", ${JSON.stringify(NOTE)})`,
    );
    await send("Page.navigate", { url: APP }, sessionId);
    if (!(await waitFor(`!!document.querySelector(".cm-editor")`)))
      failures.push("笔记没有打开（编辑器没出现）");
    const state = await evaluate(`({
      title: (document.querySelector(".document-heading h1") || {}).textContent || "",
      tables: document.querySelectorAll(".cm-table").length,
      rows: document.querySelectorAll(".cm-table tbody tr").length,
    })`);
    console.log("笔记自检:", JSON.stringify(state));
    if (!state?.title) failures.push("没有读到笔记标题");
  } else {
    console.log("只检查了首页（设置 SMOKE_NOTE 可以顺带打开一篇笔记）");
  }

  const overlay = await evaluate(
    `(document.body.innerText || "").includes("Runtime ")`,
  );
  if (overlay) failures.push("页面出现了运行时错误浮层");
  if (exceptions.length) failures.push(`未捕获异常：${exceptions[0]}`);
} catch (error) {
  failures.push(error.message);
} finally {
  socket?.close();
  chrome.kill("SIGKILL");
  fs.rmSync(profile, { recursive: true, force: true });
}

if (failures.length) {
  console.error("✖ 自检没通过：");
  for (const failure of failures) console.error("  -", failure);
  process.exit(1);
}
console.log("✔ 自检通过");
