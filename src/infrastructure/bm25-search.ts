import { eq, inArray, and } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { chunks } from '../db/schema';
import type { SearchHit, SearchFilter } from '../domain/types';

export interface BM25SearchOptions {
  workspaceId: string;
  query: string;
  topK: number;
  filters?: SearchFilter;
}

export interface BM25Search {
  search(options: BM25SearchOptions): Promise<SearchHit[]>;
}

export class SQLiteBM25Search implements BM25Search {
  constructor(private dbClient: DbClient = db) {}

  async search(options: BM25SearchOptions): Promise<SearchHit[]> {
    const { workspaceId, query, topK, filters } = options;

    // Clean query to prevent FTS5 syntax errors
    const safeQuery = this.sanitizeQuery(query);
    if (!safeQuery.trim()) return [];

    // Use raw SQL for FTS5 BM25 search
    const client = (this.dbClient as any).$client;
    const ftsResults = await client.execute({
      sql: `
        SELECT
          rowid,
          chunk_id,
          video_id,
          workspace_id,
          content_type,
          bm25(fts_chunks) as bm25_score
        FROM fts_chunks
        WHERE fts_chunks MATCH ?
          AND workspace_id = ?
        ORDER BY bm25_score ASC
        LIMIT ?
      `,
      args: [safeQuery, workspaceId, topK * 3],
    });

    if (!ftsResults.rows || ftsResults.rows.length === 0) return [];

    // Get chunk content from chunks table
    const chunkIds = ftsResults.rows.map((r: any) => r.chunk_id);
    const chunkRows = await this.dbClient
      .select()
      .from(chunks)
      .where(
        and(
          eq(chunks.workspaceId, workspaceId),
          inArray(chunks.id, chunkIds)
        )
      );

    // Apply filters and assemble results
    const results: SearchHit[] = [];
    for (const row of ftsResults.rows) {
      const chunkRow = chunkRows.find((c) => c.id === row.chunk_id);
      if (!chunkRow) continue;

      // contentTypes filter
      if (filters?.contentTypes && !filters.contentTypes.includes(chunkRow.contentType)) {
        continue;
      }

      // videoIds filter
      if (filters?.videoIds && !filters.videoIds.includes(chunkRow.videoId)) {
        continue;
      }

      // BM25 score: raw bm25 is lower-is-better, convert to higher-is-better
      const rawBm25 = row.bm25_score as number;
      const score = rawBm25 < 0 ? Math.abs(rawBm25) : 1 / (1 + rawBm25);

      results.push({
        chunkId: row.chunk_id as string,
        videoId: row.video_id as string,
        content: chunkRow.content,
        contentType: chunkRow.contentType,
        startTimeMs: chunkRow.startTimeMs ?? undefined,
        endTimeMs: chunkRow.endTimeMs ?? undefined,
        score,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private sanitizeQuery(query: string): string {
    return query
      .replace(/["']/g, '')
      .replace(/[\*\^\$]/g, '')
      .trim();
  }
}
