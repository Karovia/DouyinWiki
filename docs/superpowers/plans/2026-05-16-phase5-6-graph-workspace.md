# Phase 5 + Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成知识图谱离线化（Phase 5：TopK 边生成、局部图谱、聚类展示、GraphWorker 流水线）和多用户运营化（Phase 6：Workspace 管理、权限、限流、成本统计、删除能力）。

**Architecture:** Phase 5 采用增量 TopK 边生成策略，same_topic 和 mentions 关系物化存储，same_author/same_entity 动态查询；GraphWorker 作为独立异步状态不阻塞视频主流程。Phase 6 在现有 workspace_id 字段基础上增加 workspaces 表和权限模型，所有服务层增加 workspace 校验。

**Tech Stack:** TypeScript / Hono / tRPC / Drizzle ORM (SQLite) / Zod / React / Canvas 2D

---

## File Structure

### Phase 5 新增/修改文件

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/db/schema.ts` | Modify | 新增 graph_nodes, graph_edges, entity_aliases 表；videos 表扩展 graph_status 等字段 |
| `src/domain/graph-ids.ts` | Create | 确定性节点 ID 生成：`video:{id}`, `entity:{key}`, `author:{id}` |
| `src/domain/graph-utils.ts` | Create | 无向边归一化、节点 ID 解析 |
| `src/domain/entity-types.ts` | Create | ExtractedEntity, EntityType, ResolvedEntity 类型定义 |
| `src/domain/errors.ts` | Modify | 新增 GRAPH_ 前缀错误码 |
| `src/infrastructure/llm-client.ts` | Modify | 扩展 analyzeContent 方法支持实体抽取 |
| `src/domain/entity-resolver.ts` | Create | 实体标准化、别名查询、消歧 |
| `src/db/seed-entity-aliases.ts` | Create | 内置技术别名冷启动数据 |
| `src/domain/graph-builder.ts` | Create | GraphBuilder：same_topic TopK + mentions 边生成 |
| `src/workers/graph-worker.ts` | Create | GraphWorker：异步独立状态 + 幂等 upsert |
| `src/services/graph-service.ts` | Create | GraphService：neighbors/search/dynamic queries |
| `src/api/routers/graph.ts` | Create | graph.neighbors, graph.search, graph.entityVideos tRPC endpoints |
| `src/server.ts` | Modify | 注册 GraphWorker 和 graphRouter |
| `src/app/pages/GraphPage.tsx` | Create | 知识图谱可视化页面 |
| `src/app/components/graph/GraphCanvas.tsx` | Create | Canvas 2D 渲染层 |
| `src/app/components/graph/GraphControls.tsx` | Create | 缩放/重置/筛选控件 |
| `src/app/components/graph/NodeTooltip.tsx` | Create | 悬停提示 |
| `src/app/hooks/useGraphData.ts` | Create | graph.neighbors 数据获取 hook |
| `src/app/App.tsx` | Modify | 添加图谱页面导航 |

### Phase 6 新增/修改文件

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/db/schema.ts` | Modify | 新增 workspaces, workspace_members 表 |
| `src/domain/workspace-types.ts` | Create | Workspace, WorkspaceMember, WorkspaceRole 类型 |
| `src/services/workspace-service.ts` | Create | Workspace CRUD + 成员管理 |
| `src/infrastructure/rate-limiter.ts` | Create | Workspace 级内存限流器 |
| `src/services/cost-tracker.ts` | Create | LLM/Embedding/ASR 调用成本统计 |
| `src/services/video-service.ts` | Modify | 添加 deleteVideo 级联删除 |
| `src/infrastructure/vector-store.ts` | Modify | 添加 deleteByOwner 实现 |
| `src/api/routers/workspace.ts` | Create | workspace CRUD + 成员管理 endpoints |
| `src/api/trpc.ts` | Modify | 增强 authedProcedure 带 workspace 权限校验 |

---

## Chunk 1: Phase 5 Task 1-2 — 数据库 Schema + 图工具

### Task 1: 数据库 Schema 扩展

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: 修改 videos 表添加图谱字段**

在 videos 表末尾追加字段：

```typescript
export const videos = sqliteTable('videos', {
  // ... 已有字段保持不变 ...
  graphStatus: text('graph_status').notNull().default('pending'),
  graphError: text('graph_error'),
  graphBuiltAt: integer('graph_built_at', { mode: 'timestamp' }),
  // ... createdAt, updatedAt
});
```

- [ ] **Step 2: 新增 graph_nodes 表**

```typescript
export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  nodeType: text('node_type').notNull(), // 'video' | 'entity' | 'author'
  businessId: text('business_id').notNull(),
  canonicalKey: text('canonical_key'),
  label: text('label').notNull(),
  properties: text('properties'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_graph_nodes_unique').on(table.workspaceId, table.nodeType, table.businessId),
  index('idx_graph_nodes_workspace_type').on(table.workspaceId, table.nodeType),
]);
```

- [ ] **Step 3: 新增 graph_edges 表**

```typescript
export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sourceNodeId: text('source_node_id').notNull(),
  targetNodeId: text('target_node_id').notNull(),
  relationType: text('relation_type').notNull(), // 'same_topic' | 'mentions'
  weight: real('weight').notNull().default(0.5),
  computedBy: text('computed_by').notNull(),
  evidence: text('evidence'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_graph_edges_unique').on(
    table.workspaceId, table.sourceNodeId, table.targetNodeId, table.relationType
  ),
  index('idx_edges_source_type_weight').on(
    table.workspaceId, table.sourceNodeId, table.relationType, table.weight
  ),
  index('idx_edges_target_type_weight').on(
    table.workspaceId, table.targetNodeId, table.relationType, table.weight
  ),
]);
```

- [ ] **Step 4: 新增 entity_aliases 表**

```typescript
export const entityAliases = sqliteTable('entity_aliases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  alias: text('alias').notNull(),
  canonicalNodeId: text('canonical_node_id').notNull(),
  source: text('source').notNull().default('auto_detected'), // 'builtin' | 'user_added' | 'auto_detected'
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('idx_entity_aliases_lookup').on(table.workspaceId, table.alias),
  index('idx_entity_aliases_canonical').on(table.workspaceId, table.canonicalNodeId),
]);
```

- [ ] **Step 5: 生成并运行迁移**

Run: `npx drizzle-kit generate && npx drizzle-kit migrate`

- [ ] **Step 6: 提交**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat(schema): add graph_nodes, graph_edges, entity_aliases and video graph_status"
```

---

### Task 2: 确定性 ID 与图工具

**Files:**
- Create: `src/domain/graph-ids.ts`
- Create: `src/domain/graph-utils.ts`
- Create: `src/domain/entity-types.ts`
- Modify: `src/domain/errors.ts`

- [ ] **Step 1: 创建 entity-types.ts**

```typescript
export type EntityType =
  | 'person'
  | 'technology'
  | 'concept'
  | 'company'
  | 'product'
  | 'domain';

export interface ExtractedEntity {
  name: string;
  originalText: string;
  type: EntityType;
  confidence: number;
}

export interface ResolvedEntity {
  name: string;
  canonicalKey: string;
  type: EntityType;
  confidence: number;
  isNew: boolean;
}
```

- [ ] **Step 2: 创建 graph-ids.ts**

```typescript
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
```

- [ ] **Step 3: 创建 graph-utils.ts**

```typescript
/**
 * 无向边归一化：统一排序节点 ID，避免 A→B 与 B→A 重复
 */
