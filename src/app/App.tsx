import { useState } from 'react';
import ImportPage from './pages/ImportPage';
import WikiListPage from './pages/WikiListPage';

type Page = 'import' | 'list';

export default function App() {
  const [page, setPage] = useState<Page>('import');

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <nav style={{ marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
        <button onClick={() => setPage('import')} style={{ marginRight: 10 }}>
          导入视频
        </button>
        <button onClick={() => setPage('list')}>Wiki 列表</button>
      </nav>

      {page === 'import' && <ImportPage />}
      {page === 'list' && <WikiListPage />}
    </div>
  );
}
