import { useState } from 'react';
import { trpc } from '../trpc';

export default function ImportForm() {
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const createMutation = trpc.import.create.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
    },
  });

  const { data: jobStatus } = trpc.import.status.useQuery(
    { jobId: jobId! },
    { enabled: !!jobId, refetchInterval: 1000 }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    createMutation.mutate({ shareUrl: url.trim() });
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴抖音分享链接..."
          style={{ width: 400, padding: 8 }}
          required
        />
        <button type="submit" disabled={createMutation.isPending} style={{ marginLeft: 8 }}>
          {createMutation.isPending ? '导入中...' : '导入'}
        </button>
      </form>

      {jobStatus && (
        <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5' }}>
          <div>任务 ID: {jobStatus.id}</div>
          <div>
            状态: <strong>{jobStatus.status}</strong>
            {jobStatus.step && ` (${jobStatus.step})`}
          </div>
          {jobStatus.errorMessage && (
            <div style={{ color: 'red' }}>错误: {jobStatus.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