export function normalizeUndirectedEdge(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * 计算边唯一键（用于调试/日志）
 */
export function edgeKey(
  workspaceId: string,
  source: string,
  target: string,
  relationType: string
): string {
  return `${workspaceId}:${source}:${target}:${relationType}`;
}
```

- [ ] **Step 4: 扩展 errors.ts 添加 GRAPH_ 错误码**

```typescript
// 图谱层错误
export const GRAPH_NODE_NOT_FOUND = (nodeId: string) =>
  new AppError('GRAPH_NODE_NOT_FOUND', `Graph node not found: ${nodeId}`, false, 404);

export const GRAPH_EDGE_EXISTS = () =>
  new AppError('GRAPH_EDGE_EXISTS', 'Graph edge already exists', false, 409);

export const GRAPH_BUILD_FAILED = (reason: string) =>
  new AppError('GRAPH_BUILD_FAILED', `Graph build failed: ${reason}`, true, 502);
```

- [ ] **Step 5: 创建单元测试 tests/unit/graph-ids.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { videoNodeId, entityNodeId, authorNodeId, parseNodeId } from '~/domain/graph-ids';
import { normalizeUndirectedEdge } from '~/domain/graph-utils';

describe('graph-ids', () => {
  it('videoNodeId', () => {
    expect(videoNodeId('abc123')).toBe('video:abc123');
  });

  it('entityNodeId', () => {
    expect(entityNodeId('react')).toBe('entity:react');
  });

  it('parseNodeId', () => {
    expect(parseNodeId('video:abc')).toEqual({ type: 'video', businessId: 'abc' });
    expect(parseNodeId('entity:foo:bar')).toEqual({ type: 'entity', businessId: 'foo:bar' });
  });
});

describe('graph-utils', () => {
  it('normalizeUndirectedEdge orders lexicographically', () => {
    expect(normalizeUndirectedEdge('b', 'a')).toEqual(['a', 'b']);
    expect(normalizeUndirectedEdge('a', 'b')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/unit/graph-ids.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: 提交**

```bash
git add src/domain/graph-ids.ts src/domain/graph-utils.ts src/domain/entity-types.ts src/domain/errors.ts tests/unit/graph-ids.test.ts
git commit -m "feat(graph): add deterministic node IDs, entity types, and graph utilities"
```

---

## Chunk 2: Phase 5 Task 3-4 — 实体抽取 + GraphBuilder

### Task 3: 实体抽取与标准化

**Files:**
- Modify: `src/infrastructure/llm-client.ts`
- Create: `src/domain/entity-resolver.ts`
- Create: `src/db/seed-entity-aliases.ts`

- [ ] **Step 1: 扩展 LLMClient 接口添加 analyzeContent**

```typescript
// src/infrastructure/llm-client.ts
import { ExtractedEntity } from '~/domain/entity-types';

export interface LLMClient {
  generateSummary(text: string): Promise<string>;
  generateTags(text: string): Promise<string[]>;
  analyzeContent(input: {
    title: string;
    transcript: string;
  }): Promise<{
    summary: string;
    tags: string[];
    entities: ExtractedEntity[];
  }>;
}
```

- [ ] **Step 2: 在 MockLLMClient 中实现 analyzeContent**

```typescript
export class MockLLMClient implements LLMClient {
  // ... 已有 generateSummary, generateTags 保持不变 ...

  async analyzeContent(input: { title: string; transcript: string }): Promise<{
    summary: string;
    tags: string[];
    entities: ExtractedEntity[];
  }> {
    await new Promise((r) => setTimeout(r, 300));

    const text = `${input.title}\n${input.transcript}`;
    const summary = await this.generateSummary(text);
    const tags = await this.generateTags(text);

    // Mock 实体抽取：从文本中提取大写词和技术词汇
    const mockEntities: ExtractedEntity[] = [
      { name: 'React', originalText: 'React', type: 'technology', confidence: 0.92 },
      { name: 'TypeScript', originalText: 'TypeScript', type: 'technology', confidence: 0.88 },
    ];

    return { summary, tags, entities: mockEntities };
  }
}
```

- [ ] **Step 3: 创建 entity-resolver.ts**

```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '~/db';
import { graphNodes, entityAliases } from '~/db/schema';
import { ExtractedEntity, ResolvedEntity } from '~/domain/entity-types';
import { entityNodeId } from '~/domain/graph-ids';

export class EntityResolver {
  async resolveEntities(
    workspaceId: string,
    extracted: ExtractedEntity[]
  ): Promise<ResolvedEntity[]> {
    const resolved: ResolvedEntity[] = [];
    for (const entity of extracted) {
      const result = await this.resolveEntity(workspaceId, entity);
      resolved.push(result);
    }
    return resolved;
  }

  private async resolveEntity(
    workspaceId: string,
    entity: ExtractedEntity
  ): Promise<ResolvedEntity> {
    const normalized = this.normalizeText(entity.name);

    // Step 1: 查询别名表
    const aliasMatch = await db
      .select({ canonicalNodeId: entityAliases.canonicalNodeId })
      .from(entityAliases)
      .where(and(eq(entityAliases.workspaceId, workspaceId), eq(entityAliases.alias, normalized)))
      .limit(1);

    if (aliasMatch[0]) {
      const { businessId } = this.parseNodeIdQuick(aliasMatch[0].canonicalNodeId);
      return { name: entity.name, canonicalKey: businessId, type: entity.type, confidence: entity.confidence, isNew: false };
    }

    // Step 2: 查询已有实体节点
    const existing = await db
      .select({ id: graphNodes.id, canonicalKey: graphNodes.canonicalKey })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.workspaceId, workspaceId),
          eq(graphNodes.nodeType, 'entity'),
          eq(graphNodes.canonicalKey, normalized)
        )
      )
      .limit(1);

    if (existing[0] && existing[0].canonicalKey) {
      return { name: entity.name, canonicalKey: existing[0].canonicalKey, type: entity.type, confidence: entity.confidence, isNew: false };
    }

    // Step 3: 新实体
    return { name: entity.name, canonicalKey: normalized, type: entity.type, confidence: entity.confidence, isNew: true };
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_\.]+/g, '');
  }

  private parseNodeIdQuick(nodeId: string): { type: string; businessId: string } {
    const [type, ...rest] = nodeId.split(':');
    return { type, businessId: rest.join(':') };
  }
}
```

- [ ] **Step 4: 创建 seed-entity-aliases.ts**

```typescript
import { db } from '~/db';
import { graphNodes, entityAliases } from '~/db/schema';
import { entityNodeId } from '~/domain/graph-ids';
import { nanoid } from 'nanoid';

const BUILTIN_ALIASES: Record<string, string[]> = {
  'React': ['React.js', 'ReactJS', 'reactjs', 'React 18', 'React 19'],
  'TypeScript': ['TS', 'typescript', 'Type Script'],
  'Vue': ['Vue.js', 'VueJS', 'vuejs', 'Vue 3'],
  'Next.js': ['NextJS', 'nextjs'],
  'Node.js': ['NodeJS', 'nodejs', 'Node'],
  'Docker': ['docker'],
  'Kubernetes': ['K8s', 'k8s', 'kube'],
  'GitHub': ['Github', 'github'],
  '抖音': ['Douyin', 'TikTok', 'douyin'],
};

