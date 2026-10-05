"use client";
import { MessageSquare, X, Send, Undo2 } from "lucide-react";
import type { Note } from "@/lib/types";

export default function Insights({
  note,
  busy,
  instruction,
  setInstruction,
  onClose,
  onRevise,
  onUndoGraph,
}: {
  note: Note;
  busy: boolean;
  instruction: string;
  setInstruction: (value: string) => void;
  onClose: () => void;
  onRevise: () => void;
  onUndoGraph: () => void;
}) {
  return (
    <aside className="insights">
      <header>
        <div>
          <MessageSquare size={16} />
          <strong>评论改图</strong>
        </div>
        <button
          className="icon-button"
          aria-label="关闭评论面板"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="insights-body">
        {note.graph?.rationale && (
          <div className="graph-rationale">
            <span>AI 的制图选择</span>
            <p>{note.graph.rationale}</p>
          </div>
        )}
        {note.graph && note.graph.sourceHash !== note.hash && (
          <div className="notice stale">
            正文已更新，修改图时会读取最新正文。
          </div>
        )}
        <textarea
          aria-label="关系图修改意见"
          placeholder="例如：把成本和时间作为左侧材料，中间展示我的权衡，右侧突出最终选择；不要把我的猜测写成事实。"
          value={instruction}
          maxLength={3000}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={busy}
        />
        <button
          className="primary full"
          disabled={busy || !note.graph || !instruction.trim()}
          onClick={onRevise}
        >
          <Send size={14} /> 按评论修改图
        </button>
        {note.canUndoGraph && (
          <button
            className="quiet-button full"
            disabled={busy}
            onClick={onUndoGraph}
          >
            <Undo2 size={14} /> 恢复上一版图
          </button>
        )}
        <div className="feedback-heading">
          修改记录 <span>{note.feedback.length}</span>
        </div>
        {[...note.feedback].reverse().map((f) => (
          <article className="feedback-card" key={f.id}>
            <div>
              <MessageSquare size={13} />
              <time>{new Date(f.createdAt).toLocaleString("zh-CN")}</time>
            </div>
            <p>{f.instruction}</p>
            {f.sourceHash !== note.hash && <small>对应较早的正文版本</small>}
          </article>
        ))}
        {!note.feedback.length && (
          <p className="empty-insight">你的修改意见会保存在这里。</p>
        )}
      </div>
    </aside>
  );
}
