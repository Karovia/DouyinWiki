export function normalizeUndirectedEdge(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function edgeKey(
  workspaceId: string,
  source: string,
  target: string,
  relationType: string
): string {
  return `${workspaceId}:${source}:${target}:${relationType}`;
}