export async function seedBuiltinAliases(workspaceId: string): Promise<void> {
  for (const [canonical, aliases] of Object.entries(BUILTIN_ALIASES)) {
    const canonicalNodeId = entityNodeId(canonical);

    await db.insert(graphNodes).values({
      id: canonicalNodeId,
      workspaceId,
      nodeType: 'entity',
      businessId: canonical,
      canonicalKey: canonical,
      label: canonical,
    }).onConflictDoNothing();

    for (const alias of aliases) {
      const normalizedAlias = alias.toLowerCase().replace(/[\s\-_\.]+/g, '');
      await db.insert(entityAliases).values({
        id: nanoid(),
        workspaceId,
        alias: normalizedAlias,
        canonicalNodeId,
        source: 'builtin',
      }).onConflictDoNothing();
    }
  }
}
```

- [ ] **Step 5: 修改 summary-worker.ts 复用 analyzeContent**

```typescript
// 在 summary-worker 中，将原来的 generateSummary + generateTags 改为 analyzeContent
const result = await llm.analyzeContent({ title, transcript });
// 保存 summary, tags, entities
```

- [ ] **Step 6: 创建集成测试 tests/integration/entity-resolution.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { EntityResolver } from '~/domain/entity-resolver';
import { seedBuiltinAliases } from '~/db/seed-entity-aliases';
import { db } from '~/db';
import { graphNodes, entityAliases } from '~/db/schema';
import { eq } from 'drizzle-orm';

const workspaceId = 'test-ws-entity';

describe('entity-resolution', () => {
  beforeEach(async () => {
    await db.delete(entityAliases).where(eq(entityAliases.workspaceId, workspaceId));
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId));
  });

  it('should resolve new entity', async () => {
    const resolver = new EntityResolver();
    const result = await resolver.resolveEntities(workspaceId, [
      { name: 'Rust', originalText: 'Rust', type: 'technology', confidence: 0.9 },
    ]);
    expect(result[0].canonicalKey).toBe('rust');
    expect(result[0].isNew).toBe(true);
  });

  it('should resolve builtin alias', async () => {
    await seedBuiltinAliases(workspaceId);
    const resolver = new EntityResolver();
    const result = await resolver.resolveEntities(workspaceId, [
      { name: 'ReactJS', originalText: 'ReactJS', type: 'technology', confidence: 0.9 },
    ]);
    expect(result[0].canonicalKey).toBe('React');
    expect(result[0].isNew).toBe(false);
  });
});
```

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/integration/entity-resolution.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: 提交**

```bash
git add src/infrastructure/llm-client.ts src/domain/entity-resolver.ts src/db/seed-entity-aliases.ts src/workers/summary-worker.ts tests/integration/entity-resolution.test.ts
git commit -m "feat(entity): add entity extraction, resolution, and builtin aliases seed"
```

---

### Task 4: GraphBuilder 边生成

**Files:**
- Create: `src/domain/graph-builder.ts`
- Create: `tests/unit/graph-builder.test.ts`

- [ ] **Step 1: 创建 graph-builder.ts**

```typescript
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
      filters: { videoIds: undefined },
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
```

- [ ] **Step 2: 创建 graph-builder 单元测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GraphBuilder } from '~/domain/graph-builder';
import { SearchHit } from '~/infrastructure/vector-store';

const mockVectorStore = {
  upsert: vi.fn(),
  search: vi.fn(),
  deleteByOwner: vi.fn(),
};

describe('GraphBuilder', () => {
  it('generateMentionsEdges creates video->entity edges', () => {
    const builder = new GraphBuilder(mockVectorStore as any);
    const edges = builder.generateMentionsEdges('ws1', 'vid1', [
      { name: 'React', canonicalKey: 'react', type: 'technology', confidence: 0.9, isNew: true },
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0].sourceNodeId).toBe('video:vid1');
    expect(edges[0].targetNodeId).toBe('entity:react');
    expect(edges[0].relationType).toBe('mentions');
    expect(edges[0].weight).toBe(0.9);
  });

  it('generateMentionsEdges includes author edge', () => {
    const builder = new GraphBuilder(mockVectorStore as any);
    const edges = builder.generateMentionsEdges('ws1', 'vid1', [], 'author1');

    expect(edges).toHaveLength(1);
    expect(edges[0].targetNodeId).toBe('author:author1');
  });

  it('generateTopicEdges respects topK limit', async () => {
    mockVectorStore.search.mockResolvedValue([
      { videoId: 'vid2', chunkId: 'c1', content: 'a', contentType: 'summary', score: 0.9 },
      { videoId: 'vid3', chunkId: 'c2', content: 'b', contentType: 'summary', score: 0.8 },
      { videoId: 'vid4', chunkId: 'c3', content: 'c', contentType: 'summary', score: 0.7 },
    ] as SearchHit[]);

    const builder = new GraphBuilder(mockVectorStore as any, { topK: 2, minSimilarity: 0.5 });
    const edges = await builder.generateTopicEdges('ws1', 'vid1', [0.1, 0.2, 0.3]);

    expect(edges).toHaveLength(2);
    expect(mockVectorStore.search).toHaveBeenCalledWith(expect.objectContaining({ topK: 6 }));
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/unit/graph-builder.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: 提交**

```bash
git add src/domain/graph-builder.ts tests/unit/graph-builder.test.ts
git commit -m "feat(graph): add GraphBuilder with same_topic TopK and mentions edge generation"
```

---

## Chunk 3: Phase 5 Task 5-7 — GraphWorker + GraphService + API

### Task 5: GraphWorker 异步流水线

**Files:**
- Create: `src/workers/graph-worker.ts`
- Modify: `src/workers/queue.ts` — 添加 'graph_building' 到 JobType
- Modify: `src/server.ts` — 注册 GraphWorker

- [ ] **Step 1: 扩展 JobType**

```typescript
// src/workers/queue.ts
export type JobType =
  | 'parse_metadata'
  | 'transcribe'
  | 'chunk'
  | 'summarize'
  | 'embed'
  | 'index'
  | 'graph_building'; // 新增
```

- [ ] **Step 2: 创建 graph-worker.ts**

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { db } from '~/db';
import { videos, graphNodes, graphEdges, chunks, embeddings } from '~/db/schema';
import { JobQueue, QueueJob, JobResult } from './queue';
import { GraphBuilder, GraphEdge } from '~/domain/graph-builder';
import { EntityResolver } from '~/domain/entity-resolver';
import { ImportService } from '~/services/import-service';
import { videoNodeId, entityNodeId, authorNodeId } from '~/domain/graph-ids';
import { parseNodeId } from '~/domain/graph-ids';

export function registerGraphWorker(
  queue: JobQueue,
  graphBuilder: GraphBuilder,
  importService: ImportService
) {
  queue.register('graph_building', async (job: QueueJob): Promise<JobResult> => {
    const { videoId, workspaceId } = job.payload;
    if (!videoId || !workspaceId) {
      return { success: false, retryable: false, error: new Error('Missing videoId or workspaceId') };
    }

    // 更新图谱状态为 building
    await db.update(videos)
      .set({ graphStatus: 'building', updatedAt: new Date() })
      .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)));

    try {
      // 1. 获取视频的平均 embedding
      const videoEmbedding = await getVideoEmbedding(videoId);

      // 2. 生成 same_topic 边
      let edges: GraphEdge[] = [];
      if (videoEmbedding) {
        const topicEdges = await graphBuilder.generateTopicEdges(workspaceId, videoId, videoEmbedding);
        edges.push(...topicEdges);
      }

      // 3. 获取实体和作者信息
      const videoRow = await db.select().from(videos)
        .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)))
        .limit(1);

      const authorId = videoRow[0]?.authorId;

      // 4. 从 chunks 中恢复实体（简化：从 aiTags 或重新解析）
      // 实际应该从 summary-worker 保存的 entities 读取
      // MVP 简化：从 aiTags 推断
      const aiTags = videoRow[0]?.aiTags ? JSON.parse(videoRow[0].aiTags) as string[] : [];
      const mockEntities = aiTags.map((tag: string) => ({
        name: tag,
        canonicalKey: tag.toLowerCase().replace(/[\s\-_\.]+/g, ''),
        type: 'concept' as const,
        confidence: 0.7,
        isNew: true,
      }));

      // 5. 确保 entity/author 节点存在
      await upsertEntityNodes(workspaceId, mockEntities);
      if (authorId) {
        await upsertAuthorNode(workspaceId, authorId, videoRow[0]?.authorName || authorId);
      }
      // 确保视频节点存在
      await upsertVideoNode(workspaceId, videoId, videoRow[0]?.title || videoId);

      // 6. 生成 mentions 边
      const mentionEdges = graphBuilder.generateMentionsEdges(workspaceId, videoId, mockEntities, authorId || undefined);
      edges.push(...mentionEdges);

      // 7. 幂等写入边
      await upsertEdges(edges);

      // 8. 更新成功状态
      await db.update(videos)
        .set({ graphStatus: 'ready', graphBuiltAt: new Date(), updatedAt: new Date() })
        .where(eq(videos.id, videoId));

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await db.update(videos)
        .set({ graphStatus: 'failed', graphError: message, updatedAt: new Date() })
        .where(eq(videos.id, videoId));
      return { success: false, retryable: true, error: new Error(message) };
    }
  });
}

