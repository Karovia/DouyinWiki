import { useRef, useEffect, useState, useCallback } from 'react';
import NodeTooltip from './NodeTooltip';

interface GraphNode {
  id: string;
  label: string;
  nodeType: string;
  x: number;
  y: number;
}

interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  weight: number;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerNodeId: string;
  onNodeClick: (nodeId: string, nodeType: string) => void;
}

const NODE_COLORS: Record<string, string> = {
  video: '#3b82f6',
  entity: '#10b981',
  author: '#f59e0b',
};

const NODE_SIZES: Record<string, number> = {
  video: 20,
  entity: 14,
  author: 16,
};

export default function GraphCanvas({ nodes, edges, centerNodeId, onNodeClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; nodeType: string } | null>(null);

  const width = 800;
  const height = 500;

  const layoutNodes = useCallback((): GraphNode[] => {
    const center = { x: width / 2, y: height / 2 };
    const radius = 180;
    return nodes.map((node, i) => {
      if (node.id === centerNodeId) {
        return { ...node, x: center.x, y: center.y };
      }
      const angle = (i / Math.max(nodes.length - 1, 1)) * Math.PI * 2;
      return { ...node, x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    });
  }, [nodes, centerNodeId]);

  const positionedNodes = layoutNodes();
  const nodeMap = new Map(positionedNodes.map((n) => [n.id, n]));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // 绘制边
    for (const edge of edges) {
      const source = nodeMap.get(edge.sourceNodeId);
      const target = nodeMap.get(edge.targetNodeId);
      if (!source || !target) continue;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = edge.relationType === 'same_topic' ? '#94a3b8' : '#cbd5e1';
      ctx.lineWidth = edge.weight * 3;
      ctx.stroke();
    }

    // 绘制节点
    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
      ctx.fillStyle = NODE_COLORS[node.nodeType] || '#94a3b8';
      ctx.fill();
      ctx.strokeStyle = node.id === centerNodeId ? '#1e40af' : '#64748b';
      ctx.lineWidth = node.id === centerNodeId ? 3 : 1;
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label.slice(0, 10), node.x, node.y + size + 14);
    }

    ctx.restore();
  }, [positionedNodes, edges, scale, offset, nodeMap, centerNodeId]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - offset.x) / scale;
    const my = (e.clientY - rect.top - offset.y) / scale;

    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      const dist = Math.hypot(mx - node.x, my - node.y);
      if (dist < size + 4) {
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: node.label, nodeType: node.nodeType });
        return;
      }
    }
    setTooltip(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - offset.x) / scale;
    const my = (e.clientY - rect.top - offset.y) / scale;

    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      const dist = Math.hypot(mx - node.x, my - node.y);
      if (dist < size + 4) {
        onNodeClick(node.id, node.nodeType);
        return;
      }
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <NodeTooltip x={tooltip.x} y={tooltip.y} label={tooltip.label} nodeType={tooltip.nodeType} />
      )}
    </div>
  );
}
