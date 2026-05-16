import { nanoid } from 'nanoid';
import { VectorStore, SearchHit } from '~/infrastructure/vector-store';
import { ResolvedEntity } from '~/domain/entity-types';
import { videoNodeId, entityNodeId, authorNodeId } from '~/domain/graph-ids';
import { normalizeUndirectedEdge } from '~/domain/graph-utils';

export interface GraphEdge {
  id: string;
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: 'same_topic' | 'mentions';
  weight: number;
  computedBy: string;
  evidence?: string;
}

export interface GraphBuilderConfig {
  topK: number;
  minSimilarity: number;
}

const DEFAULT_CONFIG: GraphBuilderConfig = {
  topK: 5,
  minSimilarity: 0.75,
};

export class GraphBuilder {
  constructor(
    private vectorStore: VectorStore,
    private config: GraphBuilderConfig = DEFAULT_CONFIG
  ) {}

  async generateTopicEdges(
    workspaceId: string,
    videoId: string,
    videoEmbedding: number[]
  ): Promise<GraphEdge[]> {
    const candidates = await this.vectorStore.search({
      workspaceId,
      queryEmbedding: videoEmbedding,
      topK: this.config.topK * 3,
      filters: {},
    });

    const edges: GraphEdge[] = [];

    for (const hit of candidates) {
      if (hit.videoId === videoId) continue;
      if (hit.score < this.config.minSimilarity) continue;

      const [sourceNodeId, targetNodeId] = normalizeUndirectedEdge(
        videoNodeId(videoId),
        videoNodeId(hit.videoId)
      );

      edges.push({
        id: nanoid(),
        workspaceId,
        sourceNodeId,
        targetNodeId,
        relationType: 'same_topic',
        weight: Math.round(hit.score * 1000) / 1000,
        computedBy: 'embedding_sim',
        evidence: JSON.stringify([{ type: 'cosine_similarity', score: hit.score }]),
      });
    }

    return edges.slice(0, this.config.topK);
  }

  generateMentionsEdges(
    workspaceId: string,
    videoId: string,
    resolvedEntities: ResolvedEntity[],
    authorId?: string
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const videoNode = videoNodeId(videoId);

    for (const entity of resolvedEntities) {
      edges.push({
        id: nanoid(),
        workspaceId,
        sourceNodeId: videoNode,
        targetNodeId: entityNodeId(entity.canonicalKey),
        relationType: 'mentions',
        weight: entity.confidence,
        computedBy: 'entity_extraction',
        evidence: JSON.stringify([
          { type: 'entity_mention', entityName: entity.name, confidence: entity.confidence }
        ]),
      });
    }

    if (authorId) {
      edges.push({
        id: nanoid(),
        workspaceId,
        sourceNodeId: videoNode,
        targetNodeId: authorNodeId(authorId),
        relationType: 'mentions',
        weight: 1.0,
        computedBy: 'rule_based',
        evidence: JSON.stringify([{ type: 'video_author', authorId }]),
      });
    }

    return edges;
  }
}
