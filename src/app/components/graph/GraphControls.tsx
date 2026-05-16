interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  relationTypes: string[];
  onToggleType: (type: string) => void;
}

export default function GraphControls({ onZoomIn, onZoomOut, onReset, relationTypes, onToggleType }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <button onClick={onZoomIn}>+</button>
      <button onClick={onZoomOut}>-</button>
      <button onClick={onReset}>重置</button>
      <label style={{ marginLeft: 12 }}>
        <input
          type="checkbox"
          checked={relationTypes.includes('same_topic')}
          onChange={() => onToggleType('same_topic')}
        />
        same_topic
      </label>
      <label>
        <input
          type="checkbox"
          checked={relationTypes.includes('mentions')}
          onChange={() => onToggleType('mentions')}
        />
        mentions
      </label>
    </div>
  );
}
