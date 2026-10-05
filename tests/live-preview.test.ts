import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { buildDecorations } from "../components/live-preview";

const table = [
  "# 重要密码",
  "",
  "| 平台 | 账号 | 密码 | 平台作用 |",
  "| --- | --- | --- | --- |",
  "| 第八届艺术展演 | 17362845575 | Lhf@2001. | 上传艺术展演视频 |",
  "| 孝感云平台 | ymxhjdzx | HJDzx2022 | 名师工作室 |",
  "",
  "这次是 6500 公里",
].join("\n");

const at = (doc: string, from: number, to = from) =>
  EditorState.create({ doc, selection: { anchor: from, head: to } });

type Spec = {
  block?: boolean;
  widget?: { rows: string[][]; align: (string | null)[] };
};

const tableWidgets = (state: EditorState) => {
  const found: Spec[] = [];
  const set = buildDecorations(state, []);
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const value = cursor.value;
    if (!value) break;
    if (value.spec.widget) found.push(value.spec as Spec);
  }
  return found;
};

test("表格渲染成真正的表格，光标移进去后显示源码", () => {
  const widgets$ = tableWidgets(at(table, 0));
  assert.equal(widgets$.length, 1, "整张表只生成一个表格组件");
  const table$ = widgets$[0];
  assert.equal(table$.block, true, "跨行的表格必须是块级替换");
  assert.deepEqual(table$.widget?.rows, [
    ["平台", "账号", "密码", "平台作用"],
    ["---", "---", "---", "---"],
    ["第八届艺术展演", "17362845575", "Lhf@2001.", "上传艺术展演视频"],
    ["孝感云平台", "ymxhjdzx", "HJDzx2022", "名师工作室"],
  ]);

  const inside = table.indexOf("第八届");
  assert.equal(
    tableWidgets(at(table, inside)).length,
    1,
    "光标落在表格里时仍然渲染成表格",
  );
  const opened = buildDecorations(at(table, inside), [], table.indexOf("|"));
  let collapsed = 0;
  let source = 0;
  for (const cursor = opened.iter(); cursor.value; cursor.next()) {
    const value = cursor.value;
    if (!value) break;
    if (value.spec.widget) collapsed++;
    if (value.spec.class === "cm-table-source") source++;
  }
  assert.equal(collapsed, 0, "点开表格后换成源码");
  assert.equal(source, 4, "表格的每一行都标记为源码行");
});

test("缺少分隔行的管道文字不当表格，短内容也不报错", () => {
  const plain = "| 这不是表格 | 只是竖线 |\n普通文字";
  assert.deepEqual(tableWidgets(at(plain, 0)), []);
  assert.ok(buildDecorations(EditorState.create({ doc: "" }), []));
});

test("表格对齐与转义竖线按 GFM 解析", () => {
  const doc = [
    "# 对齐",
    "",
    "| 左 | 中 | 右 |",
    "| :--- | :---: | ---: |",
    "| a \\| b | c | d |",
  ].join("\n");
  const spec = tableWidgets(at(doc, 0))[0];
  assert.deepEqual(spec.widget?.align, ["left", "center", "right"]);
  assert.deepEqual(spec.widget?.rows[2], ["a | b", "c", "d"]);
});
