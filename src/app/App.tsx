import { useState } from 'react';
import ImportPage from './pages/ImportPage';
import WikiListPage from './pages/WikiListPage';
import SearchPage from './pages/SearchPage';

type Page = 'import' | 'list' | 'search';

export default function App() {
  const [page, setPage] = useState<Page>('search');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <nav style={{ marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
        <button onClick={() => setPage('search')} style={{ marginRight: 10 }}>
          搜索
        </button>
        <button onClick={() => setPage('import')} style={{ marginRight: 10 }}>
          导入视频
        </button>
        <button onClick={() => setPage('list')}>Wiki 列表</button>
      </nav>

      {page === 'search' && <SearchPage />}
      {page === 'import' && <ImportPage />}
      {page === 'list' && <WikiListPage />}
    </div>
  );
}
