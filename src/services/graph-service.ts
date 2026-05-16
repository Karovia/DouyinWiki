import { eq, and, desc, ne, inArray } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { graphNodes, graphEdges, videos } from '../db/schema';
import { videoNodeId, parseNodeId } from '../domain/graph-ids';

export interface NeighborResult {
  centerNode: { id: string; nodeType: string; label: string } | null;
  videoNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  entityNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  authorNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  edges: { sourceNodeId: string; targetNodeId: string; relationType: string; weight: number }[];
}

export class GraphService {
  constructor(private dbClient: DbClient = db) {}

  async getNeighbors(params: {
    workspaceId: string;
    videoId: string;
    relationTypes?: string[];
    limit: number;
  }): Promise<NeighborResult> {
    const { workspaceId, videoId, relationTypes, limit } = params;
    const nodeId = videoNodeId(videoId);

    const outgoingConditions = [
      eq(graphEdges.workspaceId, workspaceId),
      eq(graphEdges.sourceNodeId, nodeId),
    ];
    if (relationTypes?.length) {
      outgoingConditions.push(inArray(graphEdges.relationType, relationTypes));
    }

    const outgoingEdges = await this.dbClient
      .select()
      .from(graphEdges)
      .where(and(...outgoingConditions))
      .orderBy(desc(graphEdges.weight))
      .limit(limit);

    const incomingEdges = await this.dbClient
      .select()
      .from(graphEdges)
      .where(and(
        eq(graphEdges.workspaceId, workspaceId),
        eq(graphEdges.targetNodeId, nodeId),
        eq(graphEdges.relationType, 'same_topic')
      ))
      .orderBy(desc(graphEdges.weight))
      .limit(limit);

    const neighborNodeIds = [
      ...outgoingEdges.map((e) => e.targetNodeId),
      ...incomingEdges.map((e) => e.sourceNodeId),
    ];
    const uniqueNodeIds = [...new Set(neighborNodeIds)];

    const nodes = uniqueNodeIds.length > 0
      ? await this.dbClient.select().from(graphNodes).where(
          and(eq(graphNodes.workspaceId, workspaceId), inArray(graphNodes.id, uniqueNodeIds))
        )
      : [];

    return {
      centerNode: await this.getNode(workspaceId, nodeId),
      videoNeighbors: nodes.filter((n) => n.nodeType === 'video'),
      entityNeighbors: nodes.filter((n) => n.nodeType === 'entity'),
      authorNeighbors: nodes.filter((n) => n.nodeType === 'author'),
      edges: [...outgoingEdges, ...incomingEdges],
    };
  }

  async getSameAuthorVideos(
    workspaceId: string,
    videoId: string,
    authorId: string,
    limit: number = 10
  ): Promise<{ id: string; title: string | null; authorName: string | null }[]> {
    return this.dbClient
      .select({ id: videos.id, title: videos.title, authorName: videos.authorName })
      .from(videos)
      .where(and(
        eq(videos.workspaceId, workspaceId),
        eq(videos.authorId, authorId),
        ne(videos.id, videoId)
      ))
      .orderBy(desc(videos.createdAt))
      .limit(limit);
  }

  async getSameEntityVideos(
    workspaceId: string,
    videoId: string,
    limit: number = 10
  ): Promise<{ videoId: string; sharedEntities: string[] }[]> {
    const mentions = await this.dbClient
      .select({ targetNodeId: graphEdges.targetNodeId })
      .from(graphEdges)
      .where(and(
        eq(graphEdges.workspaceId, workspaceId),
        eq(graphEdges.sourceNodeId, videoNodeId(videoId)),
        eq(graphEdges.relationType, 'mentions')
      ));

    const entityNodeIds = mentions.map((m) => m.targetNodeId);
    if (entityNodeIds.length === 0) return [];

    const otherMentions = await this.dbClient
      .select({ sourceNodeId: graphEdges.sourceNodeId, targetNodeId: graphEdges.targetNodeId })
      .from(graphEdges)
      .where(and(
        eq(graphEdges.workspaceId, workspaceId),
        inArray(graphEdges.targetNodeId, entityNodeIds),
        eq(graphEdges.relationType, 'mentions'),
        ne(graphEdges.sourceNodeId, videoNodeId(videoId))
      ));

    const videoEntityMap = new Map<string, Set<string>>();
    for (const m of otherMentions) {
      const parsed = parseNodeId(m.sourceNodeId);
      const otherVideoId = parsed.businessId;
      if (!videoEntityMap.has(otherVideoId)) {
        videoEntityMap.set(otherVideoId, new Set());
      }
      videoEntityMap.get(otherVideoId)!.add(m.targetNodeId);
    }

    return [...videoEntityMap.entries()]
      .map(([vid, entities]) => ({ videoId: vid, sharedEntities: [...entities] }))
      .sort((a, b) => b.sharedEntities.length - a.sharedEntities.length)
      .slice(0, limit);
  }

  private async getNode(workspaceId: string, nodeId: string) {
    const result = await this.dbClient.select().from(graphNodes).where(
      and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.id, nodeId))
    ).limit(1);
    return result[0] || null;
  }
}
