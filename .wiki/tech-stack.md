# 技术栈

## 1. 总体架构

系统采用事件驱动的分层架构。在线 API 负责接收请求、返回任务状态和查询结果；异步 Worker 负责解析、转写、摘要、向量化和图谱计算；存储层拆分为业务数据库、向量数据库、对象存储和缓存。

| 层级 | 组件 |
|------|------|
| 客户端层 | React Web、移动端 H5、浏览器插件（可选） |
| API 层 | Hono、tRPC、Auth / Workspace、Rate Limit |
| 任务层 | Job Queue、Retry、Dead Letter、Idempotency |
| Worker 层 | ParseWorker、ASRWorker、SummaryWorker、EmbeddingWorker、GraphWorker |
| 存储层 | MySQL / PostgreSQL、VectorStore、Redis、Object Storage |
| 外部服务 | Douyin OpenAPI、解析服务、ASR、LLM、Embedding |

## 2. 服务分层职责

| 层级 | 组件 | 职责 |
|------|------|------|
| API Gateway | Hono + tRPC | 参数校验、鉴权、限流、请求路由、SSE/WebSocket 任务进度推送 |
| Application Service | VideoService / SearchService / ChatService / GraphService | 编排业务流程，不直接处理耗时外部调用 |
| Domain Service | ContentIngestion / RAGPipeline / GraphBuilder | 定义领域状态机、幂等规则、数据转换和质量评估 |
| Infrastructure Adapter | DouyinConnector / LLMClient / VectorStore / ASRClient | 封装外部系统，统一超时、重试、错误映射和日志 |
| Worker | ParseWorker / ASRWorker / SummaryWorker / EmbeddingWorker / GraphWorker | 消费队列任务，执行高延迟处理，写入任务状态和产物表 |

## 3. 核心 API

| API | 类型 | 说明 |
|-----|------|------|
| `import.create` | mutation | 提交链接或批量链接，创建导入任务 |
| `import.status` | query | 查询导入任务状态、进度、失败原因 |
| `import.retry` | mutation | 重试可恢复失败任务 |
| `videos.list` | query | 分页查看视频 Wiki 卡片 |
| `videos.detail` | query | 查看元数据、摘要、逐字稿、相关视频 |
| `search.semantic` | query | 视频级或 Chunk 级语义搜索 |
| `chat.ask` | mutation / stream | 基于知识库进行问答，返回来源 |
| `graph.neighbors` | query | 获取某视频的一跳/二跳图谱数据 |

## 4. 前端技术栈

- **框架**：React + TypeScript
- **状态管理**：按功能模块划分（导入中心、Wiki 列表、视频详情、搜索页、图谱页）
- **图表渲染**：力导向布局计算放入 Web Worker，避免阻塞主线程
- **实时通信**：SSE / WebSocket 推送任务进度

## 5. 数据存储

### 5.1 关系型数据库

- **选型**：MySQL / PostgreSQL
- **ORM**：Drizzle
- **核心表**：
  - `users` / `workspaces`：用户与多租户隔离
  - `videos` / `video_stats`：视频主数据与统计
  - `ingestion_jobs`：导入任务状态机
  - `transcripts` / `chunks` / `summaries`：内容产物
  - `embeddings` / `graph_edges`：向量索引与图谱边

### 5.2 向量数据库

- **抽象接口**：`VectorStore`
- **MVP 可选方案**：Chroma、pgvector、Qdrant
- **规模化方案**：Milvus、Vespa、Elasticsearch
- **接口定义**：

```typescript
interface VectorStore {
  upsert(chunks: VectorChunk[]): Promise<void>;
  search(params: {
    workspaceId: string;
    queryEmbedding: number[];
    topK: number;
    filters?: SearchFilter;
  }): Promise<SearchHit[]>;
  deleteByOwner(ownerType: string, ownerId: string): Promise<void>;
}
```

### 5.3 缓存与队列

- **缓存**：Redis
- **队列选型（按阶段）**：
  - 本地 MVP：数据库 job 表 + 定时轮询
  - 线上 MVP：Redis + BullMQ
  - 规模化：Kafka / RabbitMQ / 云队列

## 6. 外部服务依赖

| 服务 | 用途 | 抽象方式 |
|------|------|----------|
| Douyin OpenAPI | 官方 OAuth 同步本人视频 | `DouyinOfficialConnector` |
| 第三方解析服务 | 补充公开视频元数据 | `DouyinConnector` |
| ASR | 语音转逐字稿 | `ASRClient` |
| LLM | 摘要、标签、实体抽取、问答 | `LLMClient` |
| Embedding | 文本向量化 | `VectorStore` 内置或独立客户端 |

## 7. 检索策略

| 层级 | 检索对象 | 作用 |
|------|----------|------|
| 视频级召回 | 标题、描述、AI 摘要、标签 | 快速找到相关视频，适合导航式搜索 |
| Chunk 级召回 | 逐字稿、OCR、笔记片段 | 支持精确问答和定位到视频时间段 |
| 混合检索 | BM25 + 向量 + 标签过滤 | 兼顾中文关键词、专有名词和语义匹配 |
| Rerank | 候选 chunk / 视频 | 提升 TopK 质量，降低无关片段进入上下文 |

## 8. RAG 问答流程

```
用户问题 → Query Rewrite → 混合召回 → Rerank → 上下文拼装 → LLM 回答 → 来源引用
```

RAG Context 结构：

```typescript
{
  video_id: string;
  title: string;
  share_url: string;
  chunk_text: string;
  start_time_ms: number;
  end_time_ms: number;
  score: number;
}
```

## 9. 知识图谱

- **边生成策略**：增量 TopK 邻居，非全量 O(N²)
- **关系类型**：`same_topic`、`same_author`、`same_entity`、`prerequisite`、`follow_up`
- **前端渲染**：默认只加载一跳邻居，支持过滤与聚合节点

## 10. 安全与可观测性

### 10.1 安全

- 所有业务表必须包含 `workspace_id` 或通过视频归属间接关联 workspace
- 所有查询、向量检索、图谱查询必须强制带 workspace filter
- 外部 API Key 存入服务端密钥管理，不暴露给前端
- 支持用户级联删除视频及其派生产物
- 导入接口限流 + 单用户并发任务限制

### 10.2 可观测性指标

| 指标类型 | 指标 | 目标 |
|----------|------|------|
| 任务指标 | 导入成功率、平均耗时、失败分布、重试次数 | 成功率 > 95%，失败原因可归类 |
| 模型指标 | LLM 延迟、ASR 延迟、Embedding 延迟、单视频成本 | 可按 workspace 统计成本 |
| 检索指标 | TopK 命中率、无结果率、用户点击率 | 持续优化召回质量 |
| 系统指标 | 队列积压、Worker 并发、错误率、P95/P99 响应时间 | 队列积压可告警 |

### 10.3 成本控制

- 重复链接通过幂等键去重
- 摘要和 Embedding 使用 `content_hash` 缓存
- 长视频 ASR 分段处理，设置最大时长和用户额度
- 不同套餐限制导入量、ASR 时长、Embedding 调用量和图谱节点数
