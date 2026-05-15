# 代码规范

## 1. 架构分层规范

代码必须严格按以下分层组织，禁止跨层直接调用：

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

## 2. 接口抽象规范

### 2.1 外部依赖必须接口化

所有外部系统调用必须通过接口抽象，禁止在业务层直接引用具体实现：

- LLM 服务 → `LLMClient` 接口
- Embedding 服务 → `VectorStore` 接口或独立 `EmbeddingClient`
- ASR 服务 → `ASRClient` 接口
- 抖音数据源 → `DouyinConnector` / `DouyinOfficialConnector` 接口
- 向量数据库 → `VectorStore` 接口

### 2.2 VectorStore 接口标准

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

> 向量库迁移时，只需替换实现，业务层代码不受影响。

## 3. 命名规范

### 3.1 数据库命名

- 表名使用 **snake_case**，复数形式：
  - `videos`、`workspaces`、`ingestion_jobs`、`graph_edges`
- 字段名使用 **snake_case**：
  - `workspace_id`、`platform_video_id`、`normalized_url_hash`、`created_at`
- 布尔状态字段使用形容词或状态名：
  - `is_user_edited`、`visibility`、`status`
- 时间戳字段统一后缀：
  - `created_at`、`updated_at`、`started_at`、`finished_at`、`computed_at`

### 3.2 TypeScript 命名

- 接口名使用 **PascalCase**：`VectorStore`、`SearchFilter`
- 类型别名使用 **PascalCase**：`VectorChunk`、`SearchHit`
- 类名使用 **PascalCase**：`ParseWorker`、`ContentIngestion`
- 方法名使用 **camelCase**：`upsert`、`deleteByOwner`
- 常量使用 **UPPER_SNAKE_CASE**：`MAX_RETRY_COUNT`、`DEFAULT_TOP_K`

## 4. 幂等设计规范

### 4.1 幂等键定义

```
已知 video_id:   workspace_id + platform + platform_video_id
未知 video_id:   normalized_url_hash
```

### 4.2 幂等实现要求

- 同一幂等键的重复请求必须返回相同结果，不触发重复处理
- 幂等键必须在 `ingestion_jobs` 表中建立唯一索引
- 处理完成后保留幂等键记录，用于后续去重查询

## 5. 状态机规范

### 5.1 任务状态定义

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

failed_retryable    (可重试)
failed_terminal     (不可重试)
cancelled
```

### 5.2 状态转换规则

- 正向流转只能按顺序进行，禁止跳步
- 失败后只能进入 `failed_retryable` 或 `failed_terminal`
- 可重试状态允许回退到 `created` 重新调度
- 终止状态（`completed` / `partial_completed` / `failed_terminal` / `cancelled`）不可再转换

### 5.3 错误处理

- 所有外部调用必须记录 `error_code` 和 `error_message`
- 网络错误、超时、限流 → `failed_retryable`，指数退避重试
- 鉴权失败、链接无效、内容不存在 → `failed_terminal`，直接终止
- 元数据成功但 ASR 失败 → `partial_completed`，允许降级使用

## 6. 多租户隔离规范

### 6.1 强制规则

- **所有业务表必须包含 `workspace_id`** 或通过视频归属间接关联 workspace
- **所有查询必须强制带 `workspace_id` filter**
- **所有 API 参数必须校验 `workspace_id` 权限**
- **向量检索必须带 `workspaceId` metadata filter**
- **图谱查询必须过滤 `workspace_id`**

### 6.2 验证要求

- 集成测试必须覆盖跨 workspace 数据访问场景
- 禁止在业务层拼接不带 workspace 条件的 SQL
- 禁止在向量搜索时遗漏 `workspaceId` 过滤参数

## 7. 错误码与日志规范

### 7.1 错误码结构

| 层级 | 错误码前缀 | 示例 |
|------|-----------|------|
| 解析层 | `PARSE_` | `PARSE_INVALID_URL`、`PARSE_LINK_EXPIRED` |
| ASR 层 | `ASR_` | `ASR_TIMEOUT`、`ASR_UNSUPPORTED_LANG` |
| LLM 层 | `LLM_` | `LLM_RATE_LIMIT`、`LLM_INVALID_OUTPUT` |
| 向量层 | `VEC_` | `VEC_INSERT_FAILED`、`VEC_SEARCH_ERROR` |
| 任务层 | `JOB_` | `JOB_MAX_RETRY_EXCEEDED`、`JOB_CANCELLED` |

### 7.2 日志要求

- 每个 Worker 步骤必须记录开始、完成、失败事件
- 外部 API 调用必须记录请求 ID、耗时、状态码
- 重试操作必须记录当前重试次数和下次重试时间
- 死信队列中的任务必须保留完整上下文日志

## 8. 数据模型规范

### 8.1 拆分原则

视频元数据、转写文本、摘要、向量、图谱边的生命周期不同，必须分表存储：

- `videos`：视频主数据，稳定、不常变更
- `transcripts`：转写文本，可能重跑 ASR
- `chunks`：文本片段，随切分策略变更
- `summaries`：AI 摘要，随 prompt 版本迭代
- `embeddings`：向量索引，随模型变更
- `graph_edges`：图谱边，可离线重算

### 8.2 内容产物表要求

| 表 | 必须字段 | 说明 |
|----|----------|------|
| transcripts | `source`、`model_name` | 标明来源（asr/subtitle/manual_note/ocr）和模型 |
| chunks | `content_type`、`chunk_index`、`content_hash` | 支持多种内容类型，哈希去重 |
| summaries | `prompt_version`、`input_hash`、`output_schema_version` | 支持 prompt 迭代和结果复现 |
| embeddings | `model_name`、`dimension`、`content_hash` | 支持多模型、多维度、内容变更检测 |
| graph_edges | `relation_type`、`computed_by` | 支持多策略生成，来源可追溯 |

## 9. 缓存与去重规范

### 9.1 内容 Hash 缓存

- 摘要和 Embedding 必须使用 `content_hash` 缓存
- 内容未变更时，禁止重复调用 LLM 和 Embedding 服务
- Hash 算法建议：SHA-256 取前 16 位

### 9.2 重复链接去重

- 导入前必须检查 `normalized_url_hash` 是否已存在
- 幂等键命中时，直接返回已有任务或视频
- 禁止同一 workspace 内重复导入相同视频

## 10. API 设计规范

### 10.1 tRPC 命名

- Query 使用名词或形容词：`.list`、`.detail`、`.status`、`.semantic`
- Mutation 使用动词：`.create`、`.retry`、`.ask`
- 嵌套命名空间按模块划分：`import.`、`videos.`、`search.`、`chat.`、`graph.`

### 10.2 响应格式

- 列表接口必须支持分页（cursor / offset）
- 任务状态接口必须包含当前步骤、进度百分比、预计剩余时间
- 错误响应必须包含 `error_code`、`error_message`、`retryable` 字段
- RAG 问答响应必须包含 `sources` 数组，标明视频、片段和时间戳

## 11. 前端状态规范

### 11.1 模块划分

- **导入中心**：批量任务、进度、失败原因、重试按钮
- **Wiki 列表**：视频卡片、分类/标签/作者筛选
- **视频详情**：摘要、关键点、逐字稿、时间戳片段、相关视频
- **搜索页**：关键词 + 语义混合、命中片段展示
- **图谱页**：局部加载、节点展开、关系过滤

### 11.2 性能要求

- 图谱力导向布局计算放入 Web Worker
- 默认只加载一跳邻居，禁止一次性拉取全量图谱
- 支持按分类、作者、标签、时间范围过滤
- 大图谱使用聚合节点，点击后展开
