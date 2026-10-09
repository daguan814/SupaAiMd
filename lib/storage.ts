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
  TrashEntry,
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
  const rank = (entry: Entry) => {
    const index = order.indexOf(entry.path);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  // 拖拽过的项按保存的顺序排；没排过的保持“文件夹在前、其余按名称”。
  return result.sort((a, b) => {
    const byOrder = rank(a) - rank(b);
    if (byOrder) return byOrder;
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
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
const trashDirectory = path.join(root, ".app", "trash");
const trashIndex = path.join(root, ".app", "trash.json");
/** 回收站记录除了列表要显示的字段，还带着删除前的元数据（图、对话、标签）。 */
type TrashRecord = TrashEntry & { files: Record<string, string> };
async function readTrashIndex(): Promise<TrashRecord[]> {
  try {
    const value = JSON.parse(await fs.readFile(trashIndex, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
const writeTrashIndex = (records: TrashRecord[]) =>
  atomic(trashIndex, JSON.stringify(records));
/**
 * 早期版本没记删除前的位置，回收站里的名字是「时间戳-uuid-原文件名」；
 * 这种记录按文件名解析，放回时回到笔记库根目录。
 */
function legacyTrash(id: string, isDirectory: boolean): TrashEntry {
  const matched = /^(\d{10,})-([0-9a-f-]{36})-(.+)$/.exec(id);
  const name = matched ? matched[3] : id;
  const time = matched ? new Date(Number(matched[1])) : null;
  return {
    id,
    name,
    path: name,
    type: isDirectory ? "folder" : "file",
    deletedAt: time && !Number.isNaN(time.getTime()) ? time.toISOString() : "",
  };
}
export async function trashList(): Promise<TrashEntry[]> {
  await init();
  await fs.mkdir(trashDirectory, { recursive: true });
  const records = await readTrashIndex();
  const known = new Map(records.map((record) => [record.id, record]));
  const list: TrashEntry[] = [];
  for (const id of await fs.readdir(trashDirectory)) {
    if (id.startsWith(".")) continue;
    const record = known.get(id);
    if (record) {
      const { files, ...entry } = record;
      list.push(entry);
      continue;
    }
    const stat = await fs.stat(path.join(trashDirectory, id)).catch(() => null);
    if (!stat) continue;
    const entry = legacyTrash(id, stat.isDirectory());
    list.push({
      ...entry,
      deletedAt: entry.deletedAt || stat.mtime.toISOString(),
    });
  }
  return list.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}
export async function trash(relative: string) {
  const file = await safe(relative);
  await init();
  await fs.mkdir(trashDirectory, { recursive: true });
  const stat = await fs.stat(file);
  const files = await listFiles(relative);
  const carried: Record<string, string> = {};
  for (const item of files) {
    const value = await meta(item);
    if (Object.keys(value).length) carried[item] = JSON.stringify(value);
  }
  const id = Date.now() + "-" + randomUUID() + "-" + path.basename(file);
  await fs.rename(file, path.join(trashDirectory, id));
  const records = await readTrashIndex();
  records.push({
    id,
    name: path.basename(file),
    path: relative,
    type: stat.isDirectory() ? "folder" : "file",
    deletedAt: new Date().toISOString(),
    files: carried,
  });
  await writeTrashIndex(records);
  for (const item of files) await fs.rm(metadata(item), { force: true });
  return tree();
}
async function findTrash(id: string) {
  if (!id || id.startsWith(".") || /[\\/]/.test(id))
    throw new UserError("回收站项目无效");
  const source = path.join(trashDirectory, id);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new UserError("回收站里已经没有这一项", 404);
  const records = await readTrashIndex();
  const record = records.find((item) => item.id === id);
  const entry = record
    ? {
        id: record.id,
        name: record.name,
        path: record.path,
        type: record.type,
        deletedAt: record.deletedAt,
      }
    : legacyTrash(id, stat.isDirectory());
  return { source, record, entry, records };
}
/** 把回收站里的笔记放回原位；原位置被占用时明确报错，不覆盖现在的笔记。 */
export async function restore(id: string) {
  await init();
  const { source, record, entry, records } = await findTrash(id);
  const parent = path.posix.dirname(entry.path);
  const parentExists =
    parent && parent !== "."
      ? await fs
          .stat(path.join(root, parent))
          .then((stat) => stat.isDirectory())
          .catch(() => false)
      : true;
  const to =
    parentExists && parent !== "." ? parent + "/" + entry.name : entry.name;
  const target = await safe(to);
  if (
    await fs.stat(target).then(
      () => true,
      () => false,
    )
  )
    throw new UserError("原位置已经有同名的笔记，请先改名或删除它", 409);
  await fs.rename(source, target);
  for (const [from, value] of Object.entries(record?.files || {}))
    await atomic(metadata(to + from.slice(entry.path.length)), value);
  await writeTrashIndex(records.filter((item) => item.id !== id));
  return tree();
}
export async function purge(id: string) {
  await init();
  const { source, records } = await findTrash(id);
  await fs.rm(source, { recursive: true, force: true });
  await writeTrashIndex(records.filter((item) => item.id !== id));
  return tree();
}
export async function emptyTrash() {
  await init();
  for (const id of await fs.readdir(trashDirectory).catch(() => []))
    if (!id.startsWith("."))
      await fs.rm(path.join(trashDirectory, id), {
        recursive: true,
        force: true,
      });
  await writeTrashIndex([]);
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
  const children = (await tree(parent)).map((e) => e.path);
  if (
    !Array.isArray(ordered) ||
    ordered.some((p) => typeof p !== "string") ||
    new Set(ordered).size !== children.length ||
    ordered.length !== children.length ||
    children.some((p) => !ordered.includes(p))
  )
    throw new UserError("笔记列表已变化，请刷新后重新排序", 409);
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
