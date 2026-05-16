import { useState } from 'react';

interface Props {
  onFilterChange: (filters: {
    contentTypes: string[];
    rerank: boolean;
  }) => void;
}

const CONTENT_TYPES = [
  { value: 'title', label: '标题' },
  { value: 'summary', label: '摘要' },
  { value: 'transcript', label: '转写' },
  { value: 'note', label: '笔记' },
];

export default function SearchFilters({ onFilterChange }: Props) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [rerank, setRerank] = useState(false);

  const toggleType = (type: string) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter(t => t !== type)
      : [...selectedTypes, type];
    setSelectedTypes(next);
    onFilterChange({ contentTypes: next, rerank });
  };

  return (
    <div style={{ marginBottom: 16, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>内容类型：</strong>
        {CONTENT_TYPES.map(type => (
          <label key={type.value} style={{ marginRight: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedTypes.includes(type.value)}
              onChange={() => toggleType(type.value)}
            />
            {type.label}
          </label>
        ))}
      </div>
      <div>
        <label style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={rerank}
            onChange={(e) => {
              setRerank(e.target.checked);
              onFilterChange({ contentTypes: selectedTypes, rerank: e.target.checked });
            }}
          />
          启用 Rerank
        </label>
      </div>
    </div>
  );
}
