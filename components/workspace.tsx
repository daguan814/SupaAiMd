"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import Insights from "./insights";
import ChatPanel from "./chat-panel";
import { editorTheme, livePreview } from "./live-preview";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import {
  BookOpen,
  ChevronRight,
  Folder,
  FileText,
  Plus,
  FolderPlus,
  Search,
  Sparkles,
  Network,
  ArrowUpRight,
  MoreHorizontal,
  Download,
  Undo2,
  PanelLeftClose,
  PanelLeft,
  Check,
  Loader2,
  X,
  Feather,
  Pencil,
  Upload,
  MessageSquare,
  Tag,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  RotateCcw,
  Library,
  ChevronDown,
  Settings,
} from "lucide-react";
import type { Entry, Note, TrashEntry } from "@/lib/types";
import pkg from "../package.json";
const Editor = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
const GraphView = dynamic(() => import("./graph-view"), { ssr: false });
const version = "V" + pkg.version;
const welcome =
  "# 给想法一个安放的地方\n\n不必一开始就写得很好。先记录，思路会在书写中慢慢清晰。\n\n## 我想记录什么\n\n- 今天发生的事情，以及我的感受\n- 一个还不成熟，但值得留下的想法\n- 工作和学习中的发现\n\n## 从记录到理解\n\n点击「生成关系图」，把笔记里的观点、原因与结论连起来。\n\n有话想说时，点开「和 AI 聊天」，让它陪你把这页笔记聊清楚。\n\n> 文字留下细节，关系图帮助我看见全貌。\n";
type Dialog = {
  kind: "file" | "folder" | "move" | "trash";
  path: string;
  value: string;
};
type TagMenu = {
  quote: string;
  x: number;
  y: number;
  id?: string;
  label?: string;
};
type TagAnchor = { quote: string; x: number; y: number };
function count(entries: Entry[]): number {
  return entries.reduce(
    (n, e) => n + (e.type === "file" ? 1 : count(e.children || [])),
    0,
  );
}
const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
/** 回收站里显示“多久之前删的”，超过一周就直接写日期。 */
function deletedLabel(value: string): string {
  const time = new Date(value);
  if (!value || Number.isNaN(time.getTime())) return "时间不详";
  const minutes = Math.floor((Date.now() - time.getTime()) / 60000);
  if (minutes < 1) return "刚刚删除";
  if (minutes < 60) return `${minutes} 分钟前删除`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前删除`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} 天前删除`;
  return time.toLocaleDateString("zh-CN") + " 删除";
}
function findTreeEntry(list: Entry[], path: string): Entry | undefined {
  for (const entry of list) {
    if (entry.path === path) return entry;
    const nested = findTreeEntry(entry.children || [], path);
    if (nested) return nested;
  }
}
const childrenOf = (list: Entry[], parent: string) =>
  parent ? findTreeEntry(list, parent)?.children || [] : list;
/** 不能把文件夹拖进自己或自己的子孙里。 */
const canMoveInto = (source: string, folder: string) =>
  !!source && source !== folder && !folder.startsWith(source + "/");
/** 拖到它现在所属的文件夹上不算移动。 */
const canDropInto = (source: string, folder: string) =>
  parentOf(source) !== folder && canMoveInto(source, folder);
