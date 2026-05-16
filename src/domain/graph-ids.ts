export function videoNodeId(videoId: string): string {
  return `video:${videoId}`;
}

export function entityNodeId(canonicalKey: string): string {
  return `entity:${canonicalKey}`;
}

export function authorNodeId(authorId: string): string {
  return `author:${authorId}`;
}

export function parseNodeId(nodeId: string): { type: string; businessId: string } {
  const [type, ...rest] = nodeId.split(':');
  return { type, businessId: rest.join(':') };
}
