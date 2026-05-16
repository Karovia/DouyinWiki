import { EmbeddingClient } from '~/infrastructure/embedding-client';
import { VectorStore } from '~/infrastructure/vector-store';
import { SearchHit, SearchFilter } from '~/domain/types';

export interface SemanticSearchOptions {
  workspaceId: string;
  query: string;
  topK?: number;
  filters?: SearchFilter;
}

export class SearchService {
  constructor(
    private embeddingClient: EmbeddingClient,
    private vectorStore: VectorStore
  ) {}

  async semanticSearch(options: SemanticSearchOptions): Promise<{
    hits: SearchHit[];
    total: number;
  }> {
    const { workspaceId, query, topK = 20, filters } = options;

    // 1. 将查询文本转为向量
    const [queryEmbedding] = await this.embeddingClient.embed([query]);

    // 2. 向量检索
    const hits = await this.vectorStore.search({
      workspaceId,
      queryEmbedding,
      topK,
      filters,
    });

    return {
      hits,
      total: hits.length,
    };
  }
}
