import type { GraphNode, NodeGraph } from '../core/graph';

export const NODE_WIDTH = 150;
export const NODE_HEADER = 24;
export const PORT_ROW = 20;
export const PORT_RADIUS = 6;

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface NodeBox {
  readonly node: GraphNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly inputs: readonly { name: string; x: number; y: number }[];
  readonly output: { x: number; y: number } | null;
}

export type Hit =
  | { kind: 'node'; box: NodeBox }
  | { kind: 'input'; box: NodeBox; input: string }
  | { kind: 'output'; box: NodeBox }
  | { kind: 'empty' };

export function layoutNode(node: GraphNode, inputs: readonly string[], hasOutput: boolean, view: Viewport): NodeBox {
  const x = node.position[0] * view.zoom + view.x;
  const y = node.position[1] * view.zoom + view.y;
  const width = NODE_WIDTH * view.zoom;
  const height = (NODE_HEADER + Math.max(1, inputs.length) * PORT_ROW + 6) * view.zoom;
  return {
    node,
    x,
    y,
    width,
    height,
    inputs: inputs.map((name, i) => ({ name, x, y: y + (NODE_HEADER + PORT_ROW * (i + 0.5)) * view.zoom })),
    output: hasOutput ? { x: x + width, y: y + (NODE_HEADER + PORT_ROW * 0.5) * view.zoom } : null,
  };
}

export function hitTest(boxes: readonly NodeBox[], px: number, py: number, zoom: number): Hit {
  const reach = (PORT_RADIUS + 6) * Math.max(zoom, 0.6);
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (box.output && Math.hypot(px - box.output.x, py - box.output.y) <= reach) return { kind: 'output', box };
    for (const input of box.inputs) if (Math.hypot(px - input.x, py - input.y) <= reach) return { kind: 'input', box, input: input.name };
    if (px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height) return { kind: 'node', box };
  }
  return { kind: 'empty' };
}

export function fitView(graph: NodeGraph, width: number, height: number, margin = 40): Viewport {
  if (!graph.nodes.length) return { x: margin, y: margin, zoom: 1 };
  const xs = graph.nodes.map((n) => n.position[0]);
  const ys = graph.nodes.map((n) => n.position[1]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs) + NODE_WIDTH];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys) + NODE_HEADER + PORT_ROW * 3];
  const zoom = Math.min(1.2, Math.max(0.45, Math.min((width - margin * 2) / (maxX - minX), (height - margin * 2) / (maxY - minY))));
  return { x: margin - minX * zoom, y: margin - minY * zoom, zoom };
}