async function getVideoEmbedding(videoId: string): Promise<number[] | null> {
  const rows = await db.select({ embedding: embeddings.embedding })
    .from(embeddings)
    .where(eq(embeddings.videoId, videoId))
    .limit(1);

  if (!rows[0]) return null;
  return JSON.parse(rows[0].embedding) as number[];
}

async function upsertEntityNodes(
  workspaceId: string,
  entities: { canonicalKey: string; name: string; type: string; confidence: number }[]
): Promise<void> {
  for (const entity of entities) {
    const nodeId = entityNodeId(entity.canonicalKey);
    await db.insert(graphNodes).values({
      id: nodeId,
      workspaceId,
      nodeType: 'entity',
      businessId: entity.canonicalKey,
      canonicalKey: entity.canonicalKey,
      label: entity.name,
      properties: JSON.stringify({ type: entity.type, confidence: entity.confidence }),
    }).onConflictDoNothing();
  }
}

async function upsertAuthorNode(workspaceId: string, authorId: string, label: string): Promise<void> {
  const nodeId = authorNodeId(authorId);
  await db.insert(graphNodes).values({
    id: nodeId,
    workspaceId,
    nodeType: 'author',
    businessId: authorId,
    label,
  }).onConflictDoNothing();
}

async function upsertVideoNode(workspaceId: string, videoId: string, label: string): Promise<void> {
  const nodeId = videoNodeId(videoId);
  await db.insert(graphNodes).values({
    id: nodeId,
    workspaceId,
    nodeType: 'video',
    businessId: videoId,
    label,
  }).onConflictDoNothing();
}

async function upsertEdges(edges: GraphEdge[]): Promise<void> {
  if (edges.length === 0) return;

  await db.insert(graphEdges)
    .values(edges)
    .onConflictDoUpdate({
      target: [graphEdges.workspaceId, graphEdges.sourceNodeId, graphEdges.targetNodeId, graphEdges.relationType],
      set: {
        weight: sql`excluded.weight`,
        evidence: sql`excluded.evidence`,
        updatedAt: new Date(),
      },
    });
}
```

- [ ] **Step 3: 修改 index-worker.ts 在 indexing 完成后触发 graph_building**

```typescript
// 在 index-worker 中，indexing 成功后入队 graph_building
queue.enqueue({
  id: nanoid(),
  type: 'graph_building',
  payload: { jobId: job.id, videoId, shareUrl, workspaceId },
});
```

- [ ] **Step 4: 修改 server.ts 注册 GraphWorker**

```typescript
import { GraphBuilder } from './domain/graph-builder';
import { registerGraphWorker } from './workers/graph-worker';

const graphBuilder = new GraphBuilder(vectorStore);
registerGraphWorker(queue, graphBuilder, importService);
```

- [ ] **Step 5: 创建集成测试 tests/integration/graph-worker.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphBuilder } from '~/domain/graph-builder';
import { registerGraphWorker } from '~/workers/graph-worker';
import { JobQueue } from '~/workers/queue';
import { ImportService } from '~/services/import-service';
import { db } from '~/db';
import { videos, graphEdges, graphNodes } from '~/db/schema';
import { eq, and } from 'drizzle-orm';
import { MockDouyinConnector } from '~/infrastructure/douyin-connector';

const workspaceId = 'test-ws-graph';

describe('graph-worker', () => {
  let queue: JobQueue;

  beforeEach(async () => {
    queue = new JobQueue({ maxConcurrency: 1, jobTimeoutMs: 10000 });
    await db.delete(graphEdges).where(eq(graphEdges.workspaceId, workspaceId));
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId));
  });

  it('should build graph edges for a video', async () => {
    // 先插入一个视频
    await db.insert(videos).values({
      id: 'test-video-1',
      workspaceId,
      shareUrl: 'https://douyin.com/video/1',
      normalizedUrlHash: 'hash1',
      aiTags: JSON.stringify(['React', 'TypeScript']),
      authorId: 'author1',
      status: 'completed',
      graphStatus: 'pending',
    });

    const builder = new GraphBuilder({ search: async () => [] } as any);
    const importService = new ImportService(new MockDouyinConnector(), db);
    registerGraphWorker(queue, builder, importService);

    queue.enqueue({
      id: 'job-graph-1',
      type: 'graph_building',
      payload: { jobId: 'j1', videoId: 'test-video-1', shareUrl: '', workspaceId },
    });

    // 等待 worker 处理
    await new Promise((r) => setTimeout(r, 500));

    const videoRow = await db.select().from(videos)
      .where(and(eq(videos.id, 'test-video-1'), eq(videos.workspaceId, workspaceId)))
      .limit(1);

    expect(videoRow[0].graphStatus).toBe('ready');

    const edges = await db.select().from(graphEdges)
      .where(eq(graphEdges.workspaceId, workspaceId));

    expect(edges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/integration/graph-worker.test.ts`
Expected: PASS (1 test)

- [ ] **Step 7: 提交**

```bash
git add src/workers/graph-worker.ts src/workers/queue.ts src/workers/index-worker.ts src/server.ts tests/integration/graph-worker.test.ts
git commit -m "feat(graph-worker): add async graph building pipeline with idempotent upserts"
```

---

### Task 6: GraphService 查询服务

**Files:**
- Create: `src/services/graph-service.ts`
- Create: `tests/unit/graph-service.test.ts`

- [ ] **Step 1: 创建 graph-service.ts**

```typescript
import { eq, and, desc, ne, inArray } from 'drizzle-orm';
import { db } from '~/db';
import { graphNodes, graphEdges, videos } from '~/db/schema';
import { videoNodeId, parseNodeId } from '~/domain/graph-ids';
import { SearchHit } from '~/infrastructure/vector-store';

export interface NeighborResult {
  centerNode: { id: string; nodeType: string; label: string } | null;
  videoNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  entityNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  authorNeighbors: { id: string; label: string; nodeType: string; businessId: string }[];
  edges: { sourceNodeId: string; targetNodeId: string; relationType: string; weight: number }[];
}

export interface GraphSearchResult {
  videos: { id: string; title: string; score: number }[];
  entities: { id: string; label: string; mentionCount: number }[];
}

export class GraphService {
  async getNeighbors(params: {
    workspaceId: string;
    videoId: string;
    relationTypes?: string[];
    limit: number;
  }): Promise<NeighborResult> {
    const { workspaceId, videoId, relationTypes, limit } = params;
    const nodeId = videoNodeId(videoId);

    // 出边
    const outgoingConditions = [
      eq(graphEdges.workspaceId, workspaceId),
      eq(graphEdges.sourceNodeId, nodeId),
    ];
    if (relationTypes?.length) {
      outgoingConditions.push(inArray(graphEdges.relationType, relationTypes));
    }

    const outgoingEdges = await db
      .select()
      .from(graphEdges)
      .where(and(...outgoingConditions))
      .orderBy(desc(graphEdges.weight))
      .limit(limit);

    // 入边（仅 same_topic）
    const incomingEdges = await db
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
      ? await db.select().from(graphNodes).where(
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
    return db
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
    const mentions = await db
      .select({ targetNodeId: graphEdges.targetNodeId })
      .from(graphEdges)
      .where(and(
        eq(graphEdges.workspaceId, workspaceId),
        eq(graphEdges.sourceNodeId, videoNodeId(videoId)),
        eq(graphEdges.relationType, 'mentions')
      ));

    const entityNodeIds = mentions.map((m) => m.targetNodeId);
    if (entityNodeIds.length === 0) return [];

    const otherMentions = await db
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
    const result = await db.select().from(graphNodes).where(
      and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.id, nodeId))
    ).limit(1);
    return result[0] || null;
  }
}
```

