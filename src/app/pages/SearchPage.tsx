import { useState } from 'react';
import { trpc } from '../trpc';
import SearchFilters from '../components/SearchFilters';
import SearchResultCard from '../components/SearchResultCard';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    contentTypes: [] as string[],
    rerank: false,
  });
  const [submittedQuery, setSubmittedQuery] = useState('');

  const searchQuery = trpc.search.hybrid.useQuery(
    {
      query: submittedQuery,
      topK: 20,
      contentTypes: filters.contentTypes.length > 0 ? filters.contentTypes : undefined,
      rerank: filters.rerank,
    },
    { enabled: submittedQuery.trim().length > 0 }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query.trim());
  };

  return (
    <div>
      <h2>混合检索</h2>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入搜索关键词..."
          style={{ width: 400, padding: 10, fontSize: 14 }}
        />
        <button type="submit" style={{ marginLeft: 8, padding: '10px 20px' }}>
          搜索
        </button>
      </form>

      <SearchFilters onFilterChange={setFilters} />

      {searchQuery.isLoading && <div>搜索中...</div>}

      {searchQuery.data && (
        <div>
          <div style={{ color: '#666', marginBottom: 12 }}>
            共找到 {searchQuery.data.total} 个结果，
            涉及 {searchQuery.data.grouped.length} 个视频
          </div>

          {searchQuery.data.grouped.map((group) => (
            <SearchResultCard key={group.videoId} result={group} query={submittedQuery} />
          ))}

          {searchQuery.data.grouped.length === 0 && submittedQuery.trim() && (
            <div style={{ color: '#999' }}>未找到相关结果</div>
          )}
        </div>
      )}
    </div>
  );
}
