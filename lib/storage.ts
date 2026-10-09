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
// 笔记目录由环境变量在运行时决定，Turbopack 不必做静态分析
export const root = path.resolve(
  /*turbopackIgnore: true*/ process.env.NOTES_DIR || "./data",
);
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** 笔记库就是笔记目录下的一层真实文件夹；库自己的状态放在库内的 .app 里。 */
export const defaultLibrary = "我的笔记库";
const appDir = path.join(root, ".app");
const librariesFile = path.join(appDir, "libraries.json");
type Libraries = { active: string; names: string[] };
let cached: Libraries | null = null;
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
const isDirectory = (target: string) =>
  fs
    .stat(target)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
async function writeLibraries(value: Libraries) {
  await fs.mkdir(appDir, { recursive: true });
  await atomic(librariesFile, JSON.stringify(value));
  cached = value;
}
/**
 * 老版本把笔记直接放在笔记目录下，没有“库”这一层。
 * 首次读到没有库清单时，把现有内容整体收进一个默认库，笔记、图和回收站都不动。
 */
async function migrate(): Promise<Libraries> {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const visible = entries.filter(
    (entry) => !entry.name.startsWith(".") && !entry.isSymbolicLink(),
  );
  const directories = visible.filter((entry) => entry.isDirectory());
  const loose = visible.filter((entry) => !entry.isDirectory());
  const ready: string[] = [];
  for (const directory of directories)
    if (await isDirectory(path.join(root, directory.name, ".app")))
      ready.push(directory.name);
  // 已经是一层库文件夹的结构（每个库里有自己的 .app），照原样登记
  if (ready.length && ready.length === directories.length && !loose.length) {
    const value = { active: ready[0], names: ready };
    await writeLibraries(value);
    return value;
  }
  const name = defaultLibrary;
  const target = path.join(root, name);
  const meta = path.join(target, ".app");
  await fs.mkdir(meta, { recursive: true });
  for (const entry of visible)
    await fs.rename(path.join(root, entry.name), path.join(target, entry.name));
  // 旧的库级状态（关系图、对话、标签、顺序、回收站）跟着进库；登录失败记录留在应用级
  const legacy = path.join(root, ".app");
  if (await isDirectory(legacy))
    for (const item of await fs.readdir(legacy))
      if (item !== "login-guard.json")
        await fs.rename(path.join(legacy, item), path.join(meta, item));
  const value = { active: name, names: [name] };
  await writeLibraries(value);
  return value;
}
async function libraries(): Promise<Libraries> {
  if (cached) return cached;
  try {
    const value = JSON.parse(await fs.readFile(librariesFile, "utf8"));
    const names: string[] = Array.isArray(value?.names)
      ? value.names.filter(
          (name: unknown) =>
            typeof name === "string" && name && !name.startsWith("."),
        )
      : [];
    if (names.length) {
      cached = {
        names,
        active: names.includes(value.active) ? value.active : names[0],
      };
      return cached;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return migrate();
}
/** 当前笔记库的真实目录：所有笔记路径都相对它解析。 */
async function libraryDir(): Promise<string> {
  // 库目录是运行时才知道的，明确告诉 Turbopack 不用静态追踪这些文件访问
  return path.join(/*turbopackIgnore: true*/ root, (await libraries()).active);
}
/** 库名要能直接当文件夹名用，也不能和现有文件撞名。 */
async function validLibraryName(name: unknown): Promise<string> {
  if (typeof name !== "string") throw new UserError("请填写笔记库名称");
  const value = name.trim();
  if (!value) throw new UserError("请填写笔记库名称");
  if (value.length > 40) throw new UserError("笔记库名称最多 40 个字");
  if (value.startsWith(".") || value.includes("/") || value.includes("\\"))
    throw new UserError("名称里不能有斜杠，也不能以点开头");
  return value;
}
export async function init() {
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });
  const value = await libraries();
  await fs.mkdir(path.join(root, value.active, ".app"), { recursive: true });
}
const exists = (target: string) =>
  fs.stat(target).then(
    () => true,
    () => false,
  );
/** 当前有哪些笔记库、正在用哪一个。 */
export async function libraryList(): Promise<Libraries> {
  await init();
  return libraries();
}
export async function createLibrary(name: unknown) {
  const value = await validLibraryName(name);
  await init();
  const state = await libraries();
  if (state.names.includes(value))
    throw new UserError("已经有同名的笔记库了", 409);
  if (await exists(path.join(root, value)))
    throw new UserError("这个名字已经被占用了", 409);
  await fs.mkdir(path.join(root, value, ".app"), { recursive: true });
  await writeLibraries({ names: [...state.names, value], active: value });
  return tree();
}
export async function useLibrary(name: unknown) {
  const value = await validLibraryName(name);
  await init();
  const state = await libraries();
  if (!state.names.includes(value)) throw new UserError("没有这个笔记库", 404);
  await writeLibraries({ ...state, active: value });
  return tree();
}
export async function renameLibrary(from: unknown, to: unknown) {
  const source = await validLibraryName(from);
  const target = await validLibraryName(to);
  await init();
  const state = await libraries();
  if (!state.names.includes(source)) throw new UserError("没有这个笔记库", 404);
  if (source === target) return tree();
  if (state.names.includes(target))
    throw new UserError("已经有同名的笔记库了", 409);
  if (await exists(path.join(root, target)))
    throw new UserError("这个名字已经被占用了", 409);
  await fs.rename(path.join(root, source), path.join(root, target));
  await writeLibraries({
    names: state.names.map((item) => (item === source ? target : item)),
    active: state.active === source ? target : state.active,
  });
  return tree();
}
/**
 * 把当前笔记库里的一项搬到另一本笔记库，相对路径不变（目标库里缺哪层目录就建哪层），
 * 配套的关系图、对话和标签一起搬过去。
 */
