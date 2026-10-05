import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import type { Annotation } from "@/lib/types";

type Deco = Range<Decoration>;
type Span = [number, number];

class AnnotationTag extends WidgetType {
  constructor(
    readonly label: string,
    readonly id: string,
  ) {
    super();
  }
  eq(other: AnnotationTag) {
    return this.label === other.label && this.id === other.id;
  }
  toDOM() {
    const tag = document.createElement("span");
    tag.className = "annotation-tag";
    tag.textContent = this.label;
    tag.dataset.annotationId = this.id;
    tag.title = "点一下可以去掉这个标签";
    return tag;
  }
}

class Bullet extends WidgetType {
  eq(other: Bullet) {
    return other instanceof Bullet;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}

function overlaps(spans: Span[], from: number, to: number) {
  return spans.some(([start, end]) => from < end && to > start);
}

function inline(
  text: string,
  base: number,
  out: Deco[],
  skip: Span[],
  replaced: Span[],
) {
  const hide = (from: number, to: number) => {
    if (from >= to) return;
    out.push(Decoration.replace({}).range(from, to));
    replaced.push([from, to]);
  };
  const code: Span[] = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const from = base + match.index;
    const to = from + match[0].length;
    code.push([from, to]);
    out.push(Decoration.mark({ class: "cm-inline-code" }).range(from, to));
    if (!overlaps(skip, from, to)) {
      hide(from, from + 1);
      hide(to - 1, to);
    }
  }
  const blocked = (from: number, to: number) =>
    overlaps(code, from, to) || overlaps(skip, from, to);
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const from = base + match.index;
    const to = from + match[0].length;
    if (blocked(from, to)) continue;
    const textFrom = from + 1;
    out.push(
      Decoration.mark({ class: "cm-link" }).range(
        textFrom,
        textFrom + match[1].length,
      ),
    );
    hide(from, textFrom);
    hide(textFrom + match[1].length, to);
  }
  for (const match of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    const from = base + match.index;
    const to = from + match[0].length;
    if (blocked(from, to)) continue;
    const textFrom = from + 2;
    out.push(
      Decoration.mark({ class: "cm-strong" }).range(
        textFrom,
        textFrom + match[1].length,
      ),
    );
    hide(from, textFrom);
    hide(textFrom + match[1].length, to);
  }
  for (const match of text.matchAll(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g)) {
    const from = base + match.index;
    const to = from + match[0].length;
    if (blocked(from, to)) continue;
    const textFrom = from + 1;
    out.push(
      Decoration.mark({ class: "cm-em" }).range(
        textFrom,
        textFrom + match[1].length,
      ),
    );
    hide(from, textFrom);
    hide(textFrom + match[1].length, to);
  }
}

function annotationSpans(content: string, annotations: Annotation[]) {
  let last = -1;
  return annotations
    .map((annotation) => {
      const from = content.indexOf(annotation.quote);
      return { annotation, from, to: from + annotation.quote.length };
    })
    .filter((item) => item.from >= 0)
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .filter((item) => {
      if (item.from < last) return false;
      last = item.to;
      return true;
    });
}

function build(state: EditorState, annotations: Annotation[]) {
  const doc = state.doc;
  const content = doc.toString();
  const out: Deco[] = [];
  const replaced: Span[] = [];
  const hide = (from: number, to: number) => {
    if (from >= to) return;
    out.push(Decoration.replace({}).range(from, to));
    replaced.push([from, to]);
  };
  const active = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let line = first; line <= last; line++) active.add(line);
  }
  const marked = annotationSpans(content, annotations);
  const skip: Span[] = marked.map((item) => [item.from, item.to]);
  let fenced = false;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;
    const raw = active.has(number);
    if (/^\s*(```|~~~)/.test(text)) {
      out.push(
        Decoration.line({ class: "cm-code-block" }).range(line.from),
      );
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(
        Decoration.line({ class: "cm-code-block" }).range(line.from),
      );
      continue;
    }
    const heading = /^(#{1,6})\s+/.exec(text);
    if (heading) {
      out.push(
        Decoration.line({
          class: `cm-heading cm-h${heading[1].length}`,
        }).range(line.from),
      );
      if (!raw) hide(line.from, line.from + heading[0].length);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      out.push(Decoration.line({ class: "cm-rule" }).range(line.from));
      continue;
    }
    const quote = /^>\s?/.exec(text);
    if (quote) {
      out.push(Decoration.line({ class: "cm-quote" }).range(line.from));
      if (!raw) hide(line.from, line.from + quote[0].length);
      inline(
        text.slice(quote[0].length),
        line.from + quote[0].length,
        out,
        [],
        replaced,
      );
      continue;
    }
    const bullet = /^(\s*)([-*+])\s+/.exec(text);
    const ordered = /^(\s*)\d+[.)]\s+/.exec(text);
    if (bullet) {
      const from = line.from + bullet[1].length;
      out.push(Decoration.line({ class: "cm-list" }).range(line.from));
      if (!raw) {
        out.push(
          Decoration.replace({ widget: new Bullet() }).range(from, from + 1),
        );
        replaced.push([from, from + 1]);
      }
      inline(text.slice(from + 2), from + 2, out, [], replaced);
      continue;
    }
    if (ordered) {
      out.push(Decoration.line({ class: "cm-list" }).range(line.from));
      continue;
    }
    inline(text, line.from, out, [], replaced);
  }
  for (const item of marked) {
    if (overlaps(replaced, item.from, item.to)) continue;
    out.push(
      Decoration.mark({ class: "cm-annotation" }).range(item.from, item.to),
    );
    out.push(
      Decoration.widget({
        widget: new AnnotationTag(item.annotation.label, item.annotation.id),
        side: 1,
      }).range(item.to),
    );
  }
  return Decoration.set(out, true);
}

export function livePreview(annotations: Annotation[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view.state, annotations);
      }
      update(update: ViewUpdate) {
        this.decorations = build(update.state, annotations);
      }
    },
    { decorations: (value) => value.decorations },
  );
}
