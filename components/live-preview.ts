import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import type { Annotation } from "@/lib/types";

type Deco = Range<Decoration>;
type Span = [number, number];
type Align = "left" | "center" | "right" | null;

const splitRow = (line: string) => {
  const text = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index++;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
};

const isDivider = (cells: string[]) =>
  cells.length > 0 &&
  cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s/g, "")));

const alignOf = (cell: string): Align => {
  const value = cell.replace(/\s/g, "");
  if (/^:-+:$/.test(value)) return "center";
  if (/^:-+$/.test(value)) return "left";
  if (/^-+:$/.test(value)) return "right";
  return null;
};

function fillCell(target: HTMLElement, text: string) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > cursor) target.append(text.slice(cursor, at));
    if (token.startsWith("**")) {
      const bold = document.createElement("strong");
      bold.textContent = token.slice(2, -2);
      target.append(bold);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      target.append(code);
    } else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) || [];
      const link = document.createElement("a");
      link.textContent = label ?? token;
      if (href) {
        link.href = href;
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      target.append(link);
    } else {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      target.append(em);
    }
    cursor = at + token.length;
  }
  if (cursor < text.length) target.append(text.slice(cursor));
}

class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly align: Align[],
    readonly from: number,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return (
      this.from === other.from &&
      JSON.stringify(other.rows) === JSON.stringify(this.rows)
    );
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";
    wrap.dataset.tableFrom = String(this.from);
    wrap.title = "点一下可以编辑表格源码";
    const table = document.createElement("table");
    table.className = "cm-table";
    // GFM：列数以表头为准，多出来的单元格忽略，缺的补空。
    const width = this.rows[0].length;
    const cell = (tag: "th" | "td", text: string, column: number) => {
      const node = document.createElement(tag);
      const align = this.align[column];
      if (align) node.style.textAlign = align;
      fillCell(node, text ?? "");
      return node;
    };
    const [header, , ...body] = this.rows;
    const head = table.createTHead().insertRow();
    for (let column = 0; column < width; column++)
      head.append(cell("th", header[column] ?? "", column));
    const tbody = table.createTBody();
    for (const row of body) {
      const tr = tbody.insertRow();
      for (let column = 0; column < width; column++)
        tr.append(cell("td", row[column] ?? "", column));
    }
    wrap.append(table);
    return wrap;
  }
}

/** 关掉编辑器自带主题，样式由 app/globals.css 里的 .cm-* 规则统一决定。 */
export const editorTheme = EditorView.theme(
  {
    "&": { color: "#dfe3ed", backgroundColor: "transparent" },
    ".cm-content": { caretColor: "#c8cfe0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#c8cfe0" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#3d4661",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
  },
  { dark: true },
);

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
  for (const match of text.matchAll(
    /(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g,
  )) {
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

export function buildDecorations(
  state: EditorState,
  annotations: Annotation[],
  editing: number | null = null,
) {
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
  const tables = new Map<number, { end: number; rows: string[][] }>();
  const aligns = new Map<number, Align[]>();
  for (let number = 1; number <= doc.lines; number++) {
    const text = doc.line(number).text;
    if (!/^\s*\|.*\|\s*$/.test(text)) continue;
    const next = doc.line(number + 1);
    if (!next || !/^\s*\|.*\|\s*$/.test(next.text)) continue;
    const header = splitRow(text);
    const divider = splitRow(next.text);
    if (header.length !== divider.length || !isDivider(divider)) continue;
    let end = number + 1;
    while (end < doc.lines && /^\s*\|.*\|\s*$/.test(doc.line(end + 1).text))
      end++;
    const rows = [header];
    for (let row = number + 1; row <= end; row++) {
      const cells = splitRow(doc.line(row).text);
      while (cells.length < header.length) cells.push("");
      rows.push(cells);
    }
    tables.set(number, { end, rows });
    aligns.set(number, divider.map(alignOf));
    number = end;
  }
  let fenced = false;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;
    const raw = active.has(number);
    const table = tables.get(number);
    if (table) {
      const last = doc.line(table.end);
      // 表格里贴了标签时始终显示源码，避免标签被藏起来；
      // 光标在表格里也保持渲染，只有点过表格才显示源码方便编辑。
      const opened =
        editing !== null && editing >= line.from && editing <= last.to;
      let inside = false;
      for (let row = number; row <= table.end; row++)
        if (active.has(row)) inside = true;
      const tagged = marked.some(
        (item) => item.from < last.to && item.to > line.from,
      );
      const live = tagged || (opened && inside);
      if (!live) {
        out.push(
          Decoration.replace({
            widget: new TableWidget(
              table.rows,
              aligns.get(number) ?? [],
              line.from,
            ),
            block: true,
          }).range(line.from, last.to),
        );
        replaced.push([line.from, last.to]);
        number = table.end;
        continue;
      }
      for (let row = number; row <= table.end; row++) {
        const source = doc.line(row);
        out.push(
          Decoration.line({ class: "cm-table-source" }).range(source.from),
        );
        inline(source.text, source.from, out, [], replaced);
      }
      number = table.end;
      continue;
    }
    if (/^\s*(```|~~~)/.test(text)) {
      out.push(Decoration.line({ class: "cm-code-block" }).range(line.from));
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(Decoration.line({ class: "cm-code-block" }).range(line.from));
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

export function livePreview(annotations: Annotation[], editing: number | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state, annotations, editing);
      }
      update(update: ViewUpdate) {
        this.decorations = buildDecorations(update.state, annotations, editing);
      }
    },
    { decorations: (value) => value.decorations },
  );
}
