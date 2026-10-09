"use client";
import { useEffect, useRef } from "react";
import { MessageSquare, Send, Trash2, X } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { shouldSendOnEnter } from "@/lib/chat";

const suggestions = [
  "这篇笔记主要想说什么？",
  "把这段按时间顺序重排",
  "把啰嗦的句子改短一点",
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
              AI 已经读过这篇笔记的正文。可以问它问题，也可以直接让它改——
              说清楚要改什么，它就动手，改前的版本可以「恢复原文」退回。
            </p>
            {suggestions.map((text) => (
              <button key={text} onClick={() => onChange(text)}>
                {text}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`chat-message ${message.role}`}
              key={message.id}
            >
              <span>
                {message.role === "user" ? "我" : "AI"}
                {message.kind === "edit" && (
                  <em className="chat-badge">改正文</em>
                )}
              </span>
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
          placeholder="问点什么，或者直接说怎么改，例如「把表格按金额从大到小排」"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              !shouldSendOnEnter({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode,
              })
            )
              return;
            event.preventDefault();
            onSend();
          }}
        />
        <button className="primary full" disabled={busy || !value.trim()}>
          <Send size={14} /> 发送给 AI
        </button>
        <span className="chat-hint">回车发送，Shift + 回车换行</span>
      </form>
    </aside>
  );
}
