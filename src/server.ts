import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { serve } from '@hono/node-server';
import { router } from './api/trpc';
import { importRouter } from './api/routers/import';
import { videosRouter } from './api/routers/videos';
import { searchRouter } from './api/routers/search';
import { graphRouter } from './api/routers/graph';
import { workspaceRouter } from './api/routers/workspace';
import { MockDouyinConnector } from './infrastructure/douyin-connector';
import { MockLLMClient } from './infrastructure/llm-client';
import { MockASRClient } from './infrastructure/asr-client';
import { MockEmbeddingClient } from './infrastructure/embedding-client';
import { SQLiteVectorStore } from './infrastructure/vector-store';
import { JobQueue } from './workers/queue';
import { registerParseWorker } from './workers/parse-worker';
import { registerASRWorker } from './workers/asr-worker';
import { registerChunkWorker } from './workers/chunk-worker';
import { registerSummaryWorker } from './workers/summary-worker';
import { registerEmbedWorker } from './workers/embed-worker';
import { registerIndexWorker } from './workers/index-worker';
import { registerGraphWorker } from './workers/graph-worker';
import { ImportService } from './services/import-service';
import { GraphBuilder } from './domain/graph-builder';
import { db } from './db';

// 初始化依赖
const connector = new MockDouyinConnector();
const llm = new MockLLMClient();
const asr = new MockASRClient();
const embeddingClient = new MockEmbeddingClient();
const vectorStore = new SQLiteVectorStore();
const importService = new ImportService(connector, db);

const queue = new JobQueue({
  maxConcurrency: 3,
  baseRetryDelayMs: 5000,
  maxRetries: 3,
  jobTimeoutMs: 30000,
});

// 注册所有 Worker
registerParseWorker(queue, connector, importService);
registerASRWorker(queue, asr, importService);
registerChunkWorker(queue, importService);
registerSummaryWorker(queue, llm, importService);
registerEmbedWorker(queue, embeddingClient, importService);
registerIndexWorker(queue, vectorStore, importService);

const graphBuilder = new GraphBuilder(vectorStore);
registerGraphWorker(queue, graphBuilder, importService);

// 合并 tRPC Router
export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  search: searchRouter,
  graph: graphRouter,
  workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;

// Hono 应用
const app = new Hono();

// CORS
app.use('*', cors({ origin: '*' }));

// tRPC 端点
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: () => ({ workspaceId: 'default', userId: 'anonymous' }),
  })
);

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

// 根路由
app.get('/', (c) => c.json({ message: 'Douyin Wiki API', version: '1.0.0' }));

const port = parseInt(process.env.PORT || '3000');

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
console.log('Registered workers: parse_metadata, transcribe, chunk, summarize, embed, index, graph_building');

export default app;
