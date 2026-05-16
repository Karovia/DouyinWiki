# 知识图谱设计方案

## 1. 概述与定位

知识图谱是抖音 Wiki 从「视频收藏夹」升级为「知识资产管理系统」的核心差异化能力。它通过提取视频中的实体（技术、概念、人物等）并建立视频间的关联关系，实现：

- **关联发现**：观看某视频时自动推荐主题相关、实体相关的视频
- **语义增强**：RAG 问答时通过实体关联补充向量召回的盲区
- **知识导航**：以实体为枢纽探索不同视频围绕同一主题的多元观点

### 1.1 设计边界

| 能力 | 本期支持 | 说明 |
|------|----------|------|
| 自动关系建立 | `mentions`（video→entity）、`same_topic`（video↔video，TopK 限量） | 避免边数量爆炸 |
| `same_author` | 不物化 video-video 边，引入 `author` 节点建立 video→author 关系 | 动态查询同作者视频 |
| `same_entity` | 不物化 video-video 边 | 使用二跳动态查询：video→entity→video |
| 用户手动关系 | 暂不实现 | 未来支持 `prerequisite` / `follow_up` / `user_tagged` |
| 图谱深度 | 一跳邻居实时加载，二跳按需加载 | 避免大数据量下的性能问题 |
| 实体消歧 | 内置别名表 + 精确匹配 | MVP 阶段不做 Embedding 语义消歧 |
| 图算法 | 邻居查询、实体关联统计 | 不做最短路径、社区发现、PageRank |

### 1.2 架构位置

知识图谱在整体架构中的位置：

```
用户提交链接 → 创建 import_job
  → 解析元数据 → 提取内容 → ASR / OCR → Chunk 化
  → 摘要与标签 → 【实体抽取】→ Embedding → 向量入库
                                          ↓
                                    Graph Edge Generation
                                          ↓
                                    Graph Storage (graph_nodes + graph_edges)
                                          ↓
                              ┌──────────┼──────────┐
                              ↓          ↓          ↓
                        graph.neighbors  graph.search  RAG 增强召回
```

### 1.3 关键设计原则

1. **确定性节点 ID**：节点 ID 由业务键生成，避免随机 ID 与业务 ID 混用
2. **无向边归一化**：无向关系写入前统一排序节点 ID，避免双向重复边
3. **边数量控制**：`same_topic` 严格 TopK 限制；`same_author` / `same_entity` 不物化 video-video 边
4. **图谱异步增强**：图谱构建不阻塞视频主流程完成，`graph_building` 为独立异步状态
5. **幂等写入**：所有图谱操作使用 upsert，Worker 失败可安全重试

---

## 2. 数据模型

### 2.1 核心原则

- 所有业务表必须包含 `workspace_id`
- 数据库表名使用 `snake_case`，TypeScript 接口使用 `PascalCase`
- 分表存储：节点、边、别名独立表，生命周期不同
- 节点 ID 使用**确定性 ID**，避免 nanoid 与业务 ID 混用

### 2.2 确定性节点 ID 生成

```typescript
// src/domain/graph-ids.ts
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

### 2.3 graph_nodes 表

```typescript
// src/db/schema.ts
export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),                    // 确定性 ID: video:{id} / entity:{key} / author:{id}
  workspaceId: text('workspace_id').notNull(),

  // 节点类型：video | entity | author
  nodeType: text('node_type').notNull(),

  // 业务原始标识
  businessId: text('business_id').notNull(),      // video_id / 实体标准化名称 / author_id

  // 实体标准化键（仅 entity 类型使用）
  canonicalKey: text('canonical_key'),

  // 节点显示名称
  label: text('label').notNull(),

  // 节点额外属性（JSON）
  properties: text('properties'),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

**索引设计**：

```sql
CREATE UNIQUE INDEX idx_graph_nodes_unique
ON graph_nodes(workspace_id, node_type, business_id);

CREATE INDEX idx_graph_nodes_workspace_type
ON graph_nodes(workspace_id, node_type);
```

### 2.4 graph_edges 表

