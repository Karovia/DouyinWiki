import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { embeddings, chunks as chunksTable } from '../db/schema';
import { VectorChunk, SearchHit, SearchFilter } from '../domain/types';
import { VEC_INSERT_FAILED } from '../domain/errors';

export interface VectorStore {
  upsert(chunks: VectorChunk[]): Promise<void>;
  search(params: {
    workspaceId: string;
    queryEmbedding: number[];
    topK: number;
    filters?: SearchFilter;
  }): Promise<SearchHit[]>;
  deleteByOwner(ownerType: string, ownerId: string): Promise<void>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

export class SQLiteVectorStore implements VectorStore {
  async upsert(chunks: VectorChunk[]): Promise<void> {
    try {
      for (const chunk of chunks) {
        await db
          .insert(embeddings)
          .values({
            id: chunk.id,
            chunkId: chunk.chunkId,
            videoId: chunk.videoId,
            workspaceId: chunk.workspaceId,
            modelName: chunk.modelName,
            dimension: chunk.dimension,
            embedding: JSON.stringify(chunk.embedding),
            contentHash: chunk.contentHash,
            createdAt: chunk.createdAt,
          })
          .onConflictDoUpdate({
            target: [embeddings.chunkId, embeddings.modelName],
            set: {
              embedding: JSON.stringify(chunk.embedding),
              contentHash: chunk.contentHash,
              createdAt: new Date(),
            },
          });
      }
    } catch (err) {
      throw VEC_INSERT_FAILED();
    }
  }

  async search(params: {
    workspaceId: string;
    queryEmbedding: number[];
    topK: number;
    filters?: SearchFilter;
  }): Promise<SearchHit[]> {
    const { workspaceId, queryEmbedding, topK, filters } = params;

    // 获取该 workspace 的所有 embeddings
    const rows = await db
      .select({
        id: embeddings.id,
        chunkId: embeddings.chunkId,
        videoId: embeddings.videoId,
        embedding: embeddings.embedding,
        contentHash: embeddings.contentHash,
      })
      .from(embeddings)
      .where(eq(embeddings.workspaceId, workspaceId));

    if (rows.length === 0) return [];

    // 获取对应的 chunks 内容
    const chunkIds = rows.map((r) => r.chunkId);
    const chunkRows = chunkIds.length > 0
      ? await db
          .select()
          .from(chunksTable)
          .where(
            and(
              eq(chunksTable.workspaceId, workspaceId),
              inArray(chunksTable.id, chunkIds)
            )
          )
      : [];

    // 过滤和计算相似度
    const results: SearchHit[] = [];
    for (const row of rows) {
      const chunkRow = chunkRows.find((c) => c.id === row.chunkId);
      if (!chunkRow) continue;

      if (filters?.contentTypes && !filters.contentTypes.includes(chunkRow.contentType)) {
        continue;
      }

      if (filters?.videoIds && !filters.videoIds.includes(chunkRow.videoId)) {
        continue;
      }

      const emb = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, emb);

      results.push({
        chunkId: row.chunkId,
        videoId: row.videoId,
        content: chunkRow.content,
        contentType: chunkRow.contentType,
        startTimeMs: chunkRow.startTimeMs ?? undefined,
        endTimeMs: chunkRow.endTimeMs ?? undefined,
        score,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async deleteByOwner(ownerType: string, ownerId: string): Promise<void> {
    if (ownerType === 'video') {
      await db.delete(embeddings).where(eq(embeddings.videoId, ownerId));
    } else if (ownerType === 'chunk') {
      await db.delete(embeddings).where(eq(embeddings.chunkId, ownerId));
    }
  }
}
