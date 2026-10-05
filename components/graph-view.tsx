"use client";
import { useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutGraph, roleLabels } from "@/lib/graph-layout";
import type { Graph, GraphRole } from "@/lib/types";
function Card({
  data,
}: {
  data: {
    title: string;
    content: string;
    role?: GraphRole;
    excerpt?: string;
    height: number;
    vertical: boolean;
  };
}) {
  return (
    <div
      className={"graph-card role-" + (data.role || "concept")}
      style={{ height: data.height }}
      title={data.excerpt ? "正文依据：" + data.excerpt : undefined}
    >
      <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
      />
      <div className="card-eyebrow">{roleLabels[data.role || "concept"]}</div>
      <strong>{data.title}</strong>
      <p>{data.content}</p>
      <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
      />
    </div>
  );
}
function Lane({ data }: { data: { title: string; subtitle: string } }) {
  return (
    <div className="lane-label">
      <strong>{data.title}</strong>
      <span>{data.subtitle}</span>
    </div>
  );
}
const nodeTypes = { card: Card, lane: Lane };
export default function GraphView({ graph }: { graph: Graph }) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] } | null>(
    null,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setLayout(null);
    setError(false);
    layoutGraph(graph)
      .then((positions) => {
        if (!active) return;
        const vertical = graph.kind === "flow";
        const nodes: Node[] = graph.nodes.map((n) => {
          const p = positions.find((p) => p.id === n.id)!;
          return {
            id: n.id,
            type: "card",
            data: { ...n, height: p.height, vertical },
            position: { x: p.x, y: p.y },
            width: 280,
            height: p.height,
          };
        });
        if (graph.kind === "decision")
          ["材料", "推理过程", "决策"].forEach((title, i) =>
            nodes.push({
              id: "__lane_" + i,
              type: "lane",
              data: {
                title,
                subtitle: ["我掌握了什么", "我如何权衡", "我为什么这样选择"][i],
              },
              position: { x: i * 390, y: -64 },
              width: 280,
              height: 42,
            }),
          );
        setLayout({
          nodes,
          edges: graph.edges.map((e, i) => ({
            ...e,
            id: "e" + i,
            type: graph.kind === "decision" ? "default" : "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#727987" },
            style: { stroke: "#727987", strokeWidth: 1.5 },
            labelStyle: { fill: "#b0b7c4", fontSize: 11 },
            labelBgStyle: { fill: "#191b20" },
            labelBgPadding: [6, 4] as [number, number],
          })),
        });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [graph]);
  if (error)
    return <div className="blank">关系图布局失败，请重新打开笔记后重试。</div>;
  if (!layout) return <div className="blank">正在整理卡片布局…</div>;
  return (
    <div className="graph-view" ref={host}>
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        fitView={graph.kind !== "flow"}
        onInit={(instance) => {
          if (graph.kind !== "flow") return;
          const width = host.current?.clientWidth || 700;
          const minX = Math.min(...layout.nodes.map((n) => n.position.x));
          const maxX = Math.max(...layout.nodes.map((n) => n.position.x + 280));
          const zoom = Math.min(0.85, (width - 40) / (maxX - minX));
          const start =
            layout.nodes.find(
              (n) => !graph.edges.some((e) => e.target === n.id),
            ) || layout.nodes[0];
          void instance.setViewport({
            x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
            y: 30 - start.position.y * zoom,
            zoom,
          });
        }}
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={2}
        colorMode="dark"
      >
        <Background color="#343740" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
