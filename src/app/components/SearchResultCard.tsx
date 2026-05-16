import { GroupedSearchResult } from '../../services/search-service';

interface Props {
  result: GroupedSearchResult;
  query: string;
}

function highlightText(text: string, query: string): React.ReactElement {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} style={{ background: '#ffeb3b', padding: '0 2px' }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function SearchResultCard({ result, query }: Props) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {result.videoCover && (
          <img
            src={result.videoCover}
            alt={result.videoTitle}
            style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 4 }}
          />
        )}
        <div>
          <h3 style={{ margin: '0 0 4px 0' }}>{result.videoTitle || '无标题'}</h3>
          {result.authorName && (
            <div style={{ color: '#666', fontSize: 13 }}>@{result.authorName}</div>
          )}
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
            相关度: {(result.bestScore * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
        <strong style={{ fontSize: 13, color: '#666' }}>命中片段 ({result.chunks.length}):</strong>
        {result.chunks.map((hit) => (
          <div
            key={hit.chunkId}
            style={{
              marginTop: 8,
              padding: 8,
              background: '#f5f5f5',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '2px 6px',
                borderRadius: 4,
                background: '#e3f2fd',
                color: '#1976d2',
                fontSize: 11,
                marginRight: 8,
              }}
            >
              {hit.contentType}
            </span>
            {hit.startTimeMs !== undefined && (
              <span style={{ color: '#999', fontSize: 11, marginRight: 8 }}>
                {Math.floor(hit.startTimeMs / 1000)}s
              </span>
            )}
            {highlightText(hit.content, query)}
          </div>
        ))}
      </div>
    </div>
  );
}
