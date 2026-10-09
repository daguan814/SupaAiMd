import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "moxu-libs-"));
process.env.NOTES_DIR = folder;
const s = await import("../lib/storage");

test("升级老结构：笔记、图、对话、回收站整体收进默认笔记库", async () => {
  // 按老版本的样子先铺一层：笔记直接躺在笔记目录下，.app 里是状态和回收站
  await fs.mkdir(path.join(folder, ".app", "trash"), { recursive: true });
  await fs.writeFile(path.join(folder, "旧笔记.md"), "# 旧\n", "utf8");
  await fs.mkdir(path.join(folder, "旧文件夹"));
  await fs.writeFile(
    path.join(folder, "旧文件夹", "里面.md"),
    "# 里面\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(folder, ".app", s.hash("旧笔记.md") + ".json"),
    JSON.stringify({
      chat: [
        {
          id: "1",
          role: "user",
          content: "以前的对话",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const legacyTrash =
    "1700000000000-11111111-1111-1111-1111-111111111111-删掉的.md";
  await fs.writeFile(
    path.join(folder, ".app", "trash", legacyTrash),
    "# 删掉的\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(folder, ".app", "login-guard.json"),
    JSON.stringify({ "1.2.3.4": { failures: 2, lockedUntil: 0 } }),
    "utf8",
  );

  await s.init();
  const state = await s.libraryList();
  assert.deepEqual(state.names, [s.defaultLibrary]);
  assert.equal(state.active, s.defaultLibrary);
  // 笔记搬进库，内容和位置照旧
  assert.deepEqual(
    (await s.tree()).map((entry) => entry.path).sort(),
    ["旧笔记.md", "旧文件夹"].sort(),
  );
  assert.equal((await s.read("旧笔记.md")).content, "# 旧\n");
  assert.equal((await s.read("旧文件夹/里面.md")).content, "# 里面\n");
  // 老对话记录跟着笔记走
  assert.equal((await s.read("旧笔记.md")).chat[0].content, "以前的对话");
  // 老回收站也跟着走
  assert.deepEqual(
    (await s.trashList()).map((item) => item.name),
    ["删掉的.md"],
  );
  // 登录失败记录留在应用级，不跟着进库
  assert.ok(await fs.stat(path.join(folder, ".app", "login-guard.json")));
  await assert.rejects(() =>
    fs.stat(path.join(folder, s.defaultLibrary, ".app", "login-guard.json")),
  );
  // 笔记目录下只剩库文件夹和 .app
  assert.deepEqual(
    (await fs.readdir(folder)).sort(),
    [".app", s.defaultLibrary].sort(),
  );
});

test("多笔记库：新建、切换、改名，各自互不影响", async () => {
  await s.createLibrary("工作");
  assert.deepEqual((await s.libraryList()).names, [s.defaultLibrary, "工作"]);
  assert.equal((await s.libraryList()).active, "工作");
  assert.deepEqual(await s.tree(), []);

  await s.create("周报.md", "file");
  let note = await s.read("周报.md");
  await s.save("周报.md", "# 工作周报\n", note.hash);

  // 另一个库里可以有同名笔记，正文和状态各归各的
  await s.useLibrary(s.defaultLibrary);
  assert.equal((await s.read("旧笔记.md")).content, "# 旧\n");
  await s.create("周报.md", "file");
  note = await s.read("周报.md");
  await s.save("周报.md", "# 我的周报\n", note.hash);
  assert.equal((await s.read("周报.md")).content, "# 我的周报\n");

  await s.useLibrary("工作");
  assert.equal((await s.read("周报.md")).content, "# 工作周报\n");

  // 回收站也是各库各的
  await s.trash("周报.md");
  assert.deepEqual(
    (await s.trashList()).map((item) => item.name),
    ["周报.md"],
  );
  await s.useLibrary(s.defaultLibrary);
  assert.equal(
    (await s.trashList()).some((item) => item.name === "周报.md"),
    false,
  );

  await s.renameLibrary("工作", "工作区");
  assert.deepEqual((await s.libraryList()).names, [s.defaultLibrary, "工作区"]);
  assert.equal(
    (await s.libraryList()).active,
    s.defaultLibrary,
    "改名不影响当前所在的库",
  );
  await s.useLibrary("工作区");
  // 删掉的笔记跟着库改名一起走，还能放回这个库
  assert.deepEqual(
    (await s.trashList()).map((item) => item.name),
    ["周报.md"],
  );
  await s.restore((await s.trashList())[0].id);
  assert.equal((await s.read("周报.md")).content, "# 工作周报\n");

  await assert.rejects(() => s.createLibrary("工作区"), /同名/);
  await assert.rejects(() => s.createLibrary("a/b"), /斜杠/);
  await assert.rejects(() => s.createLibrary("  "), /请填写/);
  await assert.rejects(() => s.useLibrary("不存在"), /没有这个笔记库/);
  await s.createLibrary("另一个");
  await assert.rejects(() => s.renameLibrary("另一个", "工作区"), /同名/);
  await assert.rejects(
    () => s.renameLibrary("没有的库", "随便"),
    /没有这个笔记库/,
  );
  await s.useLibrary(s.defaultLibrary);
});

test("把笔记和文件夹搬到另一本笔记库：图和标签跟着走，重名会拦下来", async () => {
  await s.createLibrary("随记");
  await s.create("随手记.md", "file");
  let note = await s.read("随手记.md");
  note = await s.save("随手记.md", "# 随手记\n", note.hash);
  note = await s.putGraph(
    "随手记.md",
    {
      nodes: [{ id: "a", title: "想法", content: "记一下" }],
      edges: [],
      sourceHash: note.hash,
    },
    note.hash,
  );
  note = await s.putAnnotation(
    "随手记.md",
    { quote: "# 随手记", label: "标题" },
    note.hash,
    note.annotationsHash,
  );
  await s.create("灵感", "folder");
  await s.create("灵感/点子.md", "file");

  // 搬到默认库：相对路径不变，配套元数据一起过去
  await s.moveToLibrary("灵感", s.defaultLibrary);
  assert.deepEqual(
    (await s.tree()).map((entry) => entry.path),
    ["随手记.md"],
  );
  await s.useLibrary(s.defaultLibrary);
  assert.ok((await s.tree()).some((entry) => entry.path === "灵感"));
  assert.equal((await s.read("灵感/点子.md")).content, "");

  await s.useLibrary("随记");
  await s.moveToLibrary("随手记.md", s.defaultLibrary);
  assert.deepEqual(await s.tree(), []);
  await s.useLibrary(s.defaultLibrary);
  const moved = await s.read("随手记.md");
  assert.equal(moved.content, "# 随手记\n");
  assert.equal(moved.graph?.nodes[0].title, "想法");
  assert.equal(moved.annotations[0].label, "标题");

  // 目标库里已经有同名笔记时明确报错，不动任何一边
  await s.useLibrary("随记");
  await s.create("随手记.md", "file");
  await assert.rejects(
    () => s.moveToLibrary("随手记.md", s.defaultLibrary),
    /已经有同名/,
  );
  assert.ok((await s.tree()).some((entry) => entry.path === "随手记.md"));
  await s.useLibrary(s.defaultLibrary);
  assert.equal((await s.read("随手记.md")).content, "# 随手记\n");
});
