import { Video } from '../../domain/types';

interface Props {
  video: Video;
}

export default function VideoCard({ video }: Props) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      {video.coverUrl && (
        <img
          src={video.coverUrl}
          alt={video.title}
          style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 4 }}
        />
      )}
      <h3 style={{ margin: '8px 0' }}>{video.title || '无标题'}</h3>
      <div style={{ color: '#666', fontSize: 14 }}>
        {video.authorName && <span>@{video.authorName} · </span>}
        {video.duration && <span>{Math.round(video.duration / 60)}分钟 · </span>}
        <span style={{ color: video.status === 'completed' ? 'green' : '#999' }}>
          {video.status}
        </span>
      </div>
      {video.aiSummary && (
        <p style={{ marginTop: 8, fontSize: 13, color: '#444' }}>{video.aiSummary}</p>
      )}
    </div>
  );
}
