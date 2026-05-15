# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 参考文档

以下 `.wiki` 目录下的文件包含项目的详细规范，执行任务前应先查阅相关文件：

- `.wiki/tech-stack.md` — 技术栈选型、分层架构、核心 API 定义、数据存储方案、外部服务依赖、检索策略
- `.wiki/coding-standards.md` — 架构分层规范、接口抽象规范、命名规范、幂等设计、状态机规范、多租户隔离规范、错误码与日志规范
- `.wiki/development-roadmap.md` — 项目定位与架构原则、核心链路、异步入库流水线、开发里程碑与验收指标

## 项目定位

抖音 Wiki 是一个「AI 驱动的短视频知识资产管理系统」，核心能力包括：视频解析、ASR 转写、AI 摘要、语义搜索、RAG 问答、知识图谱。

## 架构主线

```
用户提交链接 → 创建 import_job → 解析元数据 → 提取内容 → ASR / OCR → Chunk 化 → 摘要与标签 → Embedding → 向量入库 → 图谱边更新
```

### 服务分层（严禁跨层调用）

```
API Gateway (Hono + tRPC)
  → Application Service (VideoService / SearchService / ChatService / GraphService)
    → Domain Service (ContentIngestion / RAGPipeline / GraphBuilder)
      → Infrastructure Adapter (DouyinConnector / LLMClient / VectorStore / ASRClient)
        → Worker (ParseWorker / ASRWorker / SummaryWorker / EmbeddingWorker / GraphWorker)
```

| 层级 | 职责 | 禁止行为 |
|------|------|----------|
| API Gateway | 参数校验、鉴权、限流、请求路由、SSE/WebSocket 推送 | 直接调用外部服务或操作数据库 |
| Application Service | 编排业务流程 | 包含领域规则或数据转换逻辑 |
| Domain Service | 定义状态机、幂等规则、数据转换、质量评估 | 直接发起 HTTP 请求或操作 ORM |
| Infrastructure Adapter | 封装外部系统，统一超时、重试、错误映射和日志 | 包含业务判断逻辑 |
| Worker | 消费队列任务，执行高延迟处理 | 同步等待前端响应 |

### 外部依赖接口抽象

所有外部系统必须通过接口抽象，禁止业务层直接引用具体实现：

- LLM → `LLMClient`
- Embedding → `VectorStore` 或独立 `EmbeddingClient`
- ASR → `ASRClient`
- 抖音数据源 → `DouyinConnector` / `DouyinOfficialConnector`
- 向量数据库 → `VectorStore`

`VectorStore` 接口标准：

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

## 核心规范

### 多租户隔离（强制）

- 所有业务表必须包含 `workspace_id` 或通过视频归属间接关联 workspace
- 所有查询、向量检索、图谱查询必须强制带 `workspace_id` / `workspaceId` filter
- 集成测试必须覆盖跨 workspace 数据访问场景

### 任务状态机

```
created
  → parsing_metadata
  → fetching_content
  → transcribing
  → chunking
  → summarizing
  → embedding
  → indexing
  → graph_updating
  → completed

failed_retryable    (可指数退避重试)
failed_terminal     (不可重试)
cancelled
```

- 正向流转只能按顺序进行，禁止跳步
- 终止状态不可再转换
- 元数据成功但 ASR 失败 → `partial_completed`，降级为摘要级知识库

### 幂等设计

- 已知 video_id：`workspace_id + platform + platform_video_id`
- 未知 video_id：`normalized_url_hash`
- 幂等键必须在 `ingestion_jobs` 表中建立唯一索引

### 命名规范

- 数据库表名/字段名：`snake_case`，表名复数（`videos`、`workspaces`、`ingestion_jobs`）
- TypeScript 接口/类/类型：`PascalCase`
- 方法：`camelCase`
- 常量：`UPPER_SNAKE_CASE`

### 错误码前缀

| 层级 | 前缀 |
|------|------|
| 解析层 | `PARSE_` |
| ASR 层 | `ASR_` |
| LLM 层 | `LLM_` |
| 向量层 | `VEC_` |
| 任务层 | `JOB_` |

### 数据分表原则

视频元数据、转写文本、摘要、向量、图谱边生命周期不同，必须分表：

- `videos` — 视频主数据
- `transcripts` — 转写文本
- `chunks` — 文本片段
- `summaries` — AI 摘要
- `embeddings` — 向量索引
- `graph_edges` — 图谱边

### 缓存与去重

- 摘要和 Embedding 使用 `content_hash` 缓存，内容未变更禁止重复调用 LLM/Embedding
- 导入前检查 `normalized_url_hash`，同一 workspace 禁止重复导入