export async function moveToLibrary(relative: string, library: unknown) {
  const target = await validLibraryName(library);
  await init();
  const state = await libraries();
  if (!state.names.includes(target)) throw new UserError("没有这个笔记库", 404);
  if (target === state.active) return tree();
  const source = await safe(relative);
  const files = await listFiles(relative);
  const destination = path.join(root, target, relative);
  if (await exists(destination))
    throw new UserError(`「${target}」里已经有同名的笔记或文件夹`, 409);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
  for (const file of files) {
    const from = await metadata(file);
    if (!(await exists(from))) continue;
    await fs.mkdir(path.join(root, target, ".app"), { recursive: true });
    await fs.rename(
      from,
      path.join(root, target, ".app", hash(file) + ".json"),
    );
  }
  return tree();
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
  const base = await libraryDir();
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new UserError("文件路径无效");
  let current = base;
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
const metadata = async (relative: string) =>
  path.join(await libraryDir(), ".app", hash(relative) + ".json");
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
    return JSON.parse(await fs.readFile(await metadata(relative), "utf8"));
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
  const entries = await fs.readdir(
    directory ? await safe(directory) : await libraryDir(),
    {
      withFileTypes: true,
    },
  );
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
    await atomic(await metadata(relative), JSON.stringify(m));
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
  await atomic(await metadata(relative), JSON.stringify(m));
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
    await fs.rm(await metadata(relative), { force: true });
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
    await atomic(await metadata(to + f.slice(from.length)), JSON.stringify(m));
    await fs.rm(await metadata(f), { force: true });
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
/** 回收站跟着库走：每个库自己的 .app 里存一份，只显示当前库删掉的东西。 */
const trashDirectory = async () =>
  path.join(await libraryDir(), ".app", "trash");
const trashIndex = async () =>
  path.join(await libraryDir(), ".app", "trash.json");
/** 回收站记录除了列表要显示的字段，还带着删除前的元数据（图、对话、标签）。 */
type TrashRecord = TrashEntry & { files: Record<string, string> };
async function readTrashIndex(): Promise<TrashRecord[]> {
  try {
    const value = JSON.parse(await fs.readFile(await trashIndex(), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
const writeTrashIndex = (records: TrashRecord[]) =>
  trashIndex().then((file) => atomic(file, JSON.stringify(records)));
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
  const directory = await trashDirectory();
  await fs.mkdir(directory, { recursive: true });
  const records = await readTrashIndex();
  const known = new Map(records.map((record) => [record.id, record]));
  const list: TrashEntry[] = [];
  for (const id of await fs.readdir(directory)) {
    if (id.startsWith(".")) continue;
    const record = known.get(id);
    if (record) {
      const { files, ...entry } = record;
      list.push(entry);
      continue;
    }
    const stat = await fs.stat(path.join(directory, id)).catch(() => null);
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
  const directory = await trashDirectory();
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.stat(file);
  const files = await listFiles(relative);
  const carried: Record<string, string> = {};
  for (const item of files) {
    const value = await meta(item);
    if (Object.keys(value).length) carried[item] = JSON.stringify(value);
  }
  const id = Date.now() + "-" + randomUUID() + "-" + path.basename(file);
  await fs.rename(file, path.join(directory, id));
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
  for (const item of files) await fs.rm(await metadata(item), { force: true });
  return tree();
}
async function findTrash(id: string) {
  if (!id || id.startsWith(".") || /[\\/]/.test(id))
    throw new UserError("回收站项目无效");
  const source = path.join(await trashDirectory(), id);
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
          .stat(path.join(/*turbopackIgnore: true*/ await libraryDir(), parent))
          .then((stat) => stat.isDirectory())
          .catch(() => false)
      : true;
  const to =
    parentExists && parent !== "." ? parent + "/" + entry.name : entry.name;
  const target = await safe(to);
  if (await exists(target))
    throw new UserError("原位置已经有同名的笔记，请先改名或删除它", 409);
  await fs.rename(source, target);
  for (const [from, value] of Object.entries(record?.files || {}))
    await atomic(await metadata(to + from.slice(entry.path.length)), value);
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
  const directory = await trashDirectory();
  for (const id of await fs.readdir(directory).catch(() => []))
    if (!id.startsWith("."))
      await fs.rm(path.join(directory, id), {
        recursive: true,
        force: true,
      });
  await writeTrashIndex([]);
  return tree();
}

async function readOrders(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(await libraryDir(), ".app", "order.json"),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
async function writeOrders(orders: Record<string, string[]>) {
  await atomic(
    path.join(await libraryDir(), ".app", "order.json"),
    JSON.stringify(orders),
  );
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
  await atomic(await metadata(relative), JSON.stringify(m));
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
  await atomic(await metadata(relative), JSON.stringify(m));
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
  await atomic(await metadata(relative), JSON.stringify(m));
  return read(relative);
}
export async function clearChat(relative: string, expected: string) {
  const note = await read(relative);
  if (note.hash !== expected)
    throw new UserError("正文已更新，请重新打开笔记", 409);
  const m = await meta(relative);
  delete m.chat;
  await atomic(await metadata(relative), JSON.stringify(m));
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
  await atomic(await metadata(relative), JSON.stringify(m));
  return read(relative);
}