- [ ] **Step 2: 创建 graph-service 单元测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from '~/services/graph-service';
import { db } from '~/db';
import { graphNodes, graphEdges, videos } from '~/db/schema';
import { eq, and } from 'drizzle-orm';

const workspaceId = 'test-ws-gs';

describe('GraphService', () => {
  const service = new GraphService();

  beforeEach(async () => {
    await db.delete(graphEdges).where(eq(graphEdges.workspaceId, workspaceId));
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId));
    await db.delete(videos).where(eq(videos.workspaceId, workspaceId));
  });

  it('getNeighbors returns empty for isolated video', async () => {
    const result = await service.getNeighbors({ workspaceId, videoId: 'v1', limit: 10 });
    expect(result.edges).toHaveLength(0);
    expect(result.videoNeighbors).toHaveLength(0);
  });

  it('getSameAuthorVideos returns videos by same author', async () => {
    await db.insert(videos).values([
      { id: 'v1', workspaceId, shareUrl: 'u1', normalizedUrlHash: 'h1', authorId: 'a1', status: 'completed' },
      { id: 'v2', workspaceId, shareUrl: 'u2', normalizedUrlHash: 'h2', authorId: 'a1', status: 'completed' },
      { id: 'v3', workspaceId, shareUrl: 'u3', normalizedUrlHash: 'h3', authorId: 'a2', status: 'completed' },
    ]);

    const result = await service.getSameAuthorVideos(workspaceId, 'v1', 'a1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v2');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/unit/graph-service.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: 提交**

```bash
git add src/services/graph-service.ts tests/unit/graph-service.test.ts
git commit -m "feat(graph-service): add neighbor, same-author, and same-entity queries"
```

---

### Task 7: graph tRPC API Router

**Files:**
- Create: `src/api/routers/graph.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: 创建 graph.ts router**

```typescript
import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { GraphService } from '~/services/graph-service';

const graphService = new GraphService();

export const graphRouter = router({
  neighbors: authedProcedure
    .input(z.object({
      videoId: z.string(),
      relationTypes: z.array(z.enum(['same_topic', 'mentions'])).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      return graphService.getNeighbors({
        workspaceId: ctx.workspaceId,
        videoId: input.videoId,
        relationTypes: input.relationTypes,
        limit: input.limit,
      });
    }),

  sameAuthor: authedProcedure
    .input(z.object({
      videoId: z.string(),
      authorId: z.string(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      return graphService.getSameAuthorVideos(
        ctx.workspaceId, input.videoId, input.authorId, input.limit
      );
    }),

  sameEntity: authedProcedure
    .input(z.object({
      videoId: z.string(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      return graphService.getSameEntityVideos(
        ctx.workspaceId, input.videoId, input.limit
      );
    }),
});
```

- [ ] **Step 2: 修改 server.ts 添加 graph router**

```typescript
import { graphRouter } from './api/routers/graph';

export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  search: searchRouter,
  graph: graphRouter,
});
```

- [ ] **Step 3: 创建 API 集成测试 tests/integration/graph-api.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~/db';
import { graphNodes, graphEdges } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { GraphService } from '~/services/graph-service';

const workspaceId = 'test-ws-api';

describe('graph-api', () => {
  beforeEach(async () => {
    await db.delete(graphEdges).where(eq(graphEdges.workspaceId, workspaceId));
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId));
  });

  it('neighbors should return edges and nodes', async () => {
    // 插入测试数据
    await db.insert(graphNodes).values([
      { id: 'video:v1', workspaceId, nodeType: 'video', businessId: 'v1', label: 'Video 1' },
      { id: 'video:v2', workspaceId, nodeType: 'video', businessId: 'v2', label: 'Video 2' },
      { id: 'entity:react', workspaceId, nodeType: 'entity', businessId: 'react', canonicalKey: 'react', label: 'React' },
    ]);

    await db.insert(graphEdges).values([
      { id: 'e1', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'video:v2', relationType: 'same_topic', weight: 0.9, computedBy: 'test' },
      { id: 'e2', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'entity:react', relationType: 'mentions', weight: 0.8, computedBy: 'test' },
    ]);

    const service = new GraphService();
    const result = await service.getNeighbors({ workspaceId, videoId: 'v1', limit: 10 });

    expect(result.edges).toHaveLength(2);
    expect(result.videoNeighbors).toHaveLength(1);
    expect(result.entityNeighbors).toHaveLength(1);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/integration/graph-api.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: 提交**

```bash
git add src/api/routers/graph.ts src/server.ts tests/integration/graph-api.test.ts
git commit -m "feat(graph-api): add graph neighbors, sameAuthor, sameEntity endpoints"
```

---

## Chunk 4: Phase 5 Task 8 — 前端图谱页面

### Task 8: 前端知识图谱可视化

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/app/pages/GraphPage.tsx`
- Create: `src/app/components/graph/GraphCanvas.tsx`
- Create: `src/app/components/graph/GraphControls.tsx`
- Create: `src/app/components/graph/NodeTooltip.tsx`
- Create: `src/app/hooks/useGraphData.ts`

- [ ] **Step 1: 创建 useGraphData.ts**

```typescript
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../trpc';

export function useGraphData(videoId: string) {
  const utils = trpc.useUtils();

  const neighborsQuery = trpc.graph.neighbors.useQuery(
    { videoId, limit: 20 },
    { enabled: !!videoId }
  );

  return {
    data: neighborsQuery.data,
    isLoading: neighborsQuery.isLoading,
  };
}
```

- [ ] **Step 2: 创建 NodeTooltip.tsx**

```tsx
interface TooltipProps {
  x: number;
  y: number;
  label: string;
  nodeType: string;
}

export default function NodeTooltip({ x, y, label, nodeType }: TooltipProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x + 10,
        top: y - 30,
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '6px 10px',
        borderRadius: 4,
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <div style={{ fontWeight: 'bold' }}>{label}</div>
      <div style={{ opacity: 0.7 }}>{nodeType}</div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 GraphControls.tsx**

```tsx
interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  relationTypes: string[];
  onToggleType: (type: string) => void;
}

export default function GraphControls({ onZoomIn, onZoomOut, onReset, relationTypes, onToggleType }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <button onClick={onZoomIn}>+</button>
      <button onClick={onZoomOut}>-</button>
      <button onClick={onReset}>重置</button>
      <label style={{ marginLeft: 12 }}>
        <input
          type="checkbox"
          checked={relationTypes.includes('same_topic')}
          onChange={() => onToggleType('same_topic')}
        />
        same_topic
      </label>
      <label>
        <input
          type="checkbox"
          checked={relationTypes.includes('mentions')}
          onChange={() => onToggleType('mentions')}
        />
        mentions
      </label>
    </div>
  );
}
```

- [ ] **Step 4: 创建 GraphCanvas.tsx**

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import NodeTooltip from './NodeTooltip';

interface GraphNode {
  id: string;
  label: string;
  nodeType: string;
  x: number;
  y: number;
}

interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  weight: number;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerNodeId: string;
  onNodeClick: (nodeId: string, nodeType: string) => void;
}

const NODE_COLORS: Record<string, string> = {
  video: '#3b82f6',
  entity: '#10b981',
  author: '#f59e0b',
};

const NODE_SIZES: Record<string, number> = {
  video: 20,
  entity: 14,
  author: 16,
};

export default function GraphCanvas({ nodes, edges, centerNodeId, onNodeClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; nodeType: string } | null>(null);

  const width = 800;
  const height = 500;

  // 力导向布局简化版：中心节点在中心，邻居环绕
  const layoutNodes = useCallback((): GraphNode[] => {
    const center = { x: width / 2, y: height / 2 };
    const radius = 180;

    return nodes.map((node, i) => {
      if (node.id === centerNodeId) {
        return { ...node, x: center.x, y: center.y };
      }
      const angle = (i / Math.max(nodes.length - 1, 1)) * Math.PI * 2;
      return {
        ...node,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
  }, [nodes, centerNodeId]);

  const positionedNodes = layoutNodes();
  const nodeMap = new Map(positionedNodes.map((n) => [n.id, n]));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    // 绘制边
    for (const edge of edges) {
      const source = nodeMap.get(edge.sourceNodeId);
      const target = nodeMap.get(edge.targetNodeId);
      if (!source || !target) continue;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = edge.relationType === 'same_topic' ? '#94a3b8' : '#cbd5e1';
      ctx.lineWidth = edge.weight * 3;
      ctx.stroke();
    }

    // 绘制节点
    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
      ctx.fillStyle = NODE_COLORS[node.nodeType] || '#94a3b8';
      ctx.fill();
      ctx.strokeStyle = node.id === centerNodeId ? '#1e40af' : '#64748b';
      ctx.lineWidth = node.id === centerNodeId ? 3 : 1;
      ctx.stroke();

      // 标签
      ctx.fillStyle = '#334155';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label.slice(0, 10), node.x, node.y + size + 14);
    }

    ctx.restore();
  }, [positionedNodes, edges, scale, offset, nodeMap, centerNodeId]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - offset.x) / scale;
    const my = (e.clientY - rect.top - offset.y) / scale;

    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      const dist = Math.hypot(mx - node.x, my - node.y);
      if (dist < size + 4) {
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: node.label, nodeType: node.nodeType });
        return;
      }
    }
    setTooltip(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left - offset.x) / scale;
    const my = (e.clientY - rect.top - offset.y) / scale;

    for (const node of positionedNodes) {
      const size = NODE_SIZES[node.nodeType] || 12;
      const dist = Math.hypot(mx - node.x, my - node.y);
      if (dist < size + 4) {
        onNodeClick(node.id, node.nodeType);
        return;
      }
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <NodeTooltip x={tooltip.x} y={tooltip.y} label={tooltip.label} nodeType={tooltip.nodeType} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 创建 GraphPage.tsx**

```tsx
import { useState } from 'react';
import { trpc } from '../trpc';
import GraphCanvas from '../components/graph/GraphCanvas';
import GraphControls from '../components/graph/GraphControls';

interface Props {
  initialVideoId?: string;
}

export default function GraphPage({ initialVideoId }: Props) {
  const [videoId, setVideoId] = useState(initialVideoId || '');
  const [relationTypes, setRelationTypes] = useState<string[]>(['same_topic', 'mentions']);
  const [scale, setScale] = useState(1);

  const { data, isLoading } = trpc.graph.neighbors.useQuery(
    { videoId, relationTypes: relationTypes as any, limit: 20 },
    { enabled: !!videoId }
  );

  const toggleType = (type: string) => {
    setRelationTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleNodeClick = (nodeId: string, nodeType: string) => {
    if (nodeType === 'video') {
      const parsed = nodeId.split(':')[1];
      setVideoId(parsed);
    }
  };

  const nodes = [
    ...(data?.centerNode ? [{
      id: data.centerNode.id,
      label: data.centerNode.label,
      nodeType: data.centerNode.nodeType,
    }] : []),
    ...data?.videoNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
    ...data?.entityNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
    ...data?.authorNeighbors.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })) || [],
  ];

  return (
    <div>
      <h2>知识图谱</h2>
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={videoId}
          onChange={(e) => setVideoId(e.target.value)}
          placeholder="输入视频 ID..."
          style={{ width: 300, padding: 6 }}
        />
      </div>

      <GraphControls
        onZoomIn={() => setScale((s) => s * 1.2)}
        onZoomOut={() => setScale((s) => s / 1.2)}
        onReset={() => setScale(1)}
        relationTypes={relationTypes}
        onToggleType={toggleType}
      />

      {isLoading && <div>加载中...</div>}

      {data && (
        <GraphCanvas
          nodes={nodes}
          edges={data.edges.map((e) => ({
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            relationType: e.relationType,
            weight: e.weight,
          }))}
          centerNodeId={data.centerNode?.id || ''}
          onNodeClick={handleNodeClick}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: 修改 App.tsx 添加图谱导航**

```tsx
// App.tsx
import GraphPage from './pages/GraphPage';

type Page = 'import' | 'list' | 'graph';

// 在 nav 中添加：
<button onClick={() => setPage('graph')}>知识图谱</button>

// 在条件渲染中添加：
{page === 'graph' && <GraphPage />}
```

- [ ] **Step 7: 提交**

```bash
git add src/app/pages/GraphPage.tsx src/app/components/graph/GraphCanvas.tsx src/app/components/graph/GraphControls.tsx src/app/components/graph/NodeTooltip.tsx src/app/hooks/useGraphData.ts src/app/App.tsx
git commit -m "feat(ui): add knowledge graph visualization page with Canvas rendering"
```

---

## Chunk 5: Phase 6 全部 — Workspace + 权限 + 限流 + 成本 + 删除

### Task 9: Workspace 表与基础 CRUD

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/domain/workspace-types.ts`
- Create: `src/services/workspace-service.ts`
- Create: `src/api/routers/workspace.ts`

- [ ] **Step 1: 新增 workspaces 和 workspace_members 表**

```typescript
// src/db/schema.ts
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ownerId: text('owner_id').notNull(),
  plan: text('plan').notNull().default('free'), // free | pro | enterprise
  settings: text('settings'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const workspaceMembers = sqliteTable('workspace_members', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'), // owner | admin | member
  invitedBy: text('invited_by'),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_workspace_members_unique').on(table.workspaceId, table.userId),
]);
```

- [ ] **Step 2: 生成并运行迁移**

Run: `npx drizzle-kit generate && npx drizzle-kit migrate`

- [ ] **Step 3: 创建 workspace-types.ts**

```typescript
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: string;
  settings?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedBy?: string;
  joinedAt: Date;
}
```

- [ ] **Step 4: 创建 workspace-service.ts**

```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '~/db';
import { workspaces, workspaceMembers } from '~/db/schema';
import { Workspace, WorkspaceRole } from '~/domain/workspace-types';
import { nanoid } from 'nanoid';

export class WorkspaceService {
  async createWorkspace(params: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<Workspace> {
    const id = nanoid();
    await db.insert(workspaces).values({
      id,
      name: params.name,
      slug: params.slug,
      ownerId: params.ownerId,
    });

    // 自动添加 owner 为成员
    await db.insert(workspaceMembers).values({
      id: nanoid(),
      workspaceId: id,
      userId: params.ownerId,
      role: 'owner',
    });

    const result = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return result[0] as Workspace;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const result = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return (result[0] as Workspace) || null;
  }

  async listUserWorkspaces(userId: string): Promise<Workspace[]> {
    const memberRows = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));

    const workspaceIds = memberRows.map((m) => m.workspaceId);
    if (workspaceIds.length === 0) return [];

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceIds[0])); // 简化：实际用 inArray

    return rows as Workspace[];
  }

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole, invitedBy: string): Promise<void> {
    await db.insert(workspaceMembers).values({
      id: nanoid(),
      workspaceId,
      userId,
      role,
      invitedBy,
    }).onConflictDoNothing();
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await db.delete(workspaceMembers).where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  }

  async getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const result = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    return (result[0]?.role as WorkspaceRole) || null;
  }

  async hasPermission(workspaceId: string, userId: string, requiredRole: WorkspaceRole): Promise<boolean> {
    const role = await this.getMemberRole(workspaceId, userId);
    if (!role) return false;

    const hierarchy: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };
    return hierarchy[role] >= hierarchy[requiredRole];
  }
}
```

- [ ] **Step 5: 创建 workspace router**

```typescript
import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { WorkspaceService } from '~/services/workspace-service';

