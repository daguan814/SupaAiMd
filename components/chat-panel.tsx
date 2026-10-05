"use client";
import { useEffect, useRef } from "react";
import { MessageSquare, Send, Trash2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

const suggestions = [
  "这篇笔记主要想说什么？",
  "逻辑有没有跳跃或没说清的地方？",
  "帮我起三个更准确的标题",
];

export default function ChatPanel({
  messages,
  busy,
  value,
  onChange,
  onSend,
  onClear,
  onClose,
}: {
  messages: ChatMessage[];
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);
  return (
    <aside className="chat-panel">
      <header>
        <div>
          <MessageSquare size={16} />
          <strong>和 AI 聊这篇笔记</strong>
        </div>
        <div className="chat-head-actions">
          {messages.length > 0 && (
            <button
              className="icon-button"
              title="清空对话"
              aria-label="清空对话"
              disabled={busy}
              onClick={onClear}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            className="icon-button"
            title="关闭对话"
            aria-label="关闭对话"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="chat-body">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>
              AI 已经读过这篇笔记的正文，可以直接问它任何与这篇内容有关的问题。
            </p>
            {suggestions.map((text) => (
              <button key={text} onClick={() => onChange(text)}>
                {text}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <span>{message.role === "user" ? "我" : "AI"}</span>
              <p>{message.content}</p>
            </article>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <textarea
          value={value}
          maxLength={2000}
          aria-label="对 AI 说"
          placeholder="问点什么，比如「第二段的结论是不是下太快了？」"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button
          className="primary full"
          disabled={busy || !value.trim()}
        >
          <Send size={14} /> 发送给 AI
        </button>
      </form>
    </aside>
  );
}
