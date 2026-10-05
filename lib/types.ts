export type Entry = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: Entry[];
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
  /** edit 表示这条消息是「让 AI 直接改正文」的往返。 */
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