```typescript
export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),

  // 有向边：source → target
  // 无向关系（same_topic）写入前统一排序节点 ID
  sourceNodeId: text('source_node_id').notNull(),
  targetNodeId: text('target_node_id').notNull(),

  // 关系类型
  relationType: text('relation_type').notNull(),

  // 关系强度（0.0 - 1.0）
  weight: real('weight').notNull().default(0.5),

  // 生成策略
  computedBy: text('computed_by').notNull(),

  // 关系证据（JSON 数组）
  evidence: text('evidence'),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

**索引设计**（贴合真实查询模式）：

```sql
-- 防止无向关系重复（A→B 与 B→A）
CREATE UNIQUE INDEX idx_graph_edges_unique
ON graph_edges(workspace_id, source_node_id, target_node_id, relation_type);

-- 邻居查询：source + type + weight 排序
CREATE INDEX idx_edges_source_type_weight
ON graph_edges(workspace_id, source_node_id, relation_type, weight DESC);

-- 邻居查询：target + type + weight 排序（反向邻居）
CREATE INDEX idx_edges_target_type_weight
ON graph_edges(workspace_id, target_node_id, relation_type, weight DESC);

-- 按关系类型筛选 + weight 排序
CREATE INDEX idx_edges_relation_weight
ON graph_edges(workspace_id, relation_type, weight DESC);