export default function Workspace() {
  const [entries, setEntries] = useState<Entry[]>([]),
    [note, setNote] = useState<Note | null>(null),
    [text, setText] = useState(""),
    [mode, setMode] = useState<"note" | "graph">("note"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("已保存"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [ai, setAi] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [closed, setClosed] = useState<Set<string>>(new Set()),
    [login, setLogin] = useState(false),
    [password, setPassword] = useState("");
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const [panel, setPanel] = useState<"feedback" | null>(null);
  const [instruction, setInstruction] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashConfirm, setTrashConfirm] = useState<string | null>(null);
  const [libraries, setLibraries] = useState<{
    names: string[];
    active: string;
  }>({ names: [], active: "" });
  const [libraryMenu, setLibraryMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [settings, setSettings] = useState(false);
  const [newLibrary, setNewLibrary] = useState("");
  const [renaming, setRenaming] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [tagAnchor, setTagAnchor] = useState<TagAnchor | null>(null);
  const [tagMenu, setTagMenu] = useState<TagMenu | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [editTable, setEditTable] = useState<number | null>(null);
  const [drop, setDrop] = useState<{
    path: string;
    mode: "before" | "after" | "into";
  } | null>(null);
  const annotations = note?.annotations;
  const editorExtensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      editorTheme,
      livePreview(annotations ?? [], editTable),
    ],
    [annotations, editTable],
  );
  const dragPath = useRef<string | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu && !libraryMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest(".file-menu,.tree-more,.library-switch"))
        setMenu(null);
      if (!target.closest(".library-menu,.library-switch"))
        setLibraryMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setLibraryMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu, libraryMenu]);
  useEffect(() => {
    if (!tagMenu && !tagAnchor) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest(".tag-menu") || target.closest(".tag-anchor")) return;
      setTagMenu(null);
      setTagAnchor(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setTagMenu(null);
      setTagAnchor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [tagMenu, tagAnchor]);
  useEffect(() => {
    if (!trashOpen) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busyRef.current) return;
      setTrashOpen(false);
      setTrashConfirm(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [trashOpen]);
  const current = useRef<Note | null>(null),
    draft = useRef(""),
    pending = useRef<Promise<void> | null>(null),
    busyRef = useRef(false),
    upload = useRef<HTMLInputElement>(null);
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(
      path,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const data = await response.json();
    if (response.status === 401) setLogin(true);
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }, []);
  const apply = (n: Note) => {
    if (current.current?.path !== n.path) {
      setInstruction("");
      setPanel(null);
    }
    current.current = n;
    draft.current = n.content;
    setNote(n);
    setText(n.content);
    setStatus("已保存");
    try {
      localStorage.setItem("moxu-last-note", n.path);
    } catch {}
    setTagMenu(null);
    setEditTable(null);
    setChatInput("");
    if (window.innerWidth < 640) setSidebar(false);
  };
  const load = useCallback(async () => {
    try {
      const data = await api("/api/workspace");
      setEntries(data.tree);
      setAi(data.aiConfigured);
      setTrash(data.trash || []);
      if (data.libraries) setLibraries(data.libraries);
      if (!current.current) {
        let last: string | null = null;
        try {
          last = localStorage.getItem("moxu-last-note");
        } catch {}
        const exists = (list: Entry[]): boolean =>
          list.some((e) => e.path === last || exists(e.children || []));
        if (last && exists(data.tree))
          apply(await api("/api/workspace?path=" + encodeURIComponent(last)));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    if (window.innerWidth < 640) setSidebar(false);
  }, [load]);
  const flush = useCallback(async () => {
    if (pending.current) await pending.current;
    const n = current.current;
    if (!n || draft.current === n.content) return;
    const content = draft.current;
    setStatus("保存中");
    const task = (async () => {
      try {
        const saved: Note = await api("/api/workspace", {
          action: "save",
          path: n.path,
          content,
          hash: n.hash,
        });
        current.current = saved;
        setNote(saved);
        setStatus(draft.current === content ? "已保存" : "待保存");
      } catch (e) {
        setStatus("保存失败");
        throw e;
      }
    })();
    pending.current = task;
    try {
      await task;
    } finally {
      pending.current = null;
    }
    if (draft.current !== current.current?.content) await flush();
  }, [api]);
  useEffect(() => {
    if (!note || text === note.content || busy) return;
    const timer = setTimeout(() => {
      void flush().catch((e) => setError(e.message));
    }, 700);
    return () => clearTimeout(timer);
  }, [text, note, busy, flush]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (current.current && draft.current !== current.current.content) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  };
  const open = (path: string) =>
    run("打开中", async () => {
      await flush();
      apply(await api("/api/workspace?path=" + encodeURIComponent(path)));
      setMenu(null);
      setInstruction("");
    });
  const aiAction = (action: "graph" | "revise") =>
    run(
      {
        graph: "正在规划关系图",
        revise: "正在按评论修改图",
      }[action],
      async () => {
        await flush();
        const n = current.current;
        if (!n) return;
        apply(
          await api("/api/workspace", {
            action,
            path: n.path,
            hash: n.hash,
            ...(action === "revise" ? { instruction } : {}),
          }),
        );
        setMode("graph");
        if (action === "revise") setInstruction("");
      },
    );
  // 选中文字时只浮出一个小按钮，不抢焦点，方便直接复制。
  const rememberSelection = (point?: { x: number; y: number }) => {
    const view = editorRef.current?.view;
    const range = view?.state.selection.main;
    if (!view || !range || range.empty) {
      setTagAnchor(null);
      return;
    }
    const quote = view.state.sliceDoc(range.from, range.to).trim();
    if (!quote || quote.length > 300) {
      setTagAnchor(null);
      return;
    }
    const at = view.coordsAtPos(range.to);
    const width = 92;
    const x = Math.min(
      point?.x ?? at?.left ?? 40,
      window.innerWidth - width - 12,
    );
    const y = Math.min(
      (point?.y ?? at?.bottom ?? 80) + 8,
      window.innerHeight - 46,
    );
    setTagMenu(null);
    setTagAnchor({ quote, x: Math.max(12, x), y: Math.max(12, y) });
  };
  const openTagMenu = (anchor: TagAnchor) => {
    setCustomLabel("");
    setTagAnchor(null);
    setTagMenu(anchor);
  };
  const saveTag = (label: string) =>
    run("正在保存标签", async () => {
      const n = current.current;
      if (!n || !tagMenu) return;
      const trimmed = label.trim().slice(0, 12);
      if (!trimmed) return;
      await flush();
      const latest = current.current!;
      apply(
        await api("/api/workspace", {
          action: "annotate",
          path: latest.path,
          hash: latest.hash,
          annotationsHash: latest.annotationsHash,
          id: tagMenu.id,
          quote: tagMenu.quote,
          label: trimmed,
        }),
      );
      setTagMenu(null);
      setStatus("已贴上标签");
    });
  const dropTag = (id: string) =>
    run("正在移除标签", async () => {
      const n = current.current;
      if (!n) return;
      apply(
        await api("/api/workspace", {
          action: "unannotate",
          path: n.path,
          hash: n.hash,
          annotationsHash: n.annotationsHash,
          id,
        }),
      );
      setTagMenu(null);
      setStatus("已移除标签");
    });
  const sendChat = () =>
    run("AI 正在读这篇笔记", async () => {
      const message = chatInput.trim();
      const n = current.current;
      if (!message || !n) return;
      await flush();
      const latest = current.current!;
      const next: Note = await api("/api/workspace", {
        action: "assist",
        path: latest.path,
        hash: latest.hash,
        message,
      });
      apply(next);
      setChatInput("");
      if (next.content !== latest.content) setStatus("已按你的要求改好");
    });
  const clearChat = () =>
    run("正在清空对话", async () => {
      const n = current.current;
      if (!n) return;
      apply(
        await api("/api/workspace", {
          action: "clearChat",
          path: n.path,
          hash: n.hash,
        }),
      );
    });
  const trashAction = (
    action: "restore" | "purge" | "emptyTrash",
    id: string,
  ) =>
    run(
      {
        restore: "正在恢复",
        purge: "正在删除",
        emptyTrash: "正在清空回收站",
      }[action],
      async () => {
        await flush();
        const data = await api("/api/workspace", { action, path: id });
        setEntries(data.tree);
        setTrash(data.trash);
        setTrashConfirm(null);
        setStatus(action === "restore" ? "已恢复" : "已从回收站删除");
      },
    );
  const openTrash = () =>
    run("正在打开回收站", async () => {
      const data = await api("/api/workspace?trash=1");
      setTrash(data.trash);
      setTrashConfirm(null);
      setTrashOpen(true);
    });
  /** 新建、切换、改名都走这里；换到别的库时把打开中的笔记收起来。 */
  const libraryAction = (
    action: "useLibrary" | "createLibrary" | "renameLibrary",
    name: string,
    to?: string,
  ) =>
    run(
      {
        useLibrary: "正在切换笔记库",
        createLibrary: "正在新建笔记库",
        renameLibrary: "正在改名",
      }[action],
      async () => {
        await flush();
        const data = await api("/api/workspace", {
          action,
          path: name,
          ...(to === undefined ? {} : { to }),
        });
        setEntries(data.tree);
        setTrash(data.trash);
        setLibraries(data.libraries);
        setLibraryMenu(null);
        setRenaming(null);
        if (data.libraries.active !== libraries.active) {
          current.current = null;
          draft.current = "";
          setNote(null);
          setText("");
          setMode("note");
          setChatOpen(false);
        }
      },
    );
  const saveOrder = (parent: string, ordered: string[]) =>
    void run("保存顺序", async () => {
      setEntries(
        (
          await api("/api/workspace", {
            action: "reorder",
            path: parent,
            order: ordered,
          })
        ).tree,
      );
    });
  // 放在某一项之前/之后；跨文件夹时先移动再插到指定位置。
  const place = (source: string, target: string, after: boolean) => {
    if (source === target) return;
    const sourceParent = parentOf(source);
    const targetParent = parentOf(target);
    if (sourceParent === targetParent) {
      const siblings = childrenOf(entries, targetParent)
        .map((entry) => entry.path)
        .filter((path) => path !== source);
      const index = siblings.indexOf(target);
      if (index < 0) return;
      siblings.splice(index + (after ? 1 : 0), 0, source);
      saveOrder(targetParent, siblings);
      return;
    }
    if (!canMoveInto(source, targetParent)) return;
    void run("移动到该文件夹", async () => {
      await flush();
      const name = source.split("/").pop() || source;
      const to = targetParent ? targetParent + "/" + name : name;
      const moved = await api("/api/workspace", {
        action: "move",
        path: source,
        to,
      });
      const siblings = childrenOf(moved.tree, targetParent)
        .map((entry) => entry.path)
        .filter((path) => path !== to);
      const index = siblings.indexOf(target);
      siblings.splice(
        index < 0 ? siblings.length : index + (after ? 1 : 0),
        0,
        to,
      );
      setEntries(
        (
          await api("/api/workspace", {
            action: "reorder",
            path: targetParent,
            order: siblings,
          })
        ).tree,
      );
      await reopenMovedNote(source, to);
    });
  };
  const moveInto = (source: string, folder: string) => {
    if (!canDropInto(source, folder)) return;
    void run("移动到该文件夹", async () => {
      await flush();
      const name = source.split("/").pop() || source;
      const to = folder ? folder + "/" + name : name;
      const moved = await api("/api/workspace", {
        action: "move",
        path: source,
        to,
      });
      setEntries(moved.tree);
      await reopenMovedNote(source, to);
    });
  };
  // 打开中的笔记（或它的父文件夹）被移动后，跟着新路径重新打开。
  const reopenMovedNote = async (from: string, to: string) => {
    const open = current.current;
    if (!open) return;
    if (open.path !== from && !open.path.startsWith(from + "/")) return;
    const next = to + open.path.slice(from.length);
    apply(await api("/api/workspace?path=" + encodeURIComponent(next)));
  };
  const submit = () => {
    if (!dialog) return;
    void run("处理中", async () => {
      await flush();
      let path = dialog.value.trim();
      if (dialog.kind === "file" && !path.endsWith(".md")) path += ".md";
      if (dialog.kind === "file" || dialog.kind === "folder") {
        const parent = dialog.path;
        path = parent ? parent + "/" + path : path;
        const data = await api("/api/workspace", {
          action: "create",
          path,
          type: dialog.kind === "folder" ? "folder" : "file",
        });
        setEntries(data.tree);
        if (dialog.kind === "file")
          apply(await api("/api/workspace?path=" + encodeURIComponent(path)));
      } else if (dialog.kind === "move") {
        const parent = parentOf(dialog.path);
        let name = path.replace(/^\/+/, "");
        if (!name) return;
        if (dialog.path.endsWith(".md") && !name.endsWith(".md")) name += ".md";
        const to = parent ? parent + "/" + name : name;
        if (to !== dialog.path && !canMoveInto(dialog.path, parent)) return;
        const data = await api("/api/workspace", {
          action: "move",
          path: dialog.path,
          to,
        });
        setEntries(data.tree);
        if (
          current.current &&
          (current.current.path === dialog.path ||
            current.current.path.startsWith(dialog.path + "/"))
        )
          apply(
            await api(
              "/api/workspace?path=" +
                encodeURIComponent(
                  to + current.current.path.slice(dialog.path.length),
                ),
            ),
          );
      } else {
        const data = await api("/api/workspace", {
          action: "trash",
          path: dialog.path,
        });
        setEntries(data.tree);
        setTrash(data.trash);
        if (
          current.current &&
          (current.current.path === dialog.path ||
            current.current.path.startsWith(dialog.path + "/"))
        ) {
          current.current = null;
          draft.current = "";
          setNote(null);
          setText("");
        }
      }
      setDialog(null);
      setMenu(null);
    });
  };
  const createWelcome = () =>
    run("创建中", async () => {
      await api("/api/workspace", {
        action: "create",
        path: "开始记录.md",
        type: "file",
      });
      const n = await api(
        "/api/workspace?path=" + encodeURIComponent("开始记录.md"),
      );
      apply(
        await api("/api/workspace", {
          action: "save",
          path: n.path,
          hash: n.hash,
          content: welcome,
        }),
      );
      await load();
    });
  const matches = (entry: Entry): boolean =>
    entry.name.toLowerCase().includes(query.toLowerCase()) ||
    (entry.children || []).some(matches);
  const menuEntry = menu ? findTreeEntry(entries, menu) : undefined;
  const renderTree = (list: Entry[], depth = 0): React.ReactNode =>
    list.filter(matches).map((entry) => (
      <div key={entry.path}>
        <div
          className={
            "tree-row " +
            (note?.path === entry.path ? "selected " : "") +
            (drop?.path === entry.path && drop.mode !== "into"
              ? drop.mode === "after"
                ? "drop-after"
                : "drop-before"
              : "") +
            (drop?.path === entry.path && drop.mode === "into"
              ? "drop-into"
              : "")
          }
          style={{
            paddingLeft:
              12 + depth * 24 + (entry.type === "file" && depth > 0 ? 24 : 0),
          }}
          draggable={!busy && !query}
          onDragStart={(e) => {
            dragPath.current = entry.path;
            e.dataTransfer.setData("text/plain", entry.path);
            e.dataTransfer.effectAllowed = "move";
            setMenu(null);
          }}
          onDragOver={(e) => {
            const source = dragPath.current;
            if (!source || source === entry.path) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientY - rect.top) / rect.height;
            if (
              entry.type === "folder" &&
              canDropInto(source, entry.path) &&
              ratio > 0.28 &&
              ratio < 0.72
            ) {
              setDrop({ path: entry.path, mode: "into" });
              return;
            }
            if (!canMoveInto(source, parentOf(entry.path))) {
              setDrop(null);
              return;
            }
            setDrop({
              path: entry.path,
              mode: ratio < 0.5 ? "before" : "after",
            });
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const source = dragPath.current;
            dragPath.current = null;
            setDrop(null);
            if (!source || source === entry.path) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientY - rect.top) / rect.height;
            if (
              entry.type === "folder" &&
              canDropInto(source, entry.path) &&
              ratio > 0.28 &&
              ratio < 0.72
            ) {
              moveInto(source, entry.path);
              return;
            }
            if (canMoveInto(source, parentOf(entry.path)))
              place(source, entry.path, ratio >= 0.5);
          }}
          onDragEnd={() => {
            dragPath.current = null;
            setDrop(null);
          }}
        >
          {!busy && !query && (
            <GripVertical
              size={12}
              className="drag-grip"
              aria-label="拖动排序或移动到文件夹"
            />
          )}
          <button
            className="tree-label"
            disabled={!!busy}
            onClick={() => {
              if (entry.type === "file") void open(entry.path);
              else
                setClosed((old) => {
                  const next = new Set(old);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                });
            }}
          >
            {entry.type === "folder" ? (
              <>
                <ChevronRight
                  size={13}
                  className={!closed.has(entry.path) ? "expanded" : ""}
                />
                <Folder size={16} />
              </>
            ) : (
              <FileText size={16} />
            )}
            <span>{entry.name.replace(/\.md$/, "")}</span>
          </button>
          <button
            className="tree-more"
            disabled={!!busy}
            aria-label={"管理 " + entry.name}
            aria-haspopup="menu"
            aria-expanded={menu === entry.path}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPoint({
                x: Math.min(rect.right + 6, window.innerWidth - 240),
                y: Math.max(
                  8,
                  Math.min(
                    rect.top,
                    window.innerHeight - (entry.type === "folder" ? 330 : 170),
                  ),
                ),
              });
              setMenu(menu === entry.path ? null : entry.path);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
        {entry.type === "folder" &&
          (!closed.has(entry.path) || query) &&
          renderTree(entry.children || [], depth + 1)}
      </div>
    ));
  const menuAction = (kind: Dialog["kind"]) => {
    if (!menuEntry) return;
    setDialog({
      kind,
      path: menuEntry.path,
      value: kind === "move" ? menuEntry.name : "",
    });
    setMenu(null);
  };
  const menuSort = (direction: number) => {
    if (!menuEntry) return;
    const parent = parentOf(menuEntry.path);
    const folders = childrenOf(entries, parent).filter(
      (entry) => entry.type === "folder",
    );
    const index = folders.findIndex((e) => e.path === menuEntry.path);
    const target = folders[index + direction];
    if (target) place(menuEntry.path, target.path, direction > 0);
    setMenu(null);
  };
  const exportNote = () => {
    if (!note) return;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = note.path.split("/").pop() || "笔记.md";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importFile = (file: File) =>
    run("导入中", async () => {
      await flush();
      if (!file.name.endsWith(".md")) throw new Error("请选择 .md 文件");
      if (file.size > 500_000) throw new Error("文件不能超过 500 KB");
      const content = await file.text();
      await api("/api/workspace", {
        action: "create",
        path: file.name,
        type: "file",
      });
      const n = await api(
        "/api/workspace?path=" + encodeURIComponent(file.name),
      );
      apply(
        await api("/api/workspace", {
          action: "save",
          path: n.path,
          content,
          hash: n.hash,
        }),
      );
      await load();
    });
  if (login)
    return (
      <div className="login">
        <div className="brand">
          <Feather /> 墨序
        </div>
        <h1>回到你的笔记空间</h1>
        <p>输入访问密码，继续记录。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("登录中", async () => {
              await api("/api/login", { password });
              setLogin(false);
              setError("");
              await load();
            });
          }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            aria-label="访问密码"
          />
          <button className="primary" disabled={!!busy}>
            进入笔记
          </button>
        </form>
        {error && <p className="danger">{error}</p>}
      </div>
    );
  return (
    <div className="workspace">
      {sidebar && (
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <Feather size={21} />
            </span>
            <span>
              墨序 <small>MOXU NOTES</small>
            </span>
            <button
              className="icon-button collapse"
              aria-label="收起侧栏"
              onClick={() => setSidebar(false)}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <div className="workspace-label">
            <span className="workspace-dot" /> 我的笔记空间{" "}
            <span className="personal">个人</span>
          </div>
          <div className="search">
            <Search size={15} />
            <input
              placeholder="搜索笔记…"
              aria-label="搜索笔记"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="tree-heading">
            <button
              className="library-switch"
              aria-haspopup="menu"
              aria-expanded={!!libraryMenu}
              title="切换笔记库（新建、改名在设置里）"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setLibraryMenu(
                  libraryMenu ? null : { x: rect.left, y: rect.bottom + 4 },
                );
              }}
            >
              <Library size={14} />
              <span>{libraries.active || "笔记库"}</span>
              <small>{count(entries)}</small>
              <ChevronDown size={13} className={libraryMenu ? "flipped" : ""} />
            </button>
            <div>
              <button
                aria-label="新建文件夹"
                title="新建文件夹"
                onClick={() =>
                  setDialog({ kind: "folder", path: "", value: "" })
                }
              >
                <FolderPlus size={16} />
              </button>
              <button
                aria-label="新建笔记"
                title="新建笔记"
                onClick={() => setDialog({ kind: "file", path: "", value: "" })}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <nav
            className={"file-tree" + (drop?.path === "" ? " drop-root" : "")}
            onScroll={() => setMenu(null)}
            onDragOver={(event) => {
              const source = dragPath.current;
              if (!source || !parentOf(source)) return;
              event.preventDefault();
              setDrop({ path: "", mode: "into" });
            }}
            onDrop={(event) => {
              event.preventDefault();
              const source = dragPath.current;
              dragPath.current = null;
              setDrop(null);
              if (source) moveInto(source, "");
            }}
          >
            {loading ? (
              <p className="tree-empty">正在打开笔记库…</p>
            ) : entries.length ? (
              renderTree(entries)
            ) : (
              <p className="tree-empty">你的想法，从第一篇笔记开始。</p>
            )}
            {query && entries.length > 0 && !entries.some(matches) && (
              <p className="tree-empty">没有找到匹配的笔记</p>
            )}
          </nav>
          <button
            className="import-button"
            disabled={!!busy}
            onClick={() => upload.current?.click()}
          >
            <Upload size={15} /> 导入 Markdown
          </button>
          <button
            className="trash-button"
            disabled={!!busy}
            aria-label="打开回收站"
            title="回收站：删掉的笔记还能找回来"
            onClick={() => void openTrash()}
          >
            <Trash2 size={15} /> 回收站
            {trash.length > 0 && (
              <span className="trash-count">{trash.length}</span>
            )}
          </button>
          <input
            ref={upload}
            type="file"
            accept=".md"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
          <button
            className="sidebar-bottom"
            aria-label="打开设置"
            title="设置"
            onClick={() => {
              setSettings(true);
              setNewLibrary("");
              setRenaming(null);
              setLibraryMenu(null);
            }}
          >
            <span className="avatar">我</span>
            <div>
              我的空间
              <small>{version} · 每一个想法，都值得留下</small>
            </div>
            <Settings size={15} className="online-dot" />
          </button>
        </aside>
      )}
      <main className={"main " + (mode === "graph" ? "graph-mode" : "")}>
        <header className="topbar">
          <div className="breadcrumb">
            {!sidebar && (
              <button
                className="icon-button"
                aria-label="展开侧栏"
                onClick={() => setSidebar(true)}
              >
                <PanelLeft size={18} />
              </button>
            )}
            <BookOpen size={16} />
            <span>笔记库</span>
            <ChevronRight size={13} />
            <span className="breadcrumb-current">
              {note?.path.replace(/\.md$/, "") || "欢迎"}
            </span>
          </div>
          <div className="top-right">
            <span className="save-status">
              {status === "已保存" ? (
                <Check size={13} />
              ) : (
                <Loader2 size={13} />
              )}{" "}
              {note ? status : "随时开始记录"}
            </span>
            <button
              className="icon-button"
              aria-label="导出 Markdown"
              title="导出 Markdown"
              disabled={!note}
              onClick={exportNote}
            >
              <Download size={17} />
            </button>
          </div>
        </header>
        <div className="viewbar">
          <div className="segmented">
            <button
              className={mode === "note" ? "active" : ""}
              onClick={() => setMode("note")}
            >
              <FileText size={16} /> 笔记
            </button>
            <button
              className={mode === "graph" ? "active" : ""}
              onClick={() => setMode("graph")}
            >
              <Network size={16} /> 关系图
            </button>
          </div>
          <div className="actions">
            {note?.canUndo && (
              <button
                className="quiet-button"
                disabled={!!busy}
                title="恢复上一次被 AI 改写前的正文"
                onClick={() =>
                  void run("恢复中", async () => {
                    await flush();
                    const n = current.current!;
                    apply(
                      await api("/api/workspace", {
                        action: "undo",
                        path: n.path,
                        hash: n.hash,
                      }),
                    );
                  })
                }
              >
                <Undo2 size={15} />
                <span>恢复原文</span>
              </button>
            )}
            <button
              className={"secondary" + (chatOpen ? " active" : "")}
              disabled={!note || !!busy}
              onClick={() => setChatOpen(!chatOpen)}
            >
              <MessageSquare size={15} /> 和 AI 聊天
            </button>
            {mode === "graph" && (
              <button
                className="secondary"
                disabled={!note?.graph || !!busy}
                onClick={() =>
                  setPanel(panel === "feedback" ? null : "feedback")
                }
              >
                <Pencil size={15} /> 评论改图
              </button>
            )}
            <button
              className="primary"
              disabled={!note || !!busy}
              onClick={() => void aiAction("graph")}
            >
              <Network size={15} /> 生成关系图 <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {!ai && (
          <div className="notice config">
            <Sparkles size={14} /> AI 尚未配置，设置服务器的 DeepSeek
            密钥后即可聊天和生成关系图。
          </div>
        )}
        {busy && (
          <div className="notice working">
            <Loader2 className="spin" size={14} />
            {busy}…
          </div>
        )}
        <div className="content-area">
          {!note ? (
            <div className="welcome">
              <div className="welcome-icon">
                <Feather size={34} />
              </div>
              <span className="eyebrow">A SPACE FOR YOUR THOUGHTS</span>
              <h1>
                写下想法，
                <br />
                让思路慢慢清晰。
              </h1>
              <p>
                从一句话开始，记录生活、灵感与发现。
                <br />
                让关系图连接你的思考，让文字留在你手里。
              </p>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  entries.length
                    ? setDialog({ kind: "file", path: "", value: "" })
                    : void createWelcome()
                }
              >
                <Plus size={17} />{" "}
                {entries.length ? "新建一篇笔记" : "开始第一篇笔记"}
              </button>
              <div className="welcome-features">
                <span>
                  <FileText size={16} /> Markdown 原文存储
                </span>
                <span>
                  <MessageSquare size={16} /> 和 AI 聊你的想法
                </span>
                <span>
                  <Network size={16} /> 看见观点之间的联系
                </span>
              </div>
            </div>
          ) : mode === "note" ? (
            <section className="editor-section">
              <div className="document-heading">
                <div className="eyebrow">MY NOTES / 我的记录</div>
                <h1>{note.path.split("/").pop()?.replace(/\.md$/, "")}</h1>
                <div className="document-meta">
                  <span>直接写，样式实时渲染；选中文字可以贴标签。</span>
                </div>
              </div>
              <div
                className="paper"
                onMouseUp={(event) =>
                  rememberSelection({ x: event.clientX, y: event.clientY })
                }
                onKeyUp={(event) => {
                  const key = event.key.toLowerCase();
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    (key === "c" || key === "x")
                  ) {
                    setTagAnchor(null);
                    return;
                  }
                  rememberSelection();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  setEditTable(null);
                  setTagAnchor(null);
                  setTagMenu(null);
                }}
                onClick={(event) => {
                  const target = event.target as Element;
                  const view = editorRef.current?.view;
                  const table =
                    target.closest<HTMLElement>("[data-table-from]");
                  if (table && view) {
                    const at = Number(table.dataset.tableFrom);
                    if (Number.isFinite(at)) {
                      setEditTable(at);
                      view.dispatch({ selection: { anchor: at } });
                      view.focus();
                    }
                    setTagAnchor(null);
                    setTagMenu(null);
                    return;
                  }
                  // 点在表格源码行以外的地方，就收起表格编辑、恢复渲染。
                  if (view) {
                    const line = view.state.doc.lineAt(
                      view.state.selection.main.head,
                    );
                    if (!/^\s*\|.*\|\s*$/.test(line.text)) setEditTable(null);
                  }
                  const tag = target.closest<HTMLElement>(
                    "[data-annotation-id]",
                  );
                  if (!tag || busyRef.current) return;
                  const item = note.annotations.find(
                    (annotation) => annotation.id === tag.dataset.annotationId,
                  );
                  if (!item) return;
                  setCustomLabel("");
                  setTagMenu({
                    quote: item.quote,
                    label: item.label,
                    id: item.id,
                    x: Math.min(event.clientX, window.innerWidth - 248),
                    y: Math.min(event.clientY + 8, window.innerHeight - 320),
                  });
                }}
              >
                <Editor
                  value={text}
                  ref={editorRef}
                  theme="none"
                  extensions={editorExtensions}
                  editable={!busy}
                  onChange={(value) => {
                    draft.current = value;
                    setText(value);
                    setStatus("待保存");
                  }}
                  placeholder="不必斟酌每个词，先把此刻的想法写下来…"
                  basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLine: false,
                    highlightActiveLineGutter: false,
                    syntaxHighlighting: false,
                  }}
                />
              </div>
              <footer className="editor-footer">
                <span>
                  Markdown <span className="tiny-dot" />{" "}
                  {text.replace(/\s/g, "").length.toLocaleString()} 字
                </span>
                <span>自动保存到笔记库</span>
              </footer>
            </section>
          ) : (
            <section className="graph-section">
              <div className="graph-top">
                <span className="graph-type">
                  {note.graph?.kind === "decision"
                    ? "决策依据图"
                    : note.graph?.kind === "flow"
                      ? "流程图"
                      : "关系图"}
                </span>
                <span className="graph-hint">
                  只读视图 · 滚轮缩放 · 拖动空白处平移
                </span>
              </div>
              {note.graph && note.graph.sourceHash !== note.hash && (
                <div className="notice stale">
                  正文已更新，重新生成可同步最新内容。
                </div>
              )}
              <div className="canvas">
                {note.graph ? (
                  <GraphView graph={note.graph} />
                ) : (
                  <div className="blank">
                    <span className="welcome-icon">
                      <Network size={32} />
                    </span>
                    <h2>让想法连接起来</h2>
                    <p>根据这篇笔记，提取观点与联系，生成你的思路地图。</p>
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => void aiAction("graph")}
                    >
                      <Sparkles size={15} /> 生成关系图
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
          {note && panel && (
            <Insights
              note={note}
              busy={!!busy}
              instruction={instruction}
              setInstruction={setInstruction}
              onClose={() => setPanel(null)}
              onRevise={() => void aiAction("revise")}
              onUndoGraph={() =>
                void run("恢复关系图", async () => {
                  await flush();
                  const n = current.current!;
                  apply(
                    await api("/api/workspace", {
                      action: "undoGraph",
                      path: n.path,
                      hash: n.hash,
                      graphHash: n.graphHash,
                    }),
                  );
                })
              }
            />
          )}
          {note && chatOpen && (
            <ChatPanel
              messages={note.chat}
              busy={!!busy}
              value={chatInput}
              onChange={setChatInput}
              onSend={() => void sendChat()}
              onClear={() => void clearChat()}
              onClose={() => setChatOpen(false)}
            />
          )}
        </div>
      </main>
      {tagAnchor &&
        createPortal(
          <button
            className="tag-anchor"
            style={{ left: tagAnchor.x, top: tagAnchor.y }}
            onClick={() => openTagMenu(tagAnchor)}
          >
            <Tag size={13} /> 贴标签
          </button>,
          document.body,
        )}
      {tagMenu &&
        createPortal(
          <div
            ref={tagMenuRef}
            className="tag-menu floating-menu"
            role="menu"
            aria-label="贴标签"
            style={{ left: tagMenu.x, top: tagMenu.y }}
          >
            <p className="tag-quote">{tagMenu.quote}</p>
            {tagMenu.label && (
              <p className="tag-current">
                当前标签：<span>{tagMenu.label}</span>
              </p>
            )}
            <form
              className="tag-custom"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTag(customLabel);
              }}
            >
              <input
                value={customLabel}
                maxLength={12}
                aria-label="自定义标签"
                autoFocus={!tagMenu.label}
                placeholder="写一个标签"
                onChange={(event) => setCustomLabel(event.target.value)}
              />
              <button
                className="primary"
                disabled={!customLabel.trim()}
                aria-label="使用自定义标签"
              >
                {tagMenu.id ? "换标签" : "贴上"}
              </button>
            </form>
            {tagMenu.id && (
              <>
                <div className="menu-divider" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => void dropTag(tagMenu.id!)}
                >
                  <Trash2 size={14} /> 去掉这个标签
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
      {menuEntry &&
        createPortal(
          <div
            ref={menuRef}
            className="file-menu floating-menu"
            role="menu"
            aria-label="文件操作"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          >
            {menuEntry.type === "folder" && (
              <>
                <button role="menuitem" onClick={() => menuAction("file")}>
                  <FileText size={16} /> 在此新建笔记
                </button>
                <button role="menuitem" onClick={() => menuAction("folder")}>
                  <FolderPlus size={16} /> 在此新建文件夹
                </button>
                <div className="menu-divider" />
                <button role="menuitem" onClick={() => menuSort(-1)}>
                  <ArrowUp size={16} /> 上移
                </button>
                <button role="menuitem" onClick={() => menuSort(1)}>
                  <ArrowDown size={16} /> 下移
                </button>
                <div className="menu-divider" />
              </>
            )}
            <button role="menuitem" onClick={() => menuAction("move")}>
              <Pencil size={16} /> 重命名
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => menuAction("trash")}
            >
              <Trash2 size={16} /> 移到回收站
            </button>
          </div>,
          document.body,
        )}
      {libraryMenu &&
        createPortal(
          <div
            className="library-menu floating-menu"
            role="menu"
            aria-label="切换笔记库"
            style={{ left: libraryMenu.x, top: libraryMenu.y }}
          >
            {libraries.names.map((name) => (
              <button
                key={name}
                role="menuitem"
                className={name === libraries.active ? "current" : ""}
                disabled={!!busy || name === libraries.active}
                onClick={() => void libraryAction("useLibrary", name)}
              >
                {name === libraries.active ? (
                  <Check size={14} />
                ) : (
                  <Library size={14} />
                )}
                <span>{name}</span>
              </button>
            ))}
            <div className="menu-divider" />
            <button
              role="menuitem"
              onClick={() => {
                setLibraryMenu(null);
                setSettings(true);
                setNewLibrary("");
                setRenaming(null);
              }}
            >
              <Settings size={15} /> 管理笔记库…
            </button>
          </div>,
          document.body,
        )}
      {settings && (
        <div className="modal-backdrop">
          <div className="modal settings-modal" role="dialog" aria-label="设置">
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="关闭"
              disabled={!!busy}
              onClick={() => {
                setSettings(false);
                setRenaming(null);
              }}
            >
              <X size={18} />
            </button>
            <h2>设置</h2>
            <p>
              笔记库是笔记目录下的一层真实文件夹：每一本都有自己的一份笔记、关系图和回收站，切换只是换一层目录，互不影响。
            </p>
            <h3 className="settings-title">笔记库</h3>
            <ul className="library-list">
              {libraries.names.map((name) => (
                <li
                  key={name}
                  className={
                    "library-row" +
                    (name === libraries.active ? " current" : "")
                  }
                >
                  {renaming?.name === name ? (
                    <form
                      className="library-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void libraryAction(
                          "renameLibrary",
                          name,
                          renaming.value,
                        );
                      }}
                    >
                      <input
                        autoFocus
                        value={renaming.value}
                        maxLength={40}
                        aria-label="新的笔记库名称"
                        onChange={(event) =>
                          setRenaming({ name, value: event.target.value })
                        }
                      />
                      <button
                        className="primary"
                        disabled={!!busy || !renaming.value.trim()}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={!!busy}
                        onClick={() => setRenaming(null)}
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="library-name"
                        disabled={!!busy}
                        onClick={() => void libraryAction("useLibrary", name)}
                      >
                        <Library size={15} />
                        <span>{name}</span>
                        {name === libraries.active && (
                          <em className="library-current">当前</em>
                        )}
                      </button>
                      <button
                        className="quiet-button"
                        disabled={!!busy}
                        onClick={() => setRenaming({ name, value: name })}
                      >
                        <Pencil size={13} /> 改名
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="library-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newLibrary.trim();
                if (!name) return;
                setNewLibrary("");
                void libraryAction("createLibrary", name);
              }}
            >
              <input
                value={newLibrary}
                maxLength={40}
                aria-label="新建笔记库"
                placeholder="新建笔记库，例如「工作」"
                onChange={(event) => setNewLibrary(event.target.value)}
              />
              <button
                className="primary"
                disabled={!!busy || !newLibrary.trim()}
              >
                新建
              </button>
            </form>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => {
                  setSettings(false);
                  setRenaming(null);
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {trashOpen && (
        <div className="modal-backdrop">
          <div className="modal trash-modal" role="dialog" aria-label="回收站">
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="关闭"
              disabled={!!busy}
              onClick={() => {
                setTrashOpen(false);
                setTrashConfirm(null);
              }}
            >
              <X size={18} />
            </button>
            <h2>回收站</h2>
            <p>
              删掉的笔记和文件夹都留在这里，可以放回原位。服务器不会自动清理，除非你在这里彻底删除。
            </p>
            {trash.length === 0 ? (
              <p className="trash-empty">回收站是空的。</p>
            ) : (
              <ul className="trash-list">
                {trash.map((item) => (
                  <li className="trash-item" key={item.id}>
                    {item.type === "folder" ? (
                      <Folder size={16} />
                    ) : (
                      <FileText size={16} />
                    )}
                    <span className="trash-name">
                      {item.name.replace(/\.md$/, "")}
                      <small>
                        {item.path === item.name ? "笔记库" : item.path} ·{" "}
                        {deletedLabel(item.deletedAt)}
                      </small>
                    </span>
                    {trashConfirm === item.id ? (
                      <>
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={!!busy}
                          onClick={() => setTrashConfirm(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={!!busy}
                          onClick={() => void trashAction("purge", item.id)}
                        >
                          彻底删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => void trashAction("restore", item.id)}
                        >
                          <RotateCcw size={14} /> 恢复
                        </button>
                        <button
                          type="button"
                          className="quiet-button danger"
                          disabled={!!busy}
                          onClick={() => setTrashConfirm(item.id)}
                        >
                          彻底删除
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              {trashConfirm === "*" ? (
                <>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!!busy}
                    onClick={() => setTrashConfirm(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!!busy}
                    onClick={() => void trashAction("emptyTrash", "")}
                  >
                    清空回收站
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!!busy}
                    onClick={() => {
                      setTrashOpen(false);
                      setTrashConfirm(null);
                    }}
                  >
                    关闭
                  </button>
                  {trash.length > 0 && (
                    <button
                      type="button"
                      className="quiet-button danger"
                      disabled={!!busy}
                      onClick={() => setTrashConfirm("*")}
                    >
                      清空回收站
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="关闭"
              disabled={!!busy}
              onClick={() => setDialog(null)}
            >
              <X size={18} />
            </button>
            <h2>
              {dialog.kind === "file"
                ? "新建笔记"
                : dialog.kind === "folder"
                  ? "新建文件夹"
                  : dialog.kind === "move"
                    ? "重命名"
                    : "移到回收站"}
            </h2>
            <p>
              {dialog.kind === "trash"
                ? `「${dialog.path}」将移入回收站，之后可以在侧栏「回收站」里恢复或彻底删除。`
                : dialog.kind === "move"
                  ? "只改名字；要换文件夹或调整顺序，直接拖动这一项。"
                  : `保存位置：${dialog.path || "笔记库"}`}
            </p>
            {dialog.kind !== "trash" && (
              <input
                autoFocus
                required
                aria-label="名称或路径"
                value={dialog.value}
                onChange={(e) =>
                  setDialog({ ...dialog, value: e.target.value })
                }
                placeholder={
                  dialog.kind === "file"
                    ? "笔记名称"
                    : dialog.kind === "move"
                      ? "新名称"
                      : "文件夹名称或路径"
                }
              />
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button className="primary" disabled={!!busy}>
                {dialog.kind === "trash" ? "移除" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
