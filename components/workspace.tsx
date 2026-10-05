"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import Insights from "./insights";
import ChatPanel from "./chat-panel";
import { livePreview } from "./live-preview";
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
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import type { Entry, Note } from "@/lib/types";
import pkg from "../package.json";
const Editor = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
const GraphView = dynamic(() => import("./graph-view"), { ssr: false });
const version = "V" + pkg.version;
const welcome =
  "# 给想法一个安放的地方\n\n不必一开始就写得很好。先记录，思路会在书写中慢慢清晰。\n\n## 我想记录什么\n\n- 今天发生的事情，以及我的感受\n- 一个还不成熟，但值得留下的想法\n- 工作和学习中的发现\n\n## 从记录到理解\n\n写完后，点击「AI 润色」，让语言更顺畅，同时保留自己的意思。\n\n点击「生成关系图」，把笔记里的观点、原因与结论连起来。\n\n> 文字留下细节，关系图帮助我看见全貌。\n";
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
function count(entries: Entry[]): number {
  return entries.reduce(
    (n, e) => n + (e.type === "file" ? 1 : count(e.children || [])),
    0,
  );
}
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
  const [tagMenu, setTagMenu] = useState<TagMenu | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [drop, setDrop] = useState<{ path: string; after: boolean } | null>(
    null,
  );
  const annotations = note?.annotations;
  const editorExtensions = useMemo(
    () => [markdown(), EditorView.lineWrapping, livePreview(annotations ?? [])],
    [annotations],
  );
  const dragPath = useRef<string | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".file-menu,.tree-more"))
        setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (!tagMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".tag-menu")) setTagMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [tagMenu]);
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
    setChatInput("");
    if (window.innerWidth < 640) setSidebar(false);
  };
  const load = useCallback(async () => {
    try {
      const data = await api("/api/workspace");
      setEntries(data.tree);
      setAi(data.aiConfigured);
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
  const aiAction = (action: "polish" | "graph" | "revise") =>
    run(
      {
        polish: "正在整理文字与排版",
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
        if (action === "polish") setStatus("已润色并保存");
        if (action === "graph" || action === "revise") setMode("graph");
        if (action === "revise") setInstruction("");
      },
    );
  const openTagMenu = (point?: { x: number; y: number }) => {
    const view = editorRef.current?.view;
    const range = view?.state.selection.main;
    if (!view || !range || range.empty) {
      setTagMenu(null);
      return;
    }
    const quote = view.state.sliceDoc(range.from, range.to).trim();
    if (!quote || quote.length > 300) {
      setTagMenu(null);
      return;
    }
    const at = view.coordsAtPos(range.to);
    const width = 236;
    const height = 320;
    const x = Math.min(
      point?.x ?? at?.left ?? 40,
      window.innerWidth - width - 12,
    );
    const y = Math.min(
      (point?.y ?? at?.bottom ?? 80) + 8,
      Math.max(12, window.innerHeight - height),
    );
    setCustomLabel("");
    setTagMenu({ quote, x: Math.max(12, x), y });
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
      apply(
        await api("/api/workspace", {
          action: "chat",
          path: latest.path,
          hash: latest.hash,
          message,
        }),
      );
      setChatInput("");
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
  const reorder = (source: string, target: string, after: boolean) => {
    const parent = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/"))
      : "";
    const targetParent = target.includes("/")
      ? target.slice(0, target.lastIndexOf("/"))
      : "";
    if (source === target || parent !== targetParent) return;
    const find = (list: Entry[]): Entry | undefined => {
      for (const e of list) {
        if (e.path === parent) return e;
        const match = find(e.children || []);
        if (match) return match;
      }
    };
    const siblings = (parent ? find(entries)?.children : entries) || [];
    const ordered = siblings
      .filter((e) => e.type === "folder")
      .map((e) => e.path)
      .filter((p) => p !== source);
    const index = ordered.indexOf(target);
    if (index < 0) return;
    ordered.splice(index + (after ? 1 : 0), 0, source);
    void run("保存文件夹顺序", async () => {
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
        const data = await api("/api/workspace", {
          action: "move",
          path: dialog.path,
          to: path,
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
                  path + current.current.path.slice(dialog.path.length),
                ),
            ),
          );
      } else {
        const data = await api("/api/workspace", {
          action: "trash",
          path: dialog.path,
        });
        setEntries(data.tree);
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
  const findEntry = (list: Entry[], path: string): Entry | undefined => {
    for (const e of list) {
      if (e.path === path) return e;
      const nested = findEntry(e.children || [], path);
      if (nested) return nested;
    }
  };
  const menuEntry = menu ? findEntry(entries, menu) : undefined;
  const renderTree = (list: Entry[], depth = 0): React.ReactNode =>
    list.filter(matches).map((entry) => (
      <div key={entry.path}>
        <div
          className={
            "tree-row " +
            (note?.path === entry.path ? "selected " : "") +
            (drop?.path === entry.path
              ? drop.after
                ? "drop-after"
                : "drop-before"
              : "")
          }
          style={{
            paddingLeft:
              12 + depth * 24 + (entry.type === "file" && depth > 0 ? 24 : 0),
          }}
          draggable={entry.type === "folder" && !busy && !query}
          onDragStart={(e) => {
            dragPath.current = entry.path;
            e.dataTransfer.setData("text/plain", entry.path);
            e.dataTransfer.effectAllowed = "move";
            setMenu(null);
          }}
          onDragOver={(e) => {
            const source = dragPath.current;
            if (
              !source ||
              source === entry.path ||
              entry.type !== "folder" ||
              source.split("/").slice(0, -1).join("/") !==
                entry.path.split("/").slice(0, -1).join("/")
            )
              return;
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setDrop({
              path: entry.path,
              after: e.clientY > rect.top + rect.height / 2,
            });
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragPath.current && drop?.path === entry.path)
              reorder(dragPath.current, entry.path, drop.after);
            dragPath.current = null;
            setDrop(null);
          }}
          onDragEnd={() => {
            dragPath.current = null;
            setDrop(null);
          }}
        >
          {entry.type === "folder" && (
            <GripVertical
              size={12}
              className="drag-grip"
              aria-label="拖动文件夹排序"
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
      value: kind === "move" ? menuEntry.path : "",
    });
    setMenu(null);
  };
  const menuSort = (direction: number) => {
    if (!menuEntry) return;
    const parent = menuEntry.path.split("/").slice(0, -1).join("/");
    const siblings =
      (parent ? findEntry(entries, parent)?.children : entries) || [];
    const folders = siblings.filter((e) => e.type === "folder");
    const index = folders.findIndex((e) => e.path === menuEntry.path);
    const target = folders[index + direction];
    if (target) reorder(menuEntry.path, target.path, direction > 0);
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
            <span>
              笔记库 <small>{count(entries)}</small>
            </span>
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
          <nav className="file-tree" onScroll={() => setMenu(null)}>
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
          <div className="sidebar-bottom">
            <span className="avatar">我</span>
            <div>
              我的空间
              <small>
                {version} · 每一个想法，都值得留下
              </small>
            </div>
            <span className="online-dot" />
          </div>
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
                title="恢复上次 AI 润色前的正文"
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
              className="secondary"
              disabled={!note || !!busy}
              onClick={() => void aiAction("polish")}
            >
              <Sparkles size={15} /> AI 润色
            </button>
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
            密钥后即可润色和生成关系图。
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
                <br />让 AI 整理语言，让关系图连接你的思考。
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
                  <Sparkles size={16} /> 保留你的表达
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
                  openTagMenu({ x: event.clientX, y: event.clientY })
                }
                onKeyUp={() => openTagMenu()}
                onClick={(event) => {
                  const tag = (event.target as Element).closest<HTMLElement>(
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
                  theme="dark"
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
              <Pencil size={16} /> 重命名 / 移动
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => menuAction("trash")}
            >
              <Trash2 size={16} /> 移到回收目录
            </button>
          </div>,
          document.body,
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
                    ? "重命名或移动"
                    : "移到回收目录"}
            </h2>
            <p>
              {dialog.kind === "trash"
                ? `「${dialog.path}」将从笔记库移除，原文件会保留在服务器回收目录。`
                : dialog.kind === "move"
                  ? "填写完整路径，例如：学习/阅读记录.md。目标文件夹需要已存在。"
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
                  dialog.kind === "file" ? "笔记名称" : "文件夹名称或路径"
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
