/**
 * 真机自检：用无头浏览器打开本地应用，确认页面能渲染、交互能点开、没有运行时异常。
 *
 *   npm run dev                              # 另开一个终端
 *   npm run smoke                            # 默认检查 http://127.0.0.1:3000
 *   SMOKE_NOTE="重要密码.md" npm run smoke     # 顺带打开一篇笔记检查内容
 *
 * 首次使用先装一次浏览器（WebKit 就是 Safari 的引擎）：
 *   npx playwright-core install webkit
 *
 * 环境变量：SMOKE_URL、SMOKE_NOTE、SMOKE_BROWSER（webkit / chromium / firefox）、
 * SMOKE_HEADFUL=1 可以看到窗口。所有检查都只看不改，不会动任何笔记。
 */
import { chromium, firefox, webkit } from "playwright-core";

const APP = process.env.SMOKE_URL || "http://127.0.0.1:3000/";
const NOTE = process.env.SMOKE_NOTE || "";
const NAME = process.env.SMOKE_BROWSER || "webkit";
const engines = { webkit, chromium, firefox };
const engine = engines[NAME];
const failures = [];

if (!engine) {
  console.error(
    `✖ 不认识的 SMOKE_BROWSER：${NAME}（可选 webkit / chromium / firefox）`,
  );
  process.exit(1);
}

const browser = await engine
  .launch({ headless: !process.env.SMOKE_HEADFUL })
  .catch((error) => {
    console.error(
      `✖ 启动 ${NAME} 失败：${String(error.message).split("\n")[0]}`,
    );
    console.error(
      `  没装这个浏览器的话，先跑一次：npx playwright-core install ${NAME}`,
    );
    process.exit(1);
  });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const exceptions = [];
page.on("pageerror", (error) => exceptions.push(String(error).slice(0, 300)));

/** 点一项并确认它出现了；打不开就记一条失败。 */
const open = async (click, selector, label) => {
  await click();
  const found = await page
    .waitForSelector(selector, { timeout: 8000 })
    .catch(() => null);
  if (!found) failures.push(label);
  return found;
};

try {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  if (
    !(await page
      .waitForSelector(".workspace", { timeout: 25000 })
      .catch(() => null))
  )
    failures.push("页面没有渲染出工作区");
  // 等笔记库读进来（加载中会显示「正在打开笔记库…」）
  await page
    .waitForFunction(
      () => !(document.body.innerText || "").includes("正在打开笔记库"),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});

  if (NOTE) {
    await page.evaluate(
      (note) => localStorage.setItem("moxu-last-note", note),
      NOTE,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    if (
      !(await page
        .waitForSelector(".cm-editor", { timeout: 25000 })
        .catch(() => null))
    )
      failures.push("笔记没有打开（编辑器没出现）");
    const state = await page.evaluate(() => ({
      title: document.querySelector(".document-heading h1")?.textContent || "",
      tables: document.querySelectorAll(".cm-table").length,
      rows: document.querySelectorAll(".cm-table tbody tr").length,
    }));
    console.log("笔记自检:", JSON.stringify(state));
    if (!state.title) failures.push("没有读到笔记标题");
  } else {
    console.log("只检查了首页（设置 SMOKE_NOTE 可以顺带打开一篇笔记）");
  }

  // 笔记库：并排的标签能列出来，当前那本是选中态（只看不动）
  const current = await page
    .$eval(".library-tab.active", (node) => node.textContent)
    .catch(() => "");
  if (!current) failures.push("侧栏没有显示当前笔记库");
  else {
    const names = await page.$$eval(".library-tab", (nodes) =>
      nodes.map((node) => node.textContent).filter(Boolean),
    );
    console.log("笔记库自检:", JSON.stringify({ current, names }));
    if (!names.includes(current)) failures.push("并排标签里没有当前笔记库");
  }

  // 回收站：面板能列出来（只看不动）
  if (await page.$(".trash-button")) {
    const panel = await open(
      () => page.click(".trash-button"),
      ".trash-modal",
      "侧栏回收站按钮打不开面板",
    );
    if (panel) {
      const trash = await page.evaluate(() => ({
        title: document.querySelector(".trash-modal h2")?.textContent || "",
        items: document.querySelectorAll(".trash-item").length,
      }));
      console.log("回收站自检:", JSON.stringify(trash));
      if (trash.title !== "回收站") failures.push("回收站面板标题不对");
      await page.click(".trash-modal .modal-actions button");
    }
  }

  // 设置：点左下角「我的空间」能打开，里面列出笔记库（只看不动，不新建）
  if (await page.$(".sidebar-bottom")) {
    const dialog = await open(
      () => page.click(".sidebar-bottom"),
      ".settings-modal",
      "点「我的空间」没有打开设置",
    );
    if (dialog) {
      const libraries = await page.$$eval(
        ".library-row .library-name > span",
        (nodes) => nodes.map((node) => node.textContent),
      );
      console.log("设置自检:", JSON.stringify({ libraries }));
      if (!libraries.length) failures.push("设置里没有列出笔记库");
      await page.click(".settings-modal .modal-actions button");
    }
  } else failures.push("左下角没有「我的空间」入口");

  const overlay = await page.evaluate(() =>
    (document.body.innerText || "").includes("Runtime "),
  );
  if (overlay) failures.push("页面出现了运行时错误浮层");
  if (exceptions.length) failures.push(`未捕获异常：${exceptions[0]}`);
} catch (error) {
  failures.push(error.message);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("✖ 自检没通过：");
  for (const failure of failures) console.error("  -", failure);
  process.exit(1);
}
console.log("✔ 自检通过");
