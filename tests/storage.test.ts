import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const folder = await fs.mkdtemp(path.join(os.tmpdir(), "moxu-test-"));
process.env.NOTES_DIR = folder;
const s = await import("../lib/storage");
const { validateGraph } = await import("../lib/ai");
test("笔记持久化、冲突保护、改前版本恢复、移动和回收", async () => {
  try {
    await s.create("学习", "folder");
    await s.create("学习/记录.md", "file");
    const original = await s.read("学习/记录.md");
    const written = await s.save(original.path, "# 我的想法", original.hash);
    assert.equal(
      await fs.readFile(path.join(folder, written.path), "utf8"),
      "# 我的想法",
    );
    await assert.rejects(
      () => s.save(written.path, "覆盖", original.hash),
      /其他窗口/,
    );
    const polished = await s.save(
      written.path,
      "# 组织后的想法",
      written.hash,
      true,
    );
    assert.equal(polished.canUndo, true);
    const restored = await s.undo(written.path, polished.hash);
    assert.equal(restored.content, written.content);
    const graph = {
      nodes: [{ id: "a", title: "想法", content: "记录" }],
      edges: [],
      sourceHash: restored.hash,
    };
    await s.putGraph(restored.path, graph, restored.hash);
    await s.move("学习", "阅读");
    const moved = await s.read("阅读/记录.md");
    assert.deepEqual(moved.graph, graph);
    await s.trash("阅读");
    assert.deepEqual(await s.tree(), []);
    const files = await fs.readdir(path.join(folder, ".app/trash"));
    assert.equal(files.length, 1);
    const [trashed] = await s.trashList();
    assert.equal(trashed.name, "阅读");
    assert.equal(trashed.path, "阅读");
    assert.equal(trashed.type, "folder");
    assert.ok(trashed.deletedAt);
    // 放回原位时，图和标签这些配套元数据也跟着回来
    await s.restore(trashed.id);
    assert.deepEqual(
      (await s.tree()).map((e) => e.path),
      ["阅读"],
    );
    assert.deepEqual((await s.read("阅读/记录.md")).graph, graph);
    assert.deepEqual(await s.trashList(), []);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("回收站：列出、拒绝覆盖同名、恢复、彻底删除和清空", async () => {
  await s.init();
  try {
    await s.create("旧笔记.md", "file");
    let note = await s.read("旧笔记.md");
    note = await s.save(note.path, "旧的内容", note.hash);
    await s.trash("旧笔记.md");
    await s.create("旧笔记.md", "file");
    await s.create("另一篇.md", "file");
    const [trashed] = await s.trashList();
    assert.equal(trashed.name, "旧笔记.md");
    assert.equal(trashed.type, "file");
    // 原位已经有同名笔记时不能悄悄覆盖
    await assert.rejects(() => s.restore(trashed.id), /已经有同名/);
    await s.trash("另一篇.md");
    const list = await s.trashList();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "另一篇.md");
    await s.purge(list[1].id);
    assert.equal((await s.trashList()).length, 1);
    assert.deepEqual(
      (await s.tree()).map((e) => e.path),
      ["旧笔记.md"],
    );
    await s.restore(list[0].id);
    assert.deepEqual((await s.tree()).map((e) => e.path).sort(), [
      "另一篇.md",
      "旧笔记.md",
    ]);
    assert.deepEqual(await s.trashList(), []);
    await s.create("再删.md", "file");
    await s.trash("再删.md");
    assert.equal((await s.trashList()).length, 1);
    await s.emptyTrash();
    assert.deepEqual(await s.trashList(), []);
    assert.deepEqual((await s.tree()).map((e) => e.path).sort(), [
      "另一篇.md",
      "旧笔记.md",
    ]);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test("旧版回收站条目：按文件名解析，能放回笔记库", async () => {
  await s.init();
  try {
    const directory = path.join(s.root, ".app/trash");
    await fs.mkdir(directory, { recursive: true });
    const legacy =
      "1791175229883-d7bbef8e-afd9-41b0-bda2-bf131ca6eb68-决策图示例.md";
    await fs.writeFile(path.join(directory, legacy), "# 决策\n", "utf8");
    const [entry] = await s.trashList();
    assert.equal(entry.name, "决策图示例.md");
    assert.equal(entry.type, "file");
    assert.equal(entry.path, "决策图示例.md");
    assert.ok(!Number.isNaN(new Date(entry.deletedAt).getTime()));
    await s.restore(entry.id);
    assert.deepEqual(
      (await s.tree()).map((e) => e.path),
      ["决策图示例.md"],
    );
    assert.equal(
      await fs.readFile(path.join(s.root, "决策图示例.md"), "utf8"),
      "# 决策\n",
    );
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test("拒绝越界路径、隐藏文件和符号链接", async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moxu-safe-"));
  await s.init();
  try {
    for (const p of [
      "../secret.md",
      "/tmp/a.md",
      ".app/a.md",
      "a/../b.md",
      "a\\b.md",
    ])
      await assert.rejects(() => s.safe(p));
    await fs.symlink(testRoot, path.join(s.root, "external"));
    await assert.rejects(() => s.safe("external/a.md"), /符号链接/);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});
test("拒绝重复节点和无效图连接", () => {
  assert.throws(
    () =>
      validateGraph({
        nodes: [{ id: "a", title: "A", content: "" }],
        edges: [{ source: "a", target: "b" }],
      }),
    /无效/,
  );
  assert.throws(
    () =>
      validateGraph({
        nodes: [
          { id: "a", title: "A", content: "" },
          { id: "a", title: "B", content: "" },
        ],
        edges: [],
      }),
    /无效/,
  );
});

test("排序持久化：笔记和文件夹都能排，重命名后顺序保留，拒绝过期排序", async () => {
  await s.init();
  try {
    for (const name of ["甲", "乙", "丙"]) await s.create(name, "folder");
    await s.create("甲/一", "folder");
    await s.create("甲/二", "folder");
    await s.create("记录.md", "file");
    await s.create("备忘.md", "file");
    await s.reorder("甲", ["甲/二", "甲/一"]);
    assert.deepEqual(
      (await s.tree("甲")).map((e) => e.name),
      ["二", "一"],
    );
    // 同一层里笔记和文件夹可以排在一起
    await s.reorder("", ["记录.md", "丙", "甲", "乙", "备忘.md"]);
    assert.deepEqual(
      (await s.tree()).map((e) => e.path),
      ["记录.md", "丙", "甲", "乙", "备忘.md"],
    );
    await s.move("甲", "丁");
    assert.deepEqual(
      (await s.tree()).map((e) => e.path),
      ["记录.md", "丙", "丁", "乙", "备忘.md"],
    );
    assert.deepEqual(
      (await s.tree("丁")).map((e) => e.name),
      ["二", "一"],
    );
    await assert.rejects(() => s.reorder("", ["丙", "乙"]), /列表已变化/);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test("图评论、评论版本与并发图更新保护", async () => {
  await s.init();
  try {
    await s.create("笔记.md", "file");
    let n = await s.read("笔记.md");
    n = await s.save(n.path, "我选择步行，因为路程很短。", n.hash);
    const graph = {
      kind: "decision" as const,
      nodes: [{ id: "a", title: "选择", content: "步行" }],
      edges: [],
      sourceHash: n.hash,
    };
    n = await s.putGraph(n.path, graph, n.hash, n.graphHash);
    const oldGraphHash = n.graphHash;
    const revised = {
      ...graph,
      nodes: [{ id: "a", title: "选择", content: "短距离步行" }],
    };
    n = await s.putGraph(
      n.path,
      revised,
      n.hash,
      n.graphHash,
      "突出距离的约束",
    );
    assert.equal(n.feedback.length, 1);
    assert.equal(n.canUndoGraph, true);
    await assert.rejects(
      () => s.putGraph(n.path, graph, n.hash, oldGraphHash),
      /其他窗口/,
    );
    n = await s.undoGraph(n.path, n.hash, n.graphHash);
    assert.deepEqual(n.graph, graph);
    const quote = "我选择步行，因为路程很短。";
    n = await s.putAnnotation(
      n.path,
      { quote, label: "主观判断" },
      n.hash,
      n.annotationsHash,
    );
    const saved = n.annotations[0];
    await s.move("笔记.md", "新笔记.md");
    n = await s.read("新笔记.md");
    assert.deepEqual(n.annotations, [saved]);
    assert.equal(n.feedback.length, 1);
    const staleAnnotations = n.annotationsHash;
    n = await s.putAnnotation(
      n.path,
      { id: saved.id, quote, label: "待核实" },
      n.hash,
      n.annotationsHash,
    );
    assert.equal(n.annotations.length, 1);
    assert.equal(n.annotations[0].label, "待核实");
    assert.equal(n.annotations[0].createdAt, saved.createdAt);
    await assert.rejects(
      () =>
        s.putAnnotation(
          n.path,
          { quote, label: "证据不足" },
          n.hash,
          staleAnnotations,
        ),
      /其他窗口/,
    );
    await assert.rejects(
      () =>
        s.putAnnotation(
          n.path,
          { quote: "不存在的句子。", label: "待核实" },
          n.hash,
          n.annotationsHash,
        ),
      /不在当前正文/,
    );
    n = await s.save(n.path, n.content + "天气也很好。", n.hash);
    n = await s.removeAnnotation(n.path, saved.id, n.hash, n.annotationsHash);
    assert.deepEqual(n.annotations, []);
    await s.trash(n.path);
    await s.create(n.path, "file");
    const fresh = await s.read(n.path);
    assert.deepEqual(fresh.annotations, []);
    assert.deepEqual(fresh.chat, []);
    assert.equal(fresh.graph, null);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test("对话记录按笔记保存，可以清空，并拒绝伪造的依据", async () => {
  await s.init();
  try {
    await s.create("对话.md", "file");
    let n = await s.read("对话.md");
    n = await s.save(n.path, "今天写下了第一篇笔记。", n.hash);
    n = await s.putChat(
      n.path,
      [
        { role: "user", content: "这篇在说什么？" },
        { role: "assistant", content: "你在记录第一次写笔记。" },
      ],
      n.hash,
    );
    assert.equal(n.chat.length, 2);
    assert.equal(n.chat[0].role, "user");
    assert.equal(n.chat[1].content, "你在记录第一次写笔记。");
    n = await s.save(n.path, "今天写下了第一篇笔记，心情不错。", n.hash);
    assert.equal((await s.read(n.path)).chat.length, 2);
    n = await s.clearChat(n.path, n.hash);
    assert.deepEqual(n.chat, []);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
test("拒绝图中伪造的依据", async () => {
  assert.throws(
    () =>
      validateGraph(
        {
          nodes: [
            { id: "a", title: "观点", content: "内容", excerpt: "伪造的引用" },
          ],
          edges: [],
        },
        "正文",
      ),
    /依据不在/,
  );
});
test("决策图按材料、推理、决策三列布局；流程图按步骤纵向布局", async () => {
  const { layoutGraph } = await import("../lib/graph-layout");
  const decision = {
    kind: "decision" as const,
    sourceHash: "a",
    nodes: [
      { id: "m", title: "材料", content: "路程短", role: "material" as const },
      {
        id: "r",
        title: "权衡",
        content: "步行合适",
        role: "reasoning" as const,
      },
      { id: "d", title: "决策", content: "步行", role: "decision" as const },
    ],
    edges: [
      { source: "m", target: "r" },
      { source: "r", target: "d" },
    ],
  };
  const result = await layoutGraph(decision);
  assert.ok(
    result.find((n) => n.id === "m")!.x < result.find((n) => n.id === "r")!.x,
  );
  assert.ok(
    result.find((n) => n.id === "r")!.x < result.find((n) => n.id === "d")!.x,
  );
  const flow = await layoutGraph({ ...decision, kind: "flow" });
  assert.ok(
    flow.find((n) => n.id === "m")!.y < flow.find((n) => n.id === "r")!.y,
  );
  assert.ok(
    flow.find((n) => n.id === "r")!.y < flow.find((n) => n.id === "d")!.y,
  );
});
test("流程回路不倒置主流程顺序", async () => {
  const { layoutGraph } = await import("../lib/graph-layout");
  const graph = {
    kind: "flow" as const,
    sourceHash: "x",
    nodes: ["start", "check", "condition", "retry", "copy", "done"].map(
      (id) => ({ id, title: id, content: id, role: "step" as const }),
    ),
    edges: [
      { source: "start", target: "check" },
      { source: "check", target: "condition" },
      { source: "condition", target: "retry" },
      { source: "retry", target: "check" },
      { source: "condition", target: "copy" },
      { source: "copy", target: "done" },
    ],
  };
  const positions = await layoutGraph(graph);
  const y = (id: string) => positions.find((n) => n.id === id)!.y;
  assert.ok(y("start") < y("check"));
  assert.ok(y("check") < y("condition"));
  assert.ok(y("condition") < y("copy"));
  assert.ok(y("copy") < y("done"));
  assert.ok(y("retry") > y("check"));
  assert.equal(graph.edges.length, 6);
});
