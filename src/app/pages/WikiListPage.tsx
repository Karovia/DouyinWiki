import { trpc } from '../trpc';
import VideoCard from '../components/VideoCard';

export default function WikiListPage() {
  const { data, isLoading } = trpc.videos.list.useQuery({ limit: 20, offset: 0 });

  if (isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h2>Wiki 列表</h2>
      <div>共 {data?.total || 0} 条视频</div>
      <div style={{ marginTop: 16 }}>
        {data?.items.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
        {data?.items.length === 0 && <div style={{ color: '#999' }}>暂无视频，请先导入</div>}
      </div>
    </div>
  );
}