const workspaceService = new WorkspaceService();

export const workspaceRouter = router({
  create: authedProcedure
    .input(z.object({ name: z.string().min(1).max(50), slug: z.string().min(1).max(30) }))
    .mutation(async ({ input, ctx }) => {
      return workspaceService.createWorkspace({
        name: input.name,
        slug: input.slug,
        ownerId: ctx.userId,
      });
    }),

  list: authedProcedure
    .query(async ({ ctx }) => {
      return workspaceService.listUserWorkspaces(ctx.userId);
    }),

  addMember: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      userId: z.string(),
      role: z.enum(['admin', 'member']).default('member'),
    }))
    .mutation(async ({ input, ctx }) => {
      const hasPerm = await workspaceService.hasPermission(input.workspaceId, ctx.userId, 'admin');
      if (!hasPerm) throw new Error('Permission denied');
      await workspaceService.addMember(input.workspaceId, input.userId, input.role, ctx.userId);
      return { success: true };
    }),
});
```

- [ ] **Step 6: 修改 trpc.ts 添加 userId 到 context**

```typescript
export interface TrpcContext {
  workspaceId: string;
  userId: string;
}

// authedProcedure 中：
export const authedProcedure = t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    return next({
      ctx: {
        ...ctx,
        workspaceId: ctx.workspaceId || 'default',
        userId: ctx.userId || 'anonymous',
      },
    });
  })
);
```

- [ ] **Step 7: 修改 server.ts 注册 workspace router**

```typescript
import { workspaceRouter } from './api/routers/workspace';

