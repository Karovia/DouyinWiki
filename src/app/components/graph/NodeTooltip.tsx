interface TooltipProps {
  x: number;
  y: number;
  label: string;
  nodeType: string;
}

export default function NodeTooltip({ x, y, label, nodeType }: TooltipProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x + 10,
        top: y - 30,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '6px 10px',
        borderRadius: 4,
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <div style={{ fontWeight: 'bold' }}>{label}</div>
      <div style={{ opacity: 0.7 }}>{nodeType}</div>
    </div>
  );
}
