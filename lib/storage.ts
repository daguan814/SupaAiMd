import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  Entry,
  Graph,
  Note,
  Annotation,
  ChatMessage,
  GraphFeedback,
} from "./types";
export const root = path.resolve(process.env.NOTES_DIR || "./data");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
let queue: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}
export async function init() {
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, ".app"), { recursive: true });
}
export async function safe(relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    relative
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith(".")) ||
    path.isAbsolute(relative)
  )
    throw new UserError("文件路径无效");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new UserError("文件路径无效");
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new UserError("不支持符号链接");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return target;
}
const metadata = (relative: string) =>
  path.join(root, ".app", hash(relative) + ".json");
type Meta = {
  graph?: Graph;
  previous?: string;
  annotations?: Annotation[];
  chat?: ChatMessage[];
  feedback?: GraphFeedback[];
  graphPrevious?: Graph;
};
async function meta(relative: string): Promise<Meta> {
  try {
    return JSON.parse(await fs.readFile(metadata(relative), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
async function atomic(file: string, content: string) {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function tree(directory = "", depth = 0): Promise<Entry[]> {
  if (depth > 30) return [];
  await init();
  const entries = await fs.readdir(directory ? await safe(directory) : root, {
    withFileTypes: true,
  });
  const result: Entry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const relative = directory ? directory + "/" + entry.name : entry.name;
    if (entry.isDirectory())
      result.push({
        name: entry.name,
        path: relative,
        type: "folder",
        children: await tree(relative, depth + 1),
      });
    else if (entry.isFile() && entry.name.endsWith(".md"))
      result.push({ name: entry.name, path: relative, type: "file" });
  }
  const orders = await readOrders();
  const order = orders[directory] || [];
  return result.sort((a, b) =>
    a.type === b.type
      ? (a.type === "folder"
          ? (order.indexOf(a.path) < 0 ? 99999 : order.indexOf(a.path)) -
            (order.indexOf(b.path) < 0 ? 99999 : order.indexOf(b.path))
          : 0) || a.name.localeCompare(b.name, "zh-CN")
      : a.type === "folder"
        ? -1
        : 1,
  );
}
export async function read(relative: string): Promise<Note> {
  if (!relative.endsWith(".md")) throw new UserError("请选择 Markdown 笔记");
  const file = await safe(relative);
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new UserError("笔记不存在", 404);
    throw e;
  }
  const m = await meta(relative);
  return {
    path: relative,
    content,
    hash: hash(content),
    graph: m.graph || null,
    graphHash: hash(JSON.stringify(m.graph || null)),
    canUndo: m.previous !== undefined,
    annotations: m.annotations || [],
    annotationsHash: hash(JSON.stringify(m.annotations || [])),
    chat: m.chat || [],
    feedback: m.feedback || [],
    canUndoGraph: !!m.graphPrevious,
  };
}
export async function save(
  relative: string,
  content: string,
  expected: string,
  backup = false,
) {
  const note = await read(relative);
  if (note.hash !== expected)
    throw new UserError(
      "笔记已在其他窗口更新，请重新打开后再保存。当前文字仍保留在编辑器中。",
      409,
    );
  if (Buffer.byteLength(content) > 500_000)
    throw new UserError("笔记不能超过 500 KB");
  if (backup) {
    const m = await meta(relative);
    m.previous = note.content;
    await atomic(metadata(relative), JSON.stringify(m));
  }
  await atomic(await safe(relative), content);
  return read(relative);
}
export async function putGraph(
  relative: string,
  graph: Graph,
  expected: string,
  expectedGraph?: string,
  instruction?: string,
) {
  const note = await read(relative);
  if (note.hash !== expected)
    throw new UserError("生成期间正文已更新，请重新生成", 409);
  const m = await meta(relative);
  if (
    expectedGraph !== undefined &&
    hash(JSON.stringify(m.graph || null)) !== expectedGraph
  )
    throw new UserError("关系图已在其他窗口更新，请重新打开后再修改", 409);
  if (m.graph) m.graphPrevious = m.graph;
  m.graph = graph;
  if (instruction)
    m.feedback = [
      ...(m.feedback || []),
      {
        id: randomUUID(),
        instruction,
        createdAt: new Date().toISOString(),
        sourceHash: note.hash,
      },
    ].slice(-40);
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function undo(relative: string, expected: string) {
  const m = await meta(relative);
  if (m.previous === undefined) throw new UserError("没有可恢复的版本");
  return save(relative, m.previous, expected, true);
}
export async function create(relative: string, type: string) {
  await init();
  const file = await safe(relative);
  if (type === "folder") {
    await fs.mkdir(file);
  } else {
    if (!relative.endsWith(".md")) throw new UserError("笔记需使用 .md 扩展名");
    await fs.writeFile(file, "", { flag: "wx" });
    await fs.rm(metadata(relative), { force: true });
  }
  return tree();
}
async function listFiles(relative: string): Promise<string[]> {
  const file = await safe(relative);
  if ((await fs.stat(file)).isFile()) return [relative];
  const entries = await fs.readdir(file, { withFileTypes: true });
  const all: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
    all.push(...(await listFiles(relative + "/" + e.name)));
  }
  return all;
}
export async function move(from: string, to: string) {
  const source = await safe(from),
    target = await safe(to);
  if (from.endsWith(".md") && !to.endsWith(".md"))
    throw new UserError("笔记需保留 .md 扩展名");
  try {
    await fs.lstat(target);
    throw new UserError("该名称已经存在");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const files = await listFiles(from);
  await fs.rename(source, target);
  for (const f of files) {
    const m = await meta(f);
    await atomic(metadata(to + f.slice(from.length)), JSON.stringify(m));
    await fs.rm(metadata(f), { force: true });
  }
  const orders = await readOrders();
  const mapped: Record<string, string[]> = {};
  const rename = (p: string) =>
    p === from || p.startsWith(from + "/") ? to + p.slice(from.length) : p;
  for (const [parent, children] of Object.entries(orders))
    mapped[rename(parent)] = children
      .map(rename)
      .filter((child) => path.posix.dirname(child) === (rename(parent) || "."));
  await writeOrders(mapped);
  return tree();
}
export async function trash(relative: string) {
  const file = await safe(relative);
  const directory = path.join(root, ".app", "trash");
  await fs.mkdir(directory, { recursive: true });
  await fs.rename(
    file,
    path.join(
      directory,
      Date.now() + "-" + randomUUID() + "-" + path.basename(file),
    ),
  );
  return tree();
}

async function readOrders(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(root, ".app", "order.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
async function writeOrders(orders: Record<string, string[]>) {
  await atomic(path.join(root, ".app", "order.json"), JSON.stringify(orders));
}
export async function reorder(parent: string, ordered: string[]) {
  if (parent) await safe(parent);
  const folders = (await tree(parent))
    .filter((e) => e.type === "folder")
    .map((e) => e.path);
  if (
    !Array.isArray(ordered) ||
    ordered.some((p) => typeof p !== "string") ||
    new Set(ordered).size !== folders.length ||
    ordered.length !== folders.length ||
    folders.some((p) => !ordered.includes(p))
  )
    throw new UserError("文件夹列表已变化，请刷新后重新排序", 409);
  const orders = await readOrders();
  orders[parent] = ordered;
  await writeOrders(orders);
  return tree();
}
export async function putAnnotation(
  relative: string,
  input: { id?: string; quote: string; label: string },
  expected: string,
  expectedAnnotations: string,
) {
  const note = await read(relative);
  if (note.hash !== expected || note.annotationsHash !== expectedAnnotations)
    throw new UserError("标注或正文已在其他窗口更新，请重新打开笔记", 409);
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (
    typeof input.quote !== "string" ||
    !input.quote ||
    input.quote.length > 300 ||
    !note.content.includes(input.quote)
  )
    throw new UserError("选中的文字不在当前正文里，请重新选择");
  if (!label || label.length > 12) throw new UserError("标签需要 1 到 12 个字");
  if (
    note.annotations.some(
      (item) =>
        item.quote === input.quote &&
        item.id !== input.id &&
        item.label === label,
    )
  )
    throw new UserError("这句话已经贴过同样的标签");
  if (note.annotations.length > 200) throw new UserError("标注最多 200 条");
  const existing = input.id
    ? note.annotations.find((item) => item.id === input.id)
    : undefined;
  if (input.id && !existing)
    throw new UserError("这条标注不存在，请重新打开笔记", 409);
  const entry: Annotation = existing
    ? { ...existing, quote: input.quote, label }
    : {
        id: randomUUID(),
        quote: input.quote,
        label,
        createdAt: new Date().toISOString(),
      };
  const m = await meta(relative);
  m.annotations = existing
    ? note.annotations.map((item) => (item.id === entry.id ? entry : item))
    : [...note.annotations, entry];
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function removeAnnotation(
  relative: string,
  id: string,
  expected: string,
  expectedAnnotations: string,
) {
  const note = await read(relative);
  if (note.hash !== expected || note.annotationsHash !== expectedAnnotations)
    throw new UserError("标注或正文已在其他窗口更新，请重新打开笔记", 409);
  if (!note.annotations.some((item) => item.id === id))
    throw new UserError("这条标注已经不存在了", 409);
  const m = await meta(relative);
  m.annotations = note.annotations.filter((item) => item.id !== id);
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function putChat(
  relative: string,
  messages: Omit<ChatMessage, "id" | "createdAt">[],
  expected: string,
) {
  const note = await read(relative);
  if (note.hash !== expected)
    throw new UserError("对话期间正文已更新，请重新发送", 409);
  if (messages.length > 60) throw new UserError("对话太长了，先清空再继续");
  const now = new Date().toISOString();
  const m = await meta(relative);
  m.chat = messages.map((message) => ({
    id: randomUUID(),
    role: message.role,
    content: message.content,
    ...(message.kind ? { kind: message.kind } : {}),
    createdAt: now,
  }));
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function clearChat(relative: string, expected: string) {
  const note = await read(relative);
  if (note.hash !== expected)
    throw new UserError("正文已更新，请重新打开笔记", 409);
  const m = await meta(relative);
  delete m.chat;
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function undoGraph(
  relative: string,
  expected: string,
  expectedGraph: string,
) {
  const note = await read(relative);
  const m = await meta(relative);
  if (!m.graphPrevious) throw new UserError("没有可恢复的关系图");
  if (
    note.hash !== expected ||
    hash(JSON.stringify(m.graph || null)) !== expectedGraph
  )
    throw new UserError("正文或关系图已更新，请重新打开笔记", 409);
  const previous = m.graphPrevious;
  m.graphPrevious = m.graph;
  m.graph = previous;
  await atomic(metadata(relative), JSON.stringify(m));
  return read(relative);
}