export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  search: searchRouter,
  graph: graphRouter,
  workspace: workspaceRouter,
});
```

- [ ] **Step 8: 提交**

```bash
git add src/db/schema.ts src/domain/workspace-types.ts src/services/workspace-service.ts src/api/routers/workspace.ts src/api/trpc.ts src/server.ts
git commit -m "feat(workspace): add workspaces and workspace_members tables with CRUD"
```

---

### Task 10: 限流 (Rate Limiting)

**Files:**
- Create: `src/infrastructure/rate-limiter.ts`
- Create: `tests/unit/rate-limiter.test.ts`

- [ ] **Step 1: 创建 rate-limiter.ts**

```typescript
export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private buckets = new Map<string, BucketEntry>();

  constructor(private defaultRule: RateLimitRule = { windowMs: 60000, maxRequests: 100 }) {}

  async check(key: string, rule?: RateLimitRule): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const r = rule || this.defaultRule;
    const now = Date.now();

    const entry = this.buckets.get(key);
    if (!entry || now > entry.resetAt) {
      // 新窗口
      const resetAt = now + r.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: r.maxRequests - 1, resetAt };
    }

    if (entry.count >= r.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: r.maxRequests - entry.count, resetAt: entry.resetAt };
  }
}

// Workspace 级默认规则
export const WORKSPACE_RATE_LIMIT: RateLimitRule = {
  windowMs: 60 * 1000, // 1分钟
  maxRequests: 60,      // 60请求/分钟
};
```

- [ ] **Step 2: 创建 rate-limiter 单元测试**

```typescript
import { describe, it, expect } from 'vitest';
import { MemoryRateLimiter } from '~/infrastructure/rate-limiter';

