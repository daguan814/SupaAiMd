import ELK from "elkjs/lib/elk.bundled.js";
import type { Graph, GraphRole } from "./types";
export const roleLabels: Record<GraphRole, string> = {
  material: "材料 / 观察",
  reasoning: "推理 / 权衡",
  decision: "决策 / 选择",
  step: "步骤",
  condition: "条件判断",
  outcome: "结果",
  concept: "概念",
};
export function cardHeight(n: Graph["nodes"][number]) {
  return (
    80 +
    Math.ceil(n.title.length / 15) * 26 +
    Math.max(1, Math.ceil(n.content.length / 19)) * 22
  );
}
export async function layoutGraph(graph: Graph) {
  if (graph.kind === "decision") {
    const lane = (role?: GraphRole) =>
      role === "material"
        ? 0
        : role === "decision" || role === "condition" || role === "outcome"
          ? 2
          : 1;
    const groups = [0, 1, 2].map((i) =>
      graph.nodes.filter((n) => lane(n.role) === i),
    );
    for (let i = 1; i < 3; i++) {
      const rank = new Map(groups[i - 1].map((n, j) => [n.id, j]));
      const score = (id: string) => {
        const sources = graph.edges
          .filter((e) => e.target === id)
          .map((e) => rank.get(e.source))
          .filter((r): r is number => r !== undefined);
        return sources.length
          ? sources.reduce((a, b) => a + b, 0) / sources.length
          : 999;
      };
      groups[i].sort((a, b) => score(a.id) - score(b.id));
    }
    const totals = groups.map(
      (g) => g.reduce((sum, n) => sum + cardHeight(n) + 28, 0) - 28,
    );
    const max = Math.max(...totals);
    return groups.flatMap((group, i) => {
      let y = (max - totals[i]) / 2;
      return group.map((n) => {
        const item = { id: n.id, x: i * 390, y, height: cardHeight(n) };
        y += item.height + 28;
        return item;
      });
    });
  }
  // Remove only DFS back edges during layout so retry loops do not reverse the main sequence.
  const backEdges = new Set<number>();
  if (graph.kind === "flow") {
    const visited = new Set<string>();
    const active = new Set<string>();
    const walk = (id: string) => {
      visited.add(id);
      active.add(id);
      graph.edges.forEach((e, i) => {
        if (e.source !== id) return;
        if (active.has(e.target)) backEdges.add(i);
        else if (!visited.has(e.target)) walk(e.target);
      });
      active.delete(id);
    };
    graph.nodes
      .filter((n) => !graph.edges.some((e) => e.target === n.id))
      .forEach((n) => walk(n.id));
    graph.nodes.forEach((n) => {
      if (!visited.has(n.id)) walk(n.id);
    });
  }
  const result = await new ELK().layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": graph.kind === "flow" ? "DOWN" : "RIGHT",
      "elk.spacing.nodeNode": "38",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
    },
    children: graph.nodes.map((n) => ({
      id: n.id,
      width: 280,
      height: cardHeight(n),
    })),
    edges: graph.edges
      .filter((_, i) => !backEdges.has(i))
      .map((e, i) => ({
        id: "edge" + i,
        sources: [e.source],
        targets: [e.target],
      })),
  });
  return graph.nodes.map((n) => ({
    id: n.id,
    x: result.children?.find((c) => c.id === n.id)?.x || 0,
    y: result.children?.find((c) => c.id === n.id)?.y || 0,
    height: cardHeight(n),
  }));
}