-- mentions 关系的实体反向查询
CREATE INDEX idx_mentions_entity
ON graph_edges(workspace_id, target_node_id, relation_type, weight DESC);
```

### 2.5 无向边归一化

对于 `same_topic` 等无向关系，写入前统一排序节点 ID，避免 A→B 与 B→A 双向重复：

```typescript
// src/domain/graph-utils.ts
export function normalizeUndirectedEdge(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// 使用示例
const [sourceNodeId, targetNodeId] = normalizeUndirectedEdge(
  videoNodeId(videoA),
  videoNodeId(videoB)
);
```

### 2.6 entity_aliases 表（别名表从代码迁移到数据库）

```typescript
export const entityAliases = sqliteTable('entity_aliases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),

  // 别名原文
  alias: text('alias').notNull(),

  // 指向的标准化实体节点 ID
  canonicalNodeId: text('canonical_node_id').notNull(),

  // 别名来源
  source: text('source').notNull(), // builtin | user_added | auto_detected

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

**索引设计**：

```sql
CREATE INDEX idx_entity_aliases_lookup
ON entity_aliases(workspace_id, alias);

CREATE INDEX idx_entity_aliases_canonical
ON entity_aliases(workspace_id, canonical_node_id);
```

### 2.7 关系类型与物化策略

| 关系类型 | 方向 | 是否物化 | 物化策略 |
|----------|------|----------|----------|
| `mentions` | 有向（video→entity/author） | **是** | 核心事实，每条视频提取的实体直接写入 |
| `same_topic` | 无向（video↔video） | **是** | 严格 TopK 限制（默认 5），minSimilarity 0.75 |
| `same_author` | 不物化 video-video | **否** | 动态查询 `videos` 表 `author_id`；或展示时通过 `author` 节点关联 |
| `same_entity` | 不物化 video-video | **否** | 二跳动态查询：video→entity→video |

---

## 3. 边生成算法

### 3.1 核心策略：增量生成 + 严格控制边数量

| 策略 | 触发时机 | 计算复杂度 | 说明 |
|------|----------|-----------|------|
| 增量 TopK | 新视频入库时 | O(N)，N = workspace 视频数 | 新视频与全库已有视频计算相似度，严格 TopK 上限 |
| mentions | 实体抽取后 | O(E)，E = 实体数 | video→entity / video→author 有向边 |
| 全局重算 | 每周 / 每 500 条新视频 | O(N × K) | 淘汰过时边，更新权重 |

### 3.2 same_topic 边生成（限量物化）

```typescript
// src/domain/graph-builder.ts
interface GraphBuilderConfig {
  topK: number;              // 默认 5
  minSimilarity: number;     // 默认 0.75
}

export class GraphBuilder {
  constructor(
    private vectorStore: VectorStore,
    private config: GraphBuilderConfig
  ) {}

  async generateTopicEdges(
    workspaceId: string,
    videoId: string,
    videoEmbedding: number[]
  ): Promise<GraphEdge[]> {
    // Step 1: 向量召回 TopK 相似视频（排除自身）
    const candidates = await this.vectorStore.search({
      workspaceId,
      queryEmbedding: videoEmbedding,
      topK: this.config.topK * 2,
      filters: {
        ownerType: 'video',
        excludeOwnerId: videoId,
      },
    });

    const edges: GraphEdge[] = [];

    for (const hit of candidates) {
      if (hit.score < this.config.minSimilarity) continue;

      // Step 2: 无向边归一化
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
        evidence: JSON.stringify([
          { type: 'cosine_similarity', score: hit.score }
        ]),
      });
    }

    return edges.slice(0, this.config.topK);
  }
}
```

### 3.3 mentions 边生成（核心物化边）

```typescript
async generateMentionsEdges(
  workspaceId: string,
  videoId: string,
  resolvedEntities: ResolvedEntity[],
  authorId?: string
): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];
  const videoNode = videoNodeId(videoId);

  // 1. video → entity mentions
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

  // 2. video → author（如果作者信息存在）
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
```

### 3.4 same_author 动态查询（不物化 video-video 边）

```typescript
// src/services/graph-service.ts
async getSameAuthorVideos(
  workspaceId: string,
  videoId: string,
  authorId: string,
  limit: number = 10
): Promise<Video[]> {
  return db
    .select()
    .from(videos)
    .where(
      and(
        eq(videos.workspaceId, workspaceId),
        eq(videos.authorId, authorId),
        ne(videos.id, videoId)
      )
    )
    .orderBy(desc(videos.createdAt))
    .limit(limit);
}
```

### 3.5 same_entity 动态查询（不物化 video-video 边）

通过二跳查询实现：先找视频提到的实体，再找提到同一实体的其他视频。

```typescript
async getSameEntityVideos(
  workspaceId: string,
  videoId: string,
  limit: number = 10
): Promise<{ video: Video; sharedEntities: string[] }[]> {
  // Step 1: 获取该视频提到的所有实体
  const mentions = await db
    .select({ targetNodeId: graphEdges.targetNodeId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.workspaceId, workspaceId),
        eq(graphEdges.sourceNodeId, videoNodeId(videoId)),
        eq(graphEdges.relationType, 'mentions')
      )
    );

  const entityNodeIds = mentions.map((m) => m.targetNodeId);
  if (entityNodeIds.length === 0) return [];

  // Step 2: 查找提到这些实体的其他视频
  const otherMentions = await db
    .select({
      sourceNodeId: graphEdges.sourceNodeId,
      targetNodeId: graphEdges.targetNodeId,
    })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.workspaceId, workspaceId),
        inArray(graphEdges.targetNodeId, entityNodeIds),
        eq(graphEdges.relationType, 'mentions'),
        ne(graphEdges.sourceNodeId, videoNodeId(videoId))
      )
    );

  // Step 3: 按共享实体数量聚合
  const videoEntityMap = new Map<string, Set<string>>();
  for (const m of otherMentions) {
    const otherVideoId = parseNodeId(m.sourceNodeId).businessId;
    if (!videoEntityMap.has(otherVideoId)) {
      videoEntityMap.set(otherVideoId, new Set());
    }
    videoEntityMap.get(otherVideoId)!.add(m.targetNodeId);
  }

  // Step 4: 获取视频详情并排序（共享实体越多越靠前）
  const sortedEntries = [...videoEntityMap.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, limit);

  // ... 获取视频详情
}
```

---

## 4. 实体抽取与标准化

### 4.1 在流水线中的位置

实体抽取复用 `SummaryWorker` 的 LLM 调用，在生成摘要的同时输出实体列表，**不增加额外 API 调用**：

```
summarizing ──→ 一次 LLM 调用产出：summary + tags + entities
                    ↓
            entity resolution（标准化名称 + 消歧）
                    ↓
            embedding → indexing → graph_updating
```

### 4.2 实体类型

```typescript
export type EntityType =
  | 'person'        // 人物：博主、专家、名人
  | 'technology'    // 技术：React、TypeScript、Docker
  | 'concept'       // 概念：微前端、RAG、响应式设计
  | 'company'       // 公司/组织：字节跳动、Vercel
  | 'product'       // 产品：抖音、VS Code
  | 'domain';       // 领域：前端开发、人工智能

export interface ExtractedEntity {
  name: string;           // 标准化名称
  originalText: string;   // 原文写法
  type: EntityType;
  confidence: number;     // 0.0 - 1.0
}
```

### 4.3 LLM Prompt 设计

复用摘要阶段的 LLM 调用，输出格式扩展：

```json
{
  "summary": "200字以内的中文摘要",
  "tags": ["标签1", "标签2"],
  "entities": [
    {
      "name": "React",
      "originalText": "React 18",
      "type": "technology",
      "confidence": 0.95
    }
  ]
}
```

**抽取规则**：
- `name` 使用最通用标准化名称，如 "React" 而非 "React 18"
- 不过于宽泛（排除"视频"、"内容"等无意义词）
- `confidence > 0.6` 才返回
- 最多返回 10 个实体

### 4.4 实体标准化流程

```typescript
// src/domain/entity-resolver.ts
export class EntityResolver {
  async resolveEntity(
    workspaceId: string,
    rawName: string
  ): Promise<{ canonicalKey: string; isNew: boolean }> {
    // Step 1: Unicode 归一化 + 清洗
    const normalized = this.normalizeText(rawName);

    // Step 2: 查询别名表
    const aliasMatch = await db
      .select({ canonicalNodeId: entityAliases.canonicalNodeId })
      .from(entityAliases)
      .where(
        and(
          eq(entityAliases.workspaceId, workspaceId),
          eq(entityAliases.alias, normalized)
        )
      )
      .limit(1);

    if (aliasMatch[0]) {
      const { businessId } = parseNodeId(aliasMatch[0].canonicalNodeId);
      return { canonicalKey: businessId, isNew: false };
    }

    // Step 3: 查询已有实体节点（精确匹配 canonical_key）
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

    if (existing[0]) {
      return { canonicalKey: existing[0].canonicalKey!, isNew: false };
    }

    // Step 4: 新实体
    return { canonicalKey: normalized, isNew: true };
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_\.]+/g, '');
  }
}
```

### 4.5 冷启动别名初始化

```typescript
// src/db/seed-entity-aliases.ts
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

    // 插入实体节点
    await db.insert(graphNodes).values({
      id: canonicalNodeId,
      workspaceId,
      nodeType: 'entity',
      businessId: canonical,
      canonicalKey: canonical,
      label: canonical,
    }).onConflictDoNothing();

    // 插入别名
    for (const alias of aliases) {
      await db.insert(entityAliases).values({
        id: nanoid(),
        workspaceId,
        alias: alias.toLowerCase().replace(/[\s\-_\.]+/g, ''),
        canonicalNodeId,
        source: 'builtin',
      }).onConflictDoNothing();
    }
  }
}
```

**设计决策**：
- 别名表存储在数据库中，支持运行时扩展
- 冷启动内置 50-100 个常见技术别名
- 新实体不自动合并，原样入库
- 低置信度消歧进入 `pending`，不自动合并（待后续人工审核机制）

---

## 5. 存储与查询方案

### 5.1 选型决策：SQLite 关系型表

MVP 阶段使用 SQLite 存储图谱数据，通过合理索引和边数量控制满足查询性能：

| 场景 | 预期数据量 | 查询性能 | 方案 |
|------|-----------|----------|------|
| 一跳邻居查询 | TopK ≤ 5 / video | < 10ms | SQLite + 复合索引 |
| 实体反向查询 | mentions ≤ 10 / video | < 10ms | SQLite + 复合索引 |
| 同作者动态查询 | 直接查 videos 表 | < 10ms | 不经过边表 |
| 同实体动态查询 | 二跳查询 | < 100ms | 两次索引查询 |
| 大图算法 | — | 不适用 | MVP 阶段不做 |

**引入图数据库的触发条件**（满足任一）：
- 边数量 > 500 万
- 单实体关联视频 > 1 万
- 二跳查询 P95 > 500ms
- RAG 图谱扩展 P95 > 1s
- 需要社区发现 / 最短路径 / PageRank 等复杂图算法

### 5.2 核心查询 API

```typescript
// src/api/routers/graph.ts
export const graphRouter = router({
  // 获取某视频的一跳邻居（图谱页默认加载）
  neighbors: authedProcedure
    .input(
      z.object({
        videoId: z.string(),
        relationTypes: z.array(
          z.enum(['same_topic', 'mentions'])
        ).optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      return graphService.getNeighbors({
        workspaceId: ctx.workspaceId,
        videoId: input.videoId,
        relationTypes: input.relationTypes,
        limit: input.limit,
      });
    }),

  // 语义图搜索：输入关键词，返回相关视频 + 关联实体
  search: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100),
        limit: z.number().min(1).max(20).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      return graphService.semanticSearch({
        workspaceId: ctx.workspaceId,
        query: input.query,
        limit: input.limit,
      });
    }),
});
```

### 5.3 一跳邻居查询实现

```typescript
// src/services/graph-service.ts
export class GraphService {
  async getNeighbors(params: {
    workspaceId: string;
    videoId: string;
    relationTypes?: string[];
    limit: number;
  }): Promise<NeighborResult> {
    const { workspaceId, videoId, relationTypes, limit } = params;
    const nodeId = videoNodeId(videoId);

    // 查询出边（source = videoId）
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

    // 查询入边（target = videoId）—— 仅针对无向关系 same_topic
    const incomingConditions = [
      eq(graphEdges.workspaceId, workspaceId),
      eq(graphEdges.targetNodeId, nodeId),
      eq(graphEdges.relationType, 'same_topic'),
    ];

    const incomingEdges = await db
      .select()
      .from(graphEdges)
      .where(and(...incomingConditions))
      .orderBy(desc(graphEdges.weight))
      .limit(limit);

    // 获取邻居节点详情
    const neighborNodeIds = [
      ...outgoingEdges.map((e) => e.targetNodeId),
      ...incomingEdges.map((e) => e.sourceNodeId),
    ];
    const uniqueNodeIds = [...new Set(neighborNodeIds)];

    const nodes = uniqueNodeIds.length > 0
      ? await db
          .select()
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.workspaceId, workspaceId),
              inArray(graphNodes.id, uniqueNodeIds)
            )
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
}
```

---

## 6. 图谱与 RAG 融合

### 6.1 核心原则：图谱召回作为候选扩展，不直接混合排序

向量分数与图谱分数不是同一量纲，直接混合排序会导致上下文质量不可控。

### 6.2 推荐融合流程

```
用户问题
    ↓
向量召回 TopK chunks（主路径）
    ↓
从命中 chunks 中提取 seed videos / seed entities
    ↓
图谱扩展：查找与 seed videos/entities 相关的其他 videos
    ↓
在扩展视频范围内做二次 chunk-level 检索
    ↓
统一 rerank（统一打分公式）
    ↓
生成最终 TopK 上下文
```

### 6.3 统一打分公式

```typescript
// src/domain/rag-pipeline.ts
function calculateFinalScore(params: {
  vectorScore: number;
  graphScore: number;
  entityMatchScore: number;
  recencyScore: number;
}): number {
  const { vectorScore, graphScore, entityMatchScore, recencyScore } = params;

  return (
    0.65 * normalizeVectorScore(vectorScore) +
    0.20 * graphScore +
    0.10 * entityMatchScore +
    0.05 * recencyScore
  );
}
```

### 6.4 配额限制

```typescript
const RAG_GRAPH_CONFIG = {
  maxGraphOnlyChunks: 0.3,      // 图谱召回 chunks 不超过总量的 30%
  maxChunksPerVideo: 2,         // 每个视频最多贡献 2 个 chunks
  maxExpansionVideos: 10,       // 图谱扩展最多 10 个视频
};
```

### 6.5 实现

```typescript
export class RAGPipeline {
  async retrieveContext(params: {
    workspaceId: string;
    query: string;
    topK: number;
  }): Promise<RAGContext[]> {
    const { workspaceId, query, topK } = params;

    // Step 1: 向量召回（主路径）
    const queryEmbedding = await this.embeddingClient.embed(query);
    const vectorHits = await this.vectorStore.search({
      workspaceId,
      queryEmbedding,
      topK: topK * 2,
    });

    // Step 2: 从向量命中提取 seed videos 和 entities
    const seedVideoIds = [...new Set(vectorHits.map((h) => h.videoId))];
    const seedEntities = await this.extractEntitiesFromQuery(query);

    // Step 3: 图谱扩展相关视频
    const expandedVideos = await this.expandByGraph(
      workspaceId,
      seedVideoIds,
      seedEntities
    );

    // Step 4: 在扩展视频范围内二次检索 chunks
    const expandedChunks = await this.vectorStore.search({
      workspaceId,
      queryEmbedding,
      topK: Math.floor(topK * RAG_GRAPH_CONFIG.maxGraphOnlyChunks),
      filters: {
        videoIds: expandedVideos,
      },
    });

    // Step 5: 合并去重
    const allCandidates = [...vectorHits, ...expandedChunks];
    const uniqueCandidates = deduplicateByChunkId(allCandidates);

    // Step 6: 统一 rerank
    const ranked = uniqueCandidates
      .map((c) => ({
        ...c,
        finalScore: calculateFinalScore({
          vectorScore: c.score,
          graphScore: this.calculateGraphScore(c, expandedVideos),
          entityMatchScore: this.calculateEntityMatchScore(c, seedEntities),
          recencyScore: this.calculateRecencyScore(c),
        }),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    return ranked.slice(0, topK);
  }

  private async extractEntitiesFromQuery(query: string): Promise<string[]> {
    // 优先使用规则匹配，不调用 LLM
    // 1. 别名表精确匹配
    const aliases = await this.matchAliases(query);
    if (aliases.length > 0) return aliases;

    // 2. 简单分词 + 实体词典匹配
    const tokens = this.tokenizeQuery(query);
    const matches = await this.matchEntityDictionary(tokens);
    if (matches.length > 0) return matches;

    // 3. 无结果时 fallback 到 LLM（低概率触发）
    return this.llmClient.extractEntities({ title: query, summary: query })
      .then((entities) => entities.map((e) => e.name));
  }
}
```

---

## 7. 前端可视化

### 7.1 性能优化策略

| 优化点 | 实现方式 |
|--------|----------|
| 力导向布局计算 | Web Worker，避免阻塞主线程 |
| 初始加载 | 只加载一跳邻居（same_topic + mentions） |
| 节点展开 | 点击节点时异步加载二跳邻居 |
| 大图谱 | 超过 100 节点时启用聚合（按作者/类型分组） |
| 渲染层 | Canvas 2D（D3.js force simulation + Canvas rendering） |

### 7.2 交互设计

```
默认状态：
┌──────────────────────────────────────────────────────┐
│                                                      │
│          [中心视频节点] ←── same_topic ──→ [邻居视频1] │
│                ↓                                     │
│          mentions                                    │
│                ↓                                     │
│        [实体: "React"]                               │
│                ↓                                     │
│        [邻居视频2]（也提到 React）                    │
│                                                      │
│  [筛选: ☑ same_topic ☑ mentions]                    │
│                                                      │
│  同作者视频: [视频3] [视频4] ...（动态查询）          │
└──────────────────────────────────────────────────────┘

交互行为：
- 点击视频节点：跳转视频详情页
- 点击实体节点：高亮所有提到该实体的视频
- 拖拽节点：调整布局
- 滚轮/双指：缩放画布
- 双击空白：回到中心节点
```

### 7.3 组件结构

```
src/app/
├── pages/
│   └── GraphPage.tsx
├── components/graph/
│   ├── GraphCanvas.tsx        # Canvas 渲染层
│   ├── GraphControls.tsx      # 缩放/重置/筛选控件
│   ├── GraphLegend.tsx        # 图例
│   └── NodeTooltip.tsx        # 悬停提示
└── hooks/
    ├── useGraphData.ts        # graph.neighbors 数据获取
    ├── useForceLayout.ts      # Web Worker 力导向计算
    └── useGraphInteraction.ts # 交互逻辑
```

---

## 8. GraphWorker 流水线

### 8.1 独立异步状态设计

图谱构建不阻塞视频主流程完成。视频到达 `indexing` 后标记 `completed`，图谱构建作为独立异步任务：

```
created → parsing_metadata → ... → indexing → completed
                                                  ↘ graph_building async
```

```typescript
// videos 表扩展
export const videos = sqliteTable('videos', {
  // ... 已有字段

  // 新增：独立图谱状态
  graphStatus: text('graph_status').notNull().default('pending'),
  graphError: text('graph_error'),
  graphBuiltAt: integer('graph_built_at', { mode: 'timestamp' }),
});
```

### 8.2 Worker 注册（幂等写入）

```typescript
// src/workers/graph-worker.ts
export function registerGraphWorker(
  queue: MemoryQueue,
  graphBuilder: GraphBuilder
) {
  queue.register('graph_building', async (job) => {
    const { videoId, workspaceId } = job.payload;

    // 更新视频图谱状态
    await db.update(videos)
      .set({ graphStatus: 'building', updatedAt: new Date() })
      .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)));

    try {
      // 1. 获取视频 Embedding
      const videoEmbedding = await getVideoEmbedding(videoId);

      // 2. 生成 same_topic 边（限量 TopK，无向边归一化）
      const topicEdges = await graphBuilder.generateTopicEdges(
        workspaceId, videoId, videoEmbedding
      );
      await upsertEdges(topicEdges);

      // 3. 获取实体抽取结果，生成 mentions 边
      const { entities, authorId } = await getExtractedEntities(videoId);
      const resolvedEntities = await resolveEntities(workspaceId, entities);

      // 4. 确保 entity / author 节点存在
      await upsertEntityNodes(workspaceId, resolvedEntities);
      if (authorId) {
        await upsertAuthorNode(workspaceId, authorId);
      }

      // 5. 生成 mentions 边（video→entity / video→author）
      const mentionEdges = await graphBuilder.generateMentionsEdges(
        workspaceId, videoId, resolvedEntities, authorId
      );
      await upsertEdges(mentionEdges);

      // 6. 更新成功状态
      await db.update(videos)
        .set({ graphStatus: 'ready', graphBuiltAt: new Date(), updatedAt: new Date() })
        .where(eq(videos.id, videoId));
    } catch (err) {
      await db.update(videos)
        .set({
          graphStatus: 'failed',
          graphError: err instanceof Error ? err.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(videos.id, videoId));
    }
  });
}

// 幂等写入：边使用 upsert，避免重复和失败重试问题
async function upsertEdges(edges: GraphEdge[]): Promise<void> {
  if (edges.length === 0) return;

  await db.insert(graphEdges)
    .values(edges)
    .onConflictDoUpdate({
      target: [
        graphEdges.workspaceId,
        graphEdges.sourceNodeId,
        graphEdges.targetNodeId,
        graphEdges.relationType,
      ],
      set: {
        weight: sql`excluded.weight`,
        evidence: sql`excluded.evidence`,
        updatedAt: new Date(),
      },
    });
}
```

### 8.3 幂等保障清单

| 保障点 | 实现方式 |
|--------|----------|
| 节点 ID 确定性 | `video:{videoId}` / `entity:{canonicalKey}` / `author:{authorId}` |
| 边唯一键 | `(workspace_id, source_node_id, target_node_id, relation_type)` |
| 写入方式 | `INSERT ... ON CONFLICT DO UPDATE` |
| 失败重试 | 安全，不会重复写入 |
| 图谱状态独立 | `videos.graph_status` 字段，不影响视频主流程 |

---

## 9. 与现有系统的集成点

### 9.1 数据库 Schema 变更

新增表：
- `graph_nodes`：节点表（确定性 ID）
- `graph_edges`：边表（无向边归一化 + 复合索引）
- `entity_aliases`：别名表（支持运行时扩展）

`videos` 表扩展：
- `graph_status`：图谱构建状态
- `graph_error`：构建错误信息
- `graph_built_at`：构建完成时间

### 9.2 LLMClient 接口扩展

```typescript
// src/infrastructure/llm-client.ts
export interface LLMClient {
  generateSummary(text: string): Promise<string>;
  generateTags(text: string): Promise<string[]>;
  // 新增：一次调用返回摘要 + 标签 + 实体
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

### 9.3 SummaryWorker 修改

复用 LLM 调用，在一次请求中产出摘要、标签、实体三个产物：

```typescript
// src/workers/summary-worker.ts
const result = await llm.analyzeContent({ title, transcript });
await saveSummary(videoId, result.summary, result.tags);
await saveEntities(videoId, result.entities);
```

### 9.4 新增 API Router

```typescript
// src/api/routers/graph.ts
export const graphRouter = router({
  neighbors: authedProcedure...
  search: authedProcedure...
});

// src/server.ts
export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  graph: graphRouter,  // 新增
});
```

---

## 10. 开发里程碑

| 阶段 | 工作内容 | 预计工时 |
|------|----------|----------|
| 1. 数据库 Schema | `graph_nodes` / `graph_edges` / `entity_aliases` + 复合索引 | 3h |
| 2. 确定性 ID | `graph-ids.ts` + 无向边归一化工具 | 1h |
| 3. 实体抽取 | LLM Prompt 改造 + `EntityResolver` + 别名表入库 | 4h |
| 4. 边生成 | `GraphBuilder`（same_topic TopK + mentions） | 3h |
| 5. GraphWorker | 异步独立状态 + 幂等 upsert + 不阻塞 completed | 3h |
| 6. 查询 API | `graph.neighbors` / `graph.search` + 动态查询 | 3h |
| 7. RAG 融合 | 候选扩展 + rerank + 配额限制 | 3h |
| 8. 前端图谱页 | Canvas 渲染 + 力导向 + 交互 | 8h |
| **合计** | | **约 28 工时** |

---

## 11. 风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| 实体抽取质量不稳定 | 中 | same_entity 动态查询效果差 | 内置别名表 + confidence 阈值过滤 + 用户可手动补充标签 |
| 高频实体造成查询性能下降 | 低 | 二跳查询变慢 | 单实体关联视频 > 1 万时触发预警，引入图数据库 |
| 前端大图谱卡顿 | 中 | 用户体验差 | 一跳加载 + Canvas 渲染 + 聚合节点 |
| 边数量失控 | 低 | SQLite 膨胀 | same_topic TopK 限制 + same_author/same_entity 不物化 |
| GraphWorker 重试导致状态不一致 | 低 | 边重复或缺失 | 确定性 ID + upsert + 独立 graph_status |

---

## 附录 A：与现有规范的兼容性检查

| 规范 | 本方案遵循情况 |
|------|---------------|
| **分层架构** | `GraphBuilder` 位于 Domain Service，`GraphService` 位于 Application Service，`GraphWorker` 位于 Worker 层，API Router 位于 Gateway 层 |
| **接口抽象** | `GraphBuilder` 依赖 `VectorStore` 接口，不依赖具体实现 |
| **多租户隔离** | 所有表含 `workspace_id`，所有查询强制过滤 |
| **命名规范** | 表名 `graph_nodes` / `graph_edges`（snake_case 复数），接口 `GraphBuilder` / `GraphService`（PascalCase） |
| **状态机** | `graph_building` 为独立异步状态，不阻塞 `completed`；`videos.graph_status` 独立追踪 |
| **幂等设计** | 节点确定性 ID + 边 upsert + 唯一索引 |
| **错误码** | 图相关错误使用 `GRAPH_` 前缀（待补充到 `errors.ts`） |
| **分表原则** | `graph_nodes` / `graph_edges` / `entity_aliases` 独立表，生命周期不同 |
| **索引设计** | 复合索引贴合真实查询模式（source+type+weight / target+type+weight） |

---

## 附录 B：审查问题修复对照

| 审查问题 | 严重级别 | 修复方式 |
|----------|----------|----------|
| 节点 ID 与边引用 ID 不一致 | P0 | 采用确定性节点 ID：`video:{id}` / `entity:{key}` |
| `same_entity` 边数量爆炸 | P0 | 不物化 video-video 边，改用二跳动态查询 |
| `same_author` 边数量爆炸 | P0 | 不物化 video-video 边，引入 `author` 节点做 video→author，同作者视频动态查询 |
| 有向边和无向边混用 | P1 | 无向关系写入前统一排序节点 ID |
| RAG 融合分数不可比 | P1 | 图谱召回作为候选扩展，统一 rerank 公式 |
| 查询阶段调用 LLM | P1 | 查询阶段优先规则匹配，LLM 作为 fallback |
| 实体消歧方案过弱 | P1 | 别名表从代码迁移到数据库，增加标准化流程 |
| GraphWorker 缺少幂等 | P1 | 确定性 ID + upsert + 独立 `graph_status` |
| 索引设计不贴合查询 | P1 | 增加复合索引（source+type+weight / target+type+weight） |
| `neighbor_count` 实时维护 | P2 | 删除该字段，MVP 阶段不做冗余统计 |
| SQLite 扩展条件 | P2 | 触发条件改为边数量、查询 P95、复杂算法需求 |
