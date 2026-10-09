export type Entry = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: Entry[];
};
/** 回收站里的一项；path 是删除前的相对路径，用来放回原位。 */
export type TrashEntry = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  deletedAt: string;
};
export type GraphRole =
  | "material"
  | "reasoning"
  | "decision"
  | "step"
  | "condition"
  | "outcome"
  | "concept";
export type Graph = {
  kind?: "decision" | "flow" | "concept";
  rationale?: string;
  nodes: {
    id: string;
    title: string;
    content: string;
    role?: GraphRole;
    excerpt?: string;
  }[];
  edges: { source: string; target: string; label?: string }[];
  sourceHash: string;
};
export type Annotation = {
  id: string;
  quote: string;
  label: string;
  createdAt: string;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 旧版聊天会按作者要求改写正文，这类往返标了 edit；现在聊天只讨论，不再产生这种消息。 */
  kind?: "edit";
  createdAt: string;
};
export type GraphFeedback = {
  id: string;
  instruction: string;
  createdAt: string;
  sourceHash: string;
};
export type Note = {
  path: string;
  content: string;
  hash: string;
  graph: Graph | null;
  graphHash: string;
  canUndo: boolean;
  annotations: Annotation[];
  annotationsHash: string;
  chat: ChatMessage[];
  feedback: GraphFeedback[];
  canUndoGraph: boolean;
};
