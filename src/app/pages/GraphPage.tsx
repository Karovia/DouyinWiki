import { useState } from 'react';
import { trpc } from '../trpc';
import GraphCanvas from '../components/graph/GraphCanvas';
import GraphControls from '../components/graph/GraphControls';

interface Props {
  initialVideoId?: string;
}

export default function GraphPage({ initialVideoId }: Props) {
  const [videoId, setVideoId] = useState(initialVideoId || '');
  const [relationTypes, setRelationTypes] = useState<string[]>(['same_topic', 'mentions']);
  const [scale, setScale] = useState(1);

  const { data, isLoading } = trpc.graph.neighbors.useQuery(
    { videoId, relationTypes: relationTypes as any, limit: 20 },
    { enabled: !!videoId }
  );

  const toggleType = (type: string) => {
    setRelationTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleNodeClick = (nodeId: string, nodeType: string) => {
    if (nodeType === 'video') {
      const parsed = nodeId.split(':')[1];
      setVideoId(parsed);
    }
  };

  const nodes = [
    ...(data?.centerNode ? [{
      id: data.centerNode.id,
      label: data.centerNode.label,
      nodeType: data.centerNode.nodeType,
    }] : []),
    ...data?.videoNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
    ...data?.entityNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
    ...data?.authorNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
  ];

  return (
    <div>
      <h2>知识图谱</h2>
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={videoId}
          onChange={(e) => setVideoId(e.target.value)}
          placeholder="输入视频 ID..."
          style={{ width: 300, padding: 6 }}
        />
      </div>

      <GraphControls
        onZoomIn={() => setScale((s) => s * 1.2)}
        onZoomOut={() => setScale((s) => s / 1.2)}
        onReset={() => setScale(1)}
        relationTypes={relationTypes}
        onToggleType={toggleType}
      />

      {isLoading && <div>加载中...</div>}

      {data && (
        <GraphCanvas
          nodes={nodes}
          edges={data.edges.map((e) => ({
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            relationType: e.relationType,
            weight: e.weight,
          }))}
          centerNodeId={data.centerNode?.id || ''}
          onNodeClick={handleNodeClick}
        />
      )}
    </div>
  );
}