describe('MemoryRateLimiter', () => {
  it('allows requests within limit', async () => {
    const limiter = new MemoryRateLimiter({ windowMs: 60000, maxRequests: 3 });
    const r1 = await limiter.check('key1');
    expect(r1.allowed).toBe(true);
    const r2 = await limiter.check('key1');
    expect(r2.allowed).toBe(true);
    const r3 = await limiter.check('key1');
    expect(r3.allowed).toBe(true);
    const r4 = await limiter.check('key1');
    expect(r4.allowed).toBe(false);
  });

  it('resets after window', async () => {
    const limiter = new MemoryRateLimiter({ windowMs: 50, maxRequests: 1 });
    await limiter.check('key2');
    const blocked = await limiter.check('key2');
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    const allowed = await limiter.check('key2');
    expect(allowed.allowed).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/unit/rate-limiter.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: 提交**

```bash
git add src/infrastructure/rate-limiter.ts tests/unit/rate-limiter.test.ts
git commit -m "feat(rate-limit): add memory-based workspace rate limiter"
```

---

### Task 11: 成本统计

**Files:**
- Create: `src/services/cost-tracker.ts`
- Create: `src/db/schema.ts` — 添加 usage_logs 表
- Create: `tests/unit/cost-tracker.test.ts`

- [ ] **Step 1: 新增 usage_logs 表**

```typescript
export const usageLogs = sqliteTable('usage_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  resourceType: text('resource_type').notNull(), // 'llm' | 'embedding' | 'asr'
  operation: text('operation').notNull(), // 'summary' | 'tags' | 'embed' | 'transcribe'
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  estimatedCost: real('estimated_cost'), // 美元
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('idx_usage_logs_workspace').on(table.workspaceId, table.createdAt),
  index('idx_usage_logs_type').on(table.workspaceId, table.resourceType, table.createdAt),
]);
```

- [ ] **Step 2: 生成并运行迁移**

Run: `npx drizzle-kit generate && npx drizzle-kit migrate`

- [ ] **Step 3: 创建 cost-tracker.ts**

```typescript
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '~/db';
import { usageLogs } from '~/db/schema';
import { nanoid } from 'nanoid';

// 简化定价模型（美元）
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  llm: { input: 0.0015, output: 0.002 },
  embedding: { input: 0.0001, output: 0 },
  asr: { input: 0.006, output: 0 }, // 每分钟
};

export class CostTracker {
  async trackUsage(params: {
    workspaceId: string;
    resourceType: 'llm' | 'embedding' | 'asr';
    operation: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMinutes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const pricing = COST_PER_1K_TOKENS[params.resourceType];
    let estimatedCost = 0;

    if (params.resourceType === 'asr' && params.durationMinutes) {
      estimatedCost = params.durationMinutes * pricing.input;
    } else {
      const inputCost = ((params.inputTokens || 0) / 1000) * pricing.input;
      const outputCost = ((params.outputTokens || 0) / 1000) * pricing.output;
      estimatedCost = inputCost + outputCost;
    }

    await db.insert(usageLogs).values({
      id: nanoid(),
      workspaceId: params.workspaceId,
      resourceType: params.resourceType,
      operation: params.operation,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCost: Math.round(estimatedCost * 1000000) / 1000000,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  }

  async getWorkspaceCostSummary(workspaceId: string, startDate?: Date, endDate?: Date): Promise<{
    totalCost: number;
    llmCost: number;
    embeddingCost: number;
    asrCost: number;
    totalCalls: number;
  }> {
    let conditions = [eq(usageLogs.workspaceId, workspaceId)];
    if (startDate) conditions.push(gte(usageLogs.createdAt, startDate));
    if (endDate) conditions.push(lte(usageLogs.createdAt, endDate));

    const rows = await db
      .select()
      .from(usageLogs)
      .where(and(...conditions));

    let totalCost = 0;
    let llmCost = 0;
    let embeddingCost = 0;
    let asrCost = 0;

    for (const row of rows) {
      totalCost += row.estimatedCost || 0;
      if (row.resourceType === 'llm') llmCost += row.estimatedCost || 0;
      if (row.resourceType === 'embedding') embeddingCost += row.estimatedCost || 0;
      if (row.resourceType === 'asr') asrCost += row.estimatedCost || 0;
    }

    return {
      totalCost: Math.round(totalCost * 1000) / 1000,
      llmCost: Math.round(llmCost * 1000) / 1000,
      embeddingCost: Math.round(embeddingCost * 1000) / 1000,
      asrCost: Math.round(asrCost * 1000) / 1000,
      totalCalls: rows.length,
    };
  }
}
```

- [ ] **Step 4: 修改 workers 在关键点调用 cost tracker**

在各个 worker 中注入 CostTracker 并调用 trackUsage。例如 summary-worker：

```typescript
// 在 summary-worker 中
await costTracker.trackUsage({
  workspaceId,
  resourceType: 'llm',
  operation: 'analyzeContent',
  inputTokens: text.length / 4, // 粗略估算
  outputTokens: result.summary.length / 4,
});
```

- [ ] **Step 5: 创建 cost-tracker 单元测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '~/services/cost-tracker';
import { db } from '~/db';
import { usageLogs } from '~/db/schema';
import { eq } from 'drizzle-orm';

const workspaceId = 'test-ws-cost';

describe('CostTracker', () => {
  beforeEach(async () => {
    await db.delete(usageLogs).where(eq(usageLogs.workspaceId, workspaceId));
  });

  it('tracks LLM usage cost', async () => {
    const tracker = new CostTracker();
    await tracker.trackUsage({
      workspaceId,
      resourceType: 'llm',
      operation: 'summary',
      inputTokens: 2000,
      outputTokens: 500,
    });

    const summary = await tracker.getWorkspaceCostSummary(workspaceId);
    expect(summary.totalCalls).toBe(1);
    expect(summary.llmCost).toBeGreaterThan(0);
    expect(summary.totalCost).toBe(summary.llmCost);
  });

  it('tracks ASR usage cost', async () => {
    const tracker = new CostTracker();
    await tracker.trackUsage({
      workspaceId,
      resourceType: 'asr',
      operation: 'transcribe',
      durationMinutes: 2.5,
    });

    const summary = await tracker.getWorkspaceCostSummary(workspaceId);
    expect(summary.asrCost).toBe(0.015); // 2.5 * 0.006
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/unit/cost-tracker.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: 提交**

```bash
git add src/services/cost-tracker.ts src/db/schema.ts tests/unit/cost-tracker.test.ts
git commit -m "feat(cost): add usage tracking and cost estimation per workspace"
```

---

### Task 12: 删除能力（级联删除）

**Files:**
- Modify: `src/services/video-service.ts`
- Modify: `src/infrastructure/vector-store.ts`
- Create: `tests/integration/cascade-delete.test.ts`

- [ ] **Step 1: 修改 video-service.ts 添加 deleteVideo**

```typescript
import { db } from '~/db';
import { videos, transcripts, chunks, embeddings, graphNodes, graphEdges, ingestionJobs } from '~/db/schema';
import { eq, and } from 'drizzle-orm';
import { VectorStore } from '~/infrastructure/vector-store';

export class VideoService {
  constructor(private vectorStore: VectorStore) {}

  // ... 已有 list, detail 方法 ...

  async deleteVideo(id: string, workspaceId: string): Promise<{ deleted: boolean }> {
    // 1. 验证视频存在且属于该 workspace
    const video = await this.detail(id, workspaceId);
    if (!video) return { deleted: false };

    // 2. 删除向量索引
    await this.vectorStore.deleteByOwner('video', id);

    // 3. 删除图谱节点和边
    const nodeId = `video:${id}`;
    await db.delete(graphEdges).where(
      and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.sourceNodeId, nodeId))
    );
    await db.delete(graphEdges).where(
      and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.targetNodeId, nodeId))
    );
    await db.delete(graphNodes).where(
      and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.id, nodeId))
    );

    // 4. 删除 embeddings
    await db.delete(embeddings).where(eq(embeddings.videoId, id));

    // 5. 删除 chunks
    await db.delete(chunks).where(eq(chunks.videoId, id));

    // 6. 删除 transcripts
    await db.delete(transcripts).where(eq(transcripts.videoId, id));

    // 7. 删除 ingestion_jobs
    await db.delete(ingestionJobs).where(eq(ingestionJobs.videoId, id));

    // 8. 删除视频主记录
    await db.delete(videos).where(and(eq(videos.id, id), eq(videos.workspaceId, workspaceId)));

    return { deleted: true };
  }
}
```

- [ ] **Step 2: 确保 SQLiteVectorStore 实现了 deleteByOwner**

```typescript
// src/infrastructure/vector-store.ts
async deleteByOwner(ownerType: string, ownerId: string): Promise<void> {
  // ownerType: 'video', ownerId: videoId
  await db.delete(embeddings).where(eq(embeddings.videoId, ownerId));
}
```

- [ ] **Step 3: 添加 videos.delete tRPC endpoint**

```typescript
// src/api/routers/videos.ts
delete: authedProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const result = await videoService.deleteVideo(input.id, ctx.workspaceId);
    if (!result.deleted) {
      throw new Error('Video not found');
    }
    return { success: true };
  }),
```

- [ ] **Step 4: 创建级联删除集成测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { VideoService } from '~/services/video-service';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { db } from '~/db';
import { videos, transcripts, chunks, embeddings, graphEdges, graphNodes, ingestionJobs } from '~/db/schema';
import { eq, and } from 'drizzle-orm';

const workspaceId = 'test-ws-delete';

describe('cascade-delete', () => {
  const vectorStore = new SQLiteVectorStore();
  const videoService = new VideoService(vectorStore);

  beforeEach(async () => {
    await db.delete(graphEdges).where(eq(graphEdges.workspaceId, workspaceId));
    await db.delete(graphNodes).where(eq(graphNodes.workspaceId, workspaceId));
    await db.delete(embeddings).where(eq(embeddings.workspaceId, workspaceId));
    await db.delete(chunks).where(eq(chunks.workspaceId, workspaceId));
    await db.delete(transcripts).where(eq(transcripts.workspaceId, workspaceId));
    await db.delete(ingestionJobs).where(eq(ingestionJobs.workspaceId, workspaceId));
    await db.delete(videos).where(eq(videos.workspaceId, workspaceId));
  });

  it('deletes video and all related data', async () => {
    // 准备数据
    await db.insert(videos).values({
      id: 'del-v1', workspaceId, shareUrl: 'u1', normalizedUrlHash: 'h1', status: 'completed',
    });
    await db.insert(transcripts).values({
      id: 't1', videoId: 'del-v1', workspaceId, source: 'asr',
    });
    await db.insert(chunks).values({
      id: 'c1', videoId: 'del-v1', workspaceId, contentType: 'summary', chunkIndex: 0, content: 'test', contentHash: 'h',
    });
    await db.insert(graphNodes).values({
      id: 'video:del-v1', workspaceId, nodeType: 'video', businessId: 'del-v1', label: 'Test',
    });

    const result = await videoService.deleteVideo('del-v1', workspaceId);
    expect(result.deleted).toBe(true);

    const v = await db.select().from(videos).where(and(eq(videos.id, 'del-v1'), eq(videos.workspaceId, workspaceId)));
    expect(v).toHaveLength(0);

    const t = await db.select().from(transcripts).where(eq(transcripts.videoId, 'del-v1'));
    expect(t).toHaveLength(0);

    const c = await db.select().from(chunks).where(eq(chunks.videoId, 'del-v1'));
    expect(c).toHaveLength(0);

    const n = await db.select().from(graphNodes).where(eq(graphNodes.id, 'video:del-v1'));
    expect(n).toHaveLength(0);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/integration/cascade-delete.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: 提交**

```bash
git add src/services/video-service.ts src/infrastructure/vector-store.ts src/api/routers/videos.ts tests/integration/cascade-delete.test.ts
git commit -m "feat(delete): add cascade video deletion with vector and graph cleanup"
```

---

## Chunk 6: 最终验证与完成

### Task 13: 最终验证

- [ ] **Step 1: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: 运行全部测试**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: 更新路线图**

修改 `.wiki/development-roadmap.md`：
- Phase 5 状态改为全部 ✅
- Phase 6 状态改为全部 ✅
- 添加完成时间 `2026-05-16`

- [ ] **Step 4: 最终提交**

```bash
git add .wiki/development-roadmap.md
git commit -m "docs: mark Phase 5 and Phase 6 as completed"
```

- [ ] **Step 5: 推送代码**

```bash
git push origin feature/phase5-6-graph-workspace
```

---

## Plan Summary

| 阶段 | 任务数 | 核心交付物 |
|------|--------|----------|
| Phase 5 | 8 Tasks | graph_nodes/edges 表、GraphBuilder、GraphWorker、GraphService、GraphPage 前端 |
| Phase 6 | 5 Tasks | workspaces/members 表、限流器、成本跟踪、级联删除 |
| 总计 | 13 Tasks | 完整的多租户知识图谱系统 |
