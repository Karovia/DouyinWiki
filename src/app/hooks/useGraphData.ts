import { trpc } from '../trpc';

export function useGraphData(videoId: string) {
  const neighborsQuery = trpc.graph.neighbors.useQuery(
    { videoId, limit: 20 },
    { enabled: !!videoId }
  );

  return {
    data: neighborsQuery.data,
    isLoading: neighborsQuery.isLoading,
  };
}
