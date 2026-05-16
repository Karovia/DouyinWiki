# 开发路线

## 修订说明

原方案已具备较好的产品方向与基础技术选型，但偏向普通 CRUD Web 应用。修订版将系统重构为「API + Queue + Worker + VectorStore + Job State Machine」架构，以支撑视频解析、转写、摘要、Embedding、图谱计算等高延迟、高失败率、强外部依赖的 AI 内容处理流程。

| 原设计 | 修订后设计 | 原因 |
|--------|-----------|------|
| 同步 video.parse 接口 | 异步 import_job + Worker 流水线 | 避免接口超时，支持重试、进度、幂等与失败恢复 |
| videos 表内直接存 embedding | videos / transcripts / chunks / embeddings 分表 | 支持 Chunk 级 RAG、模型重跑和多版本索引 |
| MySQL 向量扩展作为默认向量库 | 抽象 VectorStore，MVP 可用 pgvector / Qdrant / Chroma | 避免被单一数据库能力锁死，便于后续扩展 |
| 只基于标题和摘要检索 | 标题摘要 + ASR 转写 + OCR/笔记的混合检索 | 提升知识库质量，避免"只管收藏、不懂内容" |
| 全量两两计算图谱边 | 新增视频 TopK 邻居 + 离线图谱任务 | 避免 O(N²) 性能爆炸 |
| 用户系统 P2 | workspace_id / user_id P0 贯穿所有表 | 多租户隔离不能后补，否则迁移成本高 |

## 1. 项目定位与架构原则

### 1.1 产品定位

抖音 Wiki 定位为「AI 驱动的短视频知识资产管理系统」。它不是简单的视频收藏夹，而是将短视频链接、元数据、口播逐字稿、AI 摘要、标签、实体、向量索引和知识关系统一管理，让用户可以对碎片化短视频内容进行检索、复盘、问答和关联发现。

| 维度 | 定义 |
|------|------|
| 核心对象 | 短视频内容资产 |
| 核心能力 | 解析、转写、摘要、搜索、问答、图谱 |
| 核心差异 | 从收藏夹升级为知识库 |
| 优先场景 | 个人知识管理 / 创作者素材库 / 企业内容沉淀 |

### 1.2 架构目标

- **可落地**：MVP 阶段允许使用简化组件，但核心抽象不能阻碍后续扩展
- **可恢复**：所有外部调用都必须有任务状态、错误码、重试次数和幂等键
- **可替换**：LLM、Embedding、ASR、VectorStore、DouyinConnector 均通过接口抽象
- **可观测**：导入成功率、模型耗时、单视频成本、检索命中率、任务失败原因可追踪
- **可扩展**：支持从单用户本地版演进到多用户 SaaS，不重构核心数据模型

### 1.3 设计边界

| 能力 | 本期支持 | 说明 |
|------|----------|------|
| 手动链接导入 | 支持 | MVP 主路径，用户复制抖音分享链接后导入 |
| 官方 OAuth 同步本人视频 | 二期支持 | 适合创作者或企业号内容管理 |
| 自动读取收藏夹 | 不作为 SaaS 核心能力 | 可作为个人本地插件探索，但不建议作为商业化主链路 |
| 视频文件长期存储 | 默认不存储 | 仅存储元数据、文本、向量和必要的临时处理文件 |
| RAG 问答 | 依赖 transcript/chunk 质量 | 没有转写文本时，仅提供摘要级搜索，不承诺细粒度问答 |

## 2. 核心链路

```
用户提交链接 → 创建 import_job → 解析元数据 → 提取内容 → ASR / OCR → Chunk 化 → 摘要与标签 → Embedding → 向量入库 → 图谱边更新
```

链路设计原则：前端提交链接后立即返回任务 ID，不等待解析完成。用户通过任务状态接口或 SSE 看到进度。任务失败时展示可理解的失败原因，并支持用户重试。

## 3. 异步入库流水线

### 3.1 任务状态机

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

failed_retryable
failed_terminal
cancelled
```

| 状态 | 说明 | 是否可重试 |
|------|------|-----------|
| created | 任务已创建，等待队列调度 | 是 |
| parsing_metadata | 解析链接、获取标题、作者、封面等元数据 | 是 |
| fetching_content | 尝试获取可处理的音频、字幕、页面文本或用户笔记 | 是 |
| transcribing | 调用 ASR 服务生成逐字稿 | 是 |
| chunking | 按语义、时间戳和 token 长度切分文本 | 是 |
| summarizing | 生成视频摘要、知识点、标签和分类 | 是 |
| embedding | 对 chunk、摘要、标题等内容生成向量 | 是 |
| indexing | 向量索引写入 VectorStore | 是 |
| graph_updating | 更新知识图谱边关系 | 是 |
| completed | 入库成功，可搜索、问答和展示 | 否 |
| partial_completed | 元数据成功但 ASR 失败，降级为摘要级知识库 | 否 |
| failed_retryable | 临时性失败，可指数退避重试 | 是 |
| failed_terminal | 确定性失败，例如链接无效、权限不足、内容不存在 | 否 |
| cancelled | 任务被用户取消 | 否 |

### 3.2 幂等与重试策略

- **幂等键**：`workspace_id + platform + platform_video_id`，解析前未知 video_id 时使用 `normalized_url_hash`
- **重试策略**：网络错误、超时、限流使用指数退避；鉴权失败、链接无效、内容不存在不重试
- **死信队列**：超过最大重试次数后进入 DLQ，保留上下文用于人工排查
- **部分成功**：元数据成功但 ASR 失败时，视频仍可进入摘要级知识库，状态标记为 `partial_completed`

### 3.3 队列选型建议

| 阶段 | 推荐方案 | 说明 |
|------|----------|------|
| 本地 MVP | 数据库 job 表 + 定时轮询 | 组件最少，便于快速验证 |
| 线上 MVP | Redis + BullMQ | Node.js 生态成熟，支持延迟、重试、并发控制 |
| 规模化 | Kafka / RabbitMQ / 云队列 | 适合多 Worker、多租户和高吞吐任务 |

## 4. 数据源策略

| 数据源 | 优先级 | 适用场景 | 风险 | 架构处理 |
|--------|--------|----------|------|----------|
| 用户手动分享链接 | P0 | MVP、个人知识库、少量导入 | 解析字段有限、链接可能过期 | 以链接解析为入口，缓存解析结果，失败可手动补充标题/笔记 |
| 抖音开放平台 OAuth | P1 | 创作者本人视频、企业号视频同步 | 权限申请、字段范围有限 | 作为官方数据源，单独实现 DouyinOfficialConnector |
| 第三方解析 API | P1/P2 | 补充公开视频元数据 | 稳定性、成本、合规风险 | 通过 Connector 隔离，配置可关闭，不作为唯一主路径 |
| 浏览器策略 | 仅本地版可选 | 个人研究、本地工具 | 易失效、合规和风控风险高 | 不进入 SaaS 默认链路，不承诺稳定性 |
| 用户手动笔记/字幕 | P0 | 解析失败或无法 ASR 时补充内容 | 依赖用户输入 | 作为高质量知识来源参与 Chunk 和 Embedding |

> **合规边界**：商业化版本建议只处理用户主动提交的公开视频链接、用户授权账号的视频数据，以及用户自己补充的笔记/字幕。默认不长期存储视频文件，不提供规避平台限制、绕过风控、批量抓取私密数据的能力。

## 5. 开发里程碑与验收指标

| 阶段 | 周期 | 核心目标 | 验收标准 |
|------|------|----------|----------|
| Phase 1：本地 MVP | Week 1-2 | 链接导入、元数据解析、Wiki CRUD、基础摘要 | 单用户可完成 20 条链接导入，失败可见 |
| Phase 2：任务化改造 | Week 3-4 | Job 表、Worker、状态机、重试、幂等 | 导入接口不阻塞，任务失败可重试 |

### Phase 1 总体进度

| Task | 模块 | 状态 | 完成时间 | 备注 |
|------|------|:----:|:--------:|------|
| Task 1 | 项目初始化与依赖安装 | ✅ | 2026-05-16 | |
| Task 2 | 数据库 Schema 与 Drizzle 配置 | ✅ | 2026-05-16 | |
| Task 3 | 核心领域类型与错误码 | ✅ | 2026-05-16 | |
| Task 4 | 基础设施适配器（接口 + Mock） | ✅ | 2026-05-16 | |
| Task 5 | 应用服务层 | ✅ | 2026-05-16 | |
| Task 6 | Worker 与内存队列 | ✅ | 2026-05-16 | |
| Task 7 | tRPC API 路由 | ✅ | 2026-05-16 | |
| Task 8 | Hono 服务器入口 | ✅ | 2026-05-16 | |
| Task 9 | React 前端基础页面 | ✅ | 2026-05-16 | |
| Task 10 | 端到端验证 | ✅ | 2026-05-16 | |

### Phase 2 总体进度

| Task | 状态 | 完成时间 |
|------|------|----------|
| Task 1: 数据库 Schema 增强 - 幂等索引与任务字段 | ✅ | 2026-05-16 |
| Task 2: 状态机增强与任务生命周期管理 API | ✅ | 2026-05-16 |
| Task 3: 集成测试 - 跨 workspace 隔离与 E2E | ✅ | 2026-05-16 |
| Task 4: Worker 系统增强 - 重试、超时与并发控制 | ✅ | 2026-05-16 |
| Phase 3：内容增强 | Week 5-6 | ASR/手动字幕、Chunk 表、Chunk Embedding | 问答可引用具体片段，支持时间戳 |
| Phase 4：混合检索 | Week 7 | BM25 + 向量 + 标签过滤 + Rerank | 搜索结果能返回视频和命中片段 |
| Phase 5：图谱离线化 | Week 8 | TopK 边生成、局部图谱、聚类展示 | 1000 条视频内图谱页面流畅可用 |
| Phase 6：多用户与运营化 | Week 9-10 | Workspace、权限、限流、成本统计、删除能力 | 多用户数据隔离通过测试 |

### Phase 3 总体进度

| Task | 模块 | 状态 | 完成时间 | 备注 |
|------|------|:----:|:--------:|------|
| Task 1 | 数据库 Schema 扩展 | ✅ | 2026-05-16 | transcripts, chunks, embeddings |
| Task 2 | 领域类型扩展 | ✅ | 2026-05-16 | Transcript, Chunk, VectorChunk, SearchHit |
| Task 3 | 基础设施接口 | ✅ | 2026-05-16 | ASRClient, EmbeddingClient, VectorStore |
| Task 4 | VectorStore 单元测试 | ✅ | 2026-05-16 | |
| Task 5 | QueueJob 类型扩展 | ✅ | 2026-05-16 | 支持多阶段流水线 |
| Task 6 | parse-worker 改造 + ASR Worker | ✅ | 2026-05-16 | |
| Task 7 | Chunk Worker + Summary Worker | ✅ | 2026-05-16 | |
| Task 8 | Embed Worker + Index Worker | ✅ | 2026-05-16 | |
| Task 9 | SearchService + search.semantic API | ✅ | 2026-05-16 | |
| Task 10 | 注册全部 Worker 与 API | ✅ | 2026-05-16 | |
| Task 11 | E2E 集成测试 | ✅ | 2026-05-16 | 完整流水线 + 语义搜索 |
| Task 12 | 更新开发路线图 | ✅ | 2026-05-16 | |

---

## Phase 1 详细实施计划

> **目标：** 从零搭建可运行的本地 MVP，支持单用户提交抖音链接、解析元数据、查看 Wiki 列表和详情。
>
> **架构：** 采用 Hono + tRPC 提供类型安全 API，Drizzle ORM 管理 SQLite 数据库，内存队列调度 Worker，React 前端通过 Vite 构建。
>
> **技术栈：** TypeScript / Hono / tRPC / Drizzle ORM (SQLite) / Zod / React / Vite

---

### 文件结构总览

Phase 1 需要创建以下文件：

```
D:\Douyin Wiki\
├── package.json                    # 项目依赖
├── tsconfig.json                   # TypeScript 配置
├── vite.config.ts                  # Vite 配置（前后端同构）
├── .env                            # 环境变量
├── src/
│   ├── db/
│   │   ├── index.ts               # Drizzle ORM 连接
│   │   ├── schema.ts              # 数据库表定义
│   │   └── migrations/            # Drizzle 迁移文件
│   ├── domain/
│   │   ├── types.ts               # 核心领域类型
│   │   ├── errors.ts              # 错误码定义
│   │   └── state-machine.ts       # 任务状态机
│   ├── infrastructure/
│   │   ├── douyin-connector.ts    # 抖音解析接口 + Mock 实现
│   │   └── llm-client.ts          # LLM 接口 + Mock 实现
│   ├── services/
│   │   ├── video-service.ts       # 视频 CRUD 编排
│   │   └── import-service.ts      # 导入任务编排
│   ├── workers/
│   │   ├── queue.ts               # 内存队列
│   │   └── parse-worker.ts        # 元数据解析 Worker
│   ├── api/
│   │   ├── trpc.ts                # tRPC 初始化
│   │   └── routers/
│   │       ├── import.ts          # import.create / import.status
│   │       └── videos.ts          # videos.list / videos.detail
│   ├── server.ts                  # Hono 服务器入口
│   └── app/                       # React 前端
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/
│       │   ├── ImportPage.tsx
│       │   ├── WikiListPage.tsx
│       │   └── VideoDetailPage.tsx
│       └── components/
│           ├── VideoCard.tsx
│           └── ImportForm.tsx
└── tests/
    ├── unit/
    │   └── state-machine.test.ts
    └── integration/
        └── import-flow.test.ts
```

---

### Phase 1 总体进度

| Task | 模块 | 状态 | 完成时间 | 备注 |
|------|------|:----:|:--------:|------|
| Task 1 | 项目初始化与依赖安装 | ✅ | 2026-05-16 | |
| Task 2 | 数据库 Schema 与 Drizzle 配置 | ✅ | 2026-05-16 | 含 Phase 2 字段（重试时间戳、唯一索引） |
| Task 3 | 核心领域类型与错误码 | ✅ | 2026-05-16 | 含状态机单元测试 |
| Task 4 | 基础设施适配器（接口 + Mock） | ✅ | 2026-05-16 | |
| Task 5 | 应用服务层 | ✅ | 2026-05-16 | |
| Task 6 | Worker 与内存队列 | ✅ | 2026-05-16 | |
| Task 7 | tRPC API 路由 | ✅ | 2026-05-16 | |
| Task 8 | Hono 服务器入口 | ✅ | 2026-05-16 | |
| Task 9 | React 前端基础页面 | ✅ | 2026-05-16 | |
| Task 10 | 端到端验证 | ✅ | 2026-05-16 | 集成测试通过，服务启动正常 |

> 状态说明：⬜ 待完成 / 🔄 进行中 / ✅ 已完成

---

### Task 1：项目初始化与依赖安装

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `.env`

- [x] **Step 1：初始化 package.json**

```bash
npm init -y
```

- [x] **Step 2：安装核心依赖**

```bash
npm install hono @hono/trpc-server @trpc/server @trpc/client @trpc/react-query zod drizzle-orm better-sqlite3
npm install -D typescript @types/node @types/better-sqlite3 vite @vitejs/plugin-react drizzle-kit vitest
npm install react react-dom @tanstack/react-query
npm install -D @types/react @types/react-dom
```

- [x] **Step 3：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "~/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [x] **Step 4：创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [x] **Step 5：创建 .env**

```env
DATABASE_URL=./data/douyin-wiki.db
MOCK_LLM=true
MOCK_DOUYIN=true
PORT=3000
```

- [x] **Step 6：在 package.json 中添加 scripts**

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc && vite build",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "test": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

- [x] **Step 7：创建数据目录**

```bash
mkdir -p data
```

- [x] **Step 8：提交**

```bash
git add .
git commit -m "chore: init project with TypeScript, Hono, tRPC, Drizzle"
```

---

### Task 2：数据库 Schema 与 Drizzle 配置

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/schema.ts`
- Create: `drizzle.config.ts`

- [x] **Step 1：创建 drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data/douyin-wiki.db',
  },
});
```

- [x] **Step 2：创建 src/db/schema.ts**

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  platform: text('platform').notNull().default('douyin'),
  platformVideoId: text('platform_video_id'),
  shareUrl: text('share_url').notNull(),
  normalizedUrlHash: text('normalized_url_hash').notNull().unique(),
  title: text('title'),
  description: text('description'),
  authorName: text('author_name'),
  authorId: text('author_id'),
  coverUrl: text('cover_url'),
  duration: integer('duration'),
  tags: text('tags'), // JSON array
  aiSummary: text('ai_summary'),
  aiTags: text('ai_tags'), // JSON array
  viewCount: integer('view_count'),
  likeCount: integer('like_count'),
  status: text('status').notNull().default('pending'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const ingestionJobs = sqliteTable('ingestion_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  videoId: text('video_id').references(() => videos.id),
  shareUrl: text('share_url').notNull(),
  normalizedUrlHash: text('normalized_url_hash').notNull(),
  status: text('status').notNull().default('created'),
  step: text('step'),
  progress: integer('progress').default(0),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

- [x] **Step 3：创建 src/db/index.ts**

```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const client = new Database(process.env.DATABASE_URL || './data/douyin-wiki.db');
export const db = drizzle(client, { schema });

export type DbClient = typeof db;
export { schema };
```

- [x] **Step 4：生成并执行迁移**

```bash
npm run db:generate
npm run db:migrate
```

- [x] **Step 5：提交**

```bash
git add .
git commit -m "feat(db): add videos and ingestion_jobs schema with Drizzle ORM"
```

---

### Task 3：核心领域类型与错误码

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/errors.ts`
- Create: `src/domain/state-machine.ts`

- [x] **Step 1：创建 src/domain/types.ts**

```typescript
export type Platform = 'douyin' | 'kuaishou' | 'bilibili';

export type JobStatus =
  | 'created'
  | 'parsing_metadata'
  | 'fetching_content'
  | 'transcribing'
  | 'chunking'
  | 'summarizing'
  | 'embedding'
  | 'indexing'
  | 'graph_updating'
  | 'completed'
  | 'partial_completed'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled';

export interface VideoMetadata {
  platformVideoId?: string;
  title?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  coverUrl?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  tags?: string[];
}

export interface ParsedUrl {
  platform: Platform;
  platformVideoId?: string;
  normalizedUrl: string;
  normalizedUrlHash: string;
}

export interface ImportJob {
  id: string;
  workspaceId: string;
  shareUrl: string;
  normalizedUrlHash: string;
  status: JobStatus;
  step?: string;
  progress: number;
  retryCount: number;
  maxRetries: number;
  errorCode?: string;
  errorMessage?: string;
  videoId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Video {
  id: string;
  workspaceId: string;
  platform: Platform;
  platformVideoId?: string;
  shareUrl: string;
  normalizedUrlHash: string;
  title?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  coverUrl?: string;
  duration?: number;
  tags?: string[];
  aiSummary?: string;
  aiTags?: string[];
  viewCount?: number;
  likeCount?: number;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

- [x] **Step 2：创建 src/domain/errors.ts**

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 解析层错误
export const PARSE_INVALID_URL = (url: string) =>
  new AppError('PARSE_INVALID_URL', `Invalid URL format: ${url}`, false, 400);

export const PARSE_LINK_EXPIRED = () =>
  new AppError('PARSE_LINK_EXPIRED', 'Share link has expired', false, 400);

export const PARSE_PLATFORM_UNSUPPORTED = (platform: string) =>
  new AppError('PARSE_PLATFORM_UNSUPPORTED', `Platform not supported: ${platform}`, false, 400);

// ASR 层错误
export const ASR_TIMEOUT = () =>
  new AppError('ASR_TIMEOUT', 'ASR service timeout', true, 504);

export const ASR_UNSUPPORTED_LANG = () =>
  new AppError('ASR_UNSUPPORTED_LANG', 'Unsupported language', false, 400);

// LLM 层错误
export const LLM_RATE_LIMIT = () =>
  new AppError('LLM_RATE_LIMIT', 'LLM rate limit exceeded', true, 429);

export const LLM_INVALID_OUTPUT = () =>
  new AppError('LLM_INVALID_OUTPUT', 'LLM returned invalid output format', true, 502);

// 向量层错误
export const VEC_INSERT_FAILED = () =>
  new AppError('VEC_INSERT_FAILED', 'Vector insert failed', true, 502);

// 任务层错误
export const JOB_MAX_RETRY_EXCEEDED = () =>
  new AppError('JOB_MAX_RETRY_EXCEEDED', 'Max retry count exceeded', false, 422);

export const JOB_CANCELLED = () =>
  new AppError('JOB_CANCELLED', 'Job was cancelled', false, 409);
```

- [x] **Step 3：创建 src/domain/state-machine.ts**

```typescript
import { JobStatus } from './types';

const FORWARD_STATES: JobStatus[] = [
  'created',
  'parsing_metadata',
  'fetching_content',
  'transcribing',
  'chunking',
  'summarizing',
  'embedding',
  'indexing',
  'graph_updating',
  'completed',
];

const TERMINAL_STATES: JobStatus[] = [
  'completed',
  'partial_completed',
  'failed_terminal',
  'cancelled',
];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (TERMINAL_STATES.includes(from)) return false;

  if (to === 'failed_retryable') return !TERMINAL_STATES.includes(from);
  if (to === 'failed_terminal') return !TERMINAL_STATES.includes(from);
  if (to === 'cancelled') return !TERMINAL_STATES.includes(from);
  if (to === 'partial_completed') return from === 'transcribing';

  const fromIndex = FORWARD_STATES.indexOf(from);
  const toIndex = FORWARD_STATES.indexOf(to);

  if (fromIndex === -1 || toIndex === -1) return false;

  // 正向流转只能按顺序，禁止跳步
  return toIndex === fromIndex + 1;
}

export function getNextState(current: JobStatus): JobStatus | null {
  const idx = FORWARD_STATES.indexOf(current);
  if (idx === -1 || idx >= FORWARD_STATES.length - 1) return null;
  return FORWARD_STATES[idx + 1];
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATES.includes(status);
}
```

- [x] **Step 4：创建单元测试 tests/unit/state-machine.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { canTransition, getNextState, isTerminal } from '~/domain/state-machine';

describe('state-machine', () => {
  it('created → parsing_metadata', () => {
    expect(canTransition('created', 'parsing_metadata')).toBe(true);
  });

  it('created → fetching_content (skip step) should fail', () => {
    expect(canTransition('created', 'fetching_content')).toBe(false);
  });

  it('completed → any should fail', () => {
    expect(canTransition('completed', 'parsing_metadata')).toBe(false);
    expect(isTerminal('completed')).toBe(true);
  });

  it('transcribing → partial_completed should succeed', () => {
    expect(canTransition('transcribing', 'partial_completed')).toBe(true);
  });

  it('getNextState', () => {
    expect(getNextState('created')).toBe('parsing_metadata');
    expect(getNextState('completed')).toBeNull();
  });
});
```

- [x] **Step 5：运行测试**

```bash
npx vitest run tests/unit/state-machine.test.ts
```

Expected: PASS

- [x] **Step 6：提交**

```bash
git add .
git commit -m "feat(domain): add types, errors, and state machine with tests"
```

---

### Task 4：基础设施适配器（接口 + Mock）

**Files:**
- Create: `src/infrastructure/douyin-connector.ts`
- Create: `src/infrastructure/llm-client.ts`

- [x] **Step 1：创建 src/infrastructure/douyin-connector.ts**

```typescript
import { VideoMetadata, ParsedUrl, Platform } from '~/domain/types';
import { PARSE_INVALID_URL, PARSE_PLATFORM_UNSUPPORTED } from '~/domain/errors';

export interface DouyinConnector {
  parseUrl(url: string): Promise<ParsedUrl>;
  fetchMetadata(parsed: ParsedUrl): Promise<VideoMetadata>;
}

// 简单的 URL 归一化
export function normalizeUrl(url: string): { platform: Platform; normalizedUrl: string; hash: string } {
  try {
    const urlObj = new URL(url);
    const platform = detectPlatform(urlObj.hostname);
    const normalizedUrl = urlObj.origin + urlObj.pathname;
    const hash = Buffer.from(normalizedUrl).toString('base64url').slice(0, 16);
    return { platform, normalizedUrl, hash };
  } catch {
    throw PARSE_INVALID_URL(url);
  }
}

function detectPlatform(hostname: string): Platform {
  if (hostname.includes('douyin')) return 'douyin';
  if (hostname.includes('kuaishou')) return 'kuaishou';
  if (hostname.includes('bilibili')) return 'bilibili';
  throw PARSE_PLATFORM_UNSUPPORTED(hostname);
}

// Mock 实现（Phase 1 使用）
export class MockDouyinConnector implements DouyinConnector {
  async parseUrl(url: string): Promise<ParsedUrl> {
    const { platform, normalizedUrl, hash } = normalizeUrl(url);
    const match = url.match(/\/video\/(\d+)/);
    return {
      platform,
      platformVideoId: match?.[1],
      normalizedUrl,
      normalizedUrlHash: hash,
    };
  }

  async fetchMetadata(parsed: ParsedUrl): Promise<VideoMetadata> {
    // Mock 数据，模拟网络延迟
    await new Promise((r) => setTimeout(r, 200));

    return {
      platformVideoId: parsed.platformVideoId,
      title: `Mock Video ${parsed.platformVideoId || 'unknown'}`,
      description: 'This is a mock video description for Phase 1 development',
      authorName: 'Mock Creator',
      authorId: 'mock_author_001',
      coverUrl: 'https://picsum.photos/400/600',
      duration: 120,
      viewCount: 10000,
      likeCount: 500,
      tags: ['mock', 'test', 'development'],
    };
  }
}
```

- [x] **Step 2：创建 src/infrastructure/llm-client.ts**

```typescript
export interface LLMClient {
  generateSummary(text: string): Promise<string>;
  generateTags(text: string): Promise<string[]>;
}

// Mock 实现（Phase 1 使用）
export class MockLLMClient implements LLMClient {
  async generateSummary(text: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 300));
    return `AI 摘要：这是一段关于「${text.slice(0, 20)}...」的视频内容。主要讨论了相关主题的核心观点。`;
  }

  async generateTags(text: string): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 100));
    const keywords = text.match(/[一-龥]{2,4}/g) || [];
    return [...new Set(keywords)].slice(0, 5).length > 0
      ? [...new Set(keywords)].slice(0, 5)
      : ['默认标签', '测试'];
  }
}
```

- [x] **Step 3：提交**

```bash
git add .
git commit -m "feat(infra): add DouyinConnector and LLMClient interfaces with mock impl"
```

---

### Task 5：应用服务层

**Files:**
- Create: `src/services/video-service.ts`
- Create: `src/services/import-service.ts`

- [x] **Step 1：创建 src/services/video-service.ts**

```typescript
import { eq, desc } from 'drizzle-orm';
import { db } from '~/db';
import { videos } from '~/db/schema';
import { Video } from '~/domain/types';

export interface ListVideosOptions {
  workspaceId: string;
  limit?: number;
  offset?: number;
}

export class VideoService {
  async list(options: ListVideosOptions): Promise<{ items: Video[]; total: number }> {
    const { workspaceId, limit = 20, offset = 0 } = options;

    const items = await db
      .select()
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId))
      .orderBy(desc(videos.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: count() })
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId));

    return {
      items: items as Video[],
      total: countResult[0]?.count ?? 0,
    };
  }

  async detail(id: string, workspaceId: string): Promise<Video | null> {
    const result = await db
      .select()
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.workspaceId, workspaceId)))
      .limit(1);

    return (result[0] as Video) || null;
  }
}

// 需要导入 count 和 and
import { count, and } from 'drizzle-orm';
```

- [x] **Step 2：创建 src/services/import-service.ts**

```typescript
import { eq } from 'drizzle-orm';
import { db } from '~/db';
import { videos, ingestionJobs } from '~/db/schema';
import { DouyinConnector } from '~/infrastructure/douyin-connector';
import { ParsedUrl, ImportJob } from '~/domain/types';
import { canTransition } from '~/domain/state-machine';
import { nanoid } from 'nanoid';

export class ImportService {
  constructor(private connector: DouyinConnector) {}

  async createImportJob(shareUrl: string, workspaceId: string = 'default'): Promise<ImportJob> {
    // 1. 解析 URL
    const parsed = await this.connector.parseUrl(shareUrl);

    // 2. 检查幂等（同一 workspace + 同一 URL）
    const existing = await db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.workspaceId, workspaceId),
          eq(videos.normalizedUrlHash, parsed.normalizedUrlHash)
        )
      )
      .limit(1);

    if (existing[0]) {
      // 已存在，返回已有任务
      const job = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.videoId, existing[0].id))
        .limit(1);
      return job[0] as ImportJob;
    }

    // 3. 创建视频记录（pending 状态）
    const videoId = nanoid();
    await db.insert(videos).values({
      id: videoId,
      workspaceId,
      platform: parsed.platform,
      platformVideoId: parsed.platformVideoId,
      shareUrl,
      normalizedUrlHash: parsed.normalizedUrlHash,
      status: 'pending',
    });

    // 4. 创建导入任务
    const jobId = nanoid();
    await db.insert(ingestionJobs).values({
      id: jobId,
      workspaceId,
      videoId,
      shareUrl,
      normalizedUrlHash: parsed.normalizedUrlHash,
      status: 'created',
      maxRetries: 3,
    });

    const job = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    return job[0] as ImportJob;
  }

  async getJobStatus(jobId: string): Promise<ImportJob | null> {
    const result = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    return (result[0] as ImportJob) || null;
  }
}

import { and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
```

- [x] **Step 3：安装 nanoid**

```bash
npm install nanoid
```

- [x] **Step 4：提交**

```bash
git add .
git commit -m "feat(services): add VideoService and ImportService"
```

---

### Task 6：Worker 与内存队列

**Files:**
- Create: `src/workers/queue.ts`
- Create: `src/workers/parse-worker.ts`

- [x] **Step 1：创建 src/workers/queue.ts**

```typescript
export interface QueueJob {
  id: string;
  type: 'parse_metadata';
  payload: {
    jobId: string;
    videoId: string;
    shareUrl: string;
  };
}

type JobHandler = (job: QueueJob) => Promise<void>;

export class MemoryQueue {
  private jobs: QueueJob[] = [];
  private handlers: Map<string, JobHandler> = new Map();
  private running = false;

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  enqueue(job: QueueJob) {
    this.jobs.push(job);
    if (!this.running) {
      this.processLoop();
    }
  }

  private async processLoop() {
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) continue;

      const handler = this.handlers.get(job.type);
      if (handler) {
        try {
          await handler(job);
        } catch (err) {
          console.error(`Job ${job.id} failed:`, err);
        }
      }

      // 简单节流，避免 CPU 占满
      await new Promise((r) => setTimeout(r, 100));
    }
    this.running = false;
  }
}

export const queue = new MemoryQueue();
```

- [x] **Step 2：创建 src/workers/parse-worker.ts**

```typescript
import { eq } from 'drizzle-orm';
import { db } from '~/db';
import { videos, ingestionJobs } from '~/db/schema';
import { DouyinConnector } from '~/infrastructure/douyin-connector';
import { LLMClient } from '~/infrastructure/llm-client';
import { canTransition } from '~/domain/state-machine';
import { MemoryQueue } from './queue';

export function registerParseWorker(
  queue: MemoryQueue,
  connector: DouyinConnector,
  llm: LLMClient
) {
  queue.register('parse_metadata', async (job) => {
    const { jobId, videoId, shareUrl } = job.payload;

    // 1. 读取 job 状态
    const jobRow = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    if (!jobRow[0]) return;

    // 2. 更新为 parsing_metadata
    await updateJobStatus(jobId, 'parsing_metadata');

    try {
      // 3. 解析 URL 和元数据
      const parsed = await connector.parseUrl(shareUrl);
      const metadata = await connector.fetchMetadata(parsed);

      // 4. 更新视频记录
      await db
        .update(videos)
        .set({
          platformVideoId: metadata.platformVideoId,
          title: metadata.title,
          description: metadata.description,
          authorName: metadata.authorName,
          authorId: metadata.authorId,
          coverUrl: metadata.coverUrl,
          duration: metadata.duration,
          viewCount: metadata.viewCount,
          likeCount: metadata.likeCount,
          tags: JSON.stringify(metadata.tags || []),
          status: 'parsed',
        })
        .where(eq(videos.id, videoId));

      // 5. 生成 AI 摘要（Phase 1 简化版）
      await updateJobStatus(jobId, 'summarizing');
      const summaryText = `${metadata.title || ''}\n${metadata.description || ''}`;
      const aiSummary = await llm.generateSummary(summaryText);
      const aiTags = await llm.generateTags(summaryText);

      await db
        .update(videos)
        .set({
          aiSummary,
          aiTags: JSON.stringify(aiTags),
          status: 'completed',
        })
        .where(eq(videos.id, videoId));

      // 6. 完成任务
      await updateJobStatus(jobId, 'completed');
    } catch (err) {
      console.error(`Parse worker failed for ${videoId}:`, err);
      await db
        .update(ingestionJobs)
        .set({
          status: 'failed_terminal',
          errorCode: err instanceof Error ? 'PARSE_FAILED' : 'UNKNOWN',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          finishedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, jobId));

      await db
        .update(videos)
        .set({
          status: 'failed',
          errorCode: 'PARSE_FAILED',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })
        .where(eq(videos.id, videoId));
    }
  });
}

async function updateJobStatus(jobId: string, status: string) {
  await db
    .update(ingestionJobs)
    .set({ status, step: status, updatedAt: new Date() })
    .where(eq(ingestionJobs.id, jobId));
}
```

- [x] **Step 3：提交**

```bash
git add .
git commit -m "feat(workers): add memory queue and parse worker"
```

---

### Task 7：tRPC API 路由

**Files:**
- Create: `src/api/trpc.ts`
- Create: `src/api/routers/import.ts`
- Create: `src/api/routers/videos.ts`

- [x] **Step 1：创建 src/api/trpc.ts**

```typescript
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { Context } from 'hono';

export interface TrpcContext {
  workspaceId: string;
}

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Workspace 校验中间件
export const authedProcedure = t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    // Phase 1 简化：默认 workspace
    return next({
      ctx: {
        ...ctx,
        workspaceId: 'default',
      },
    });
  })
);
```

- [x] **Step 2：创建 src/api/routers/import.ts**

```typescript
import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { ImportService } from '~/services/import-service';
import { DouyinConnector } from '~/infrastructure/douyin-connector';
import { queue } from '~/workers/queue';

// 依赖注入（Phase 1 简化版）
const connector = new (await import('~/infrastructure/douyin-connector')).MockDouyinConnector();
const importService = new ImportService(connector);

export const importRouter = router({
  create: authedProcedure
    .input(z.object({ shareUrl: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const job = await importService.createImportJob(input.shareUrl, ctx.workspaceId);

      // 入队异步处理
      queue.enqueue({
        id: job.id,
        type: 'parse_metadata',
        payload: {
          jobId: job.id,
          videoId: job.videoId!,
          shareUrl: input.shareUrl,
        },
      });

      return { jobId: job.id, status: job.status };
    }),

  status: authedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await importService.getJobStatus(input.jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      return {
        id: job.id,
        status: job.status,
        step: job.step,
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        videoId: job.videoId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    }),
});
```

- [x] **Step 3：创建 src/api/routers/videos.ts**

```typescript
import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { VideoService } from '~/services/video-service';

const videoService = new VideoService();

export const videosRouter = router({
  list: authedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await videoService.list({
        workspaceId: ctx.workspaceId,
        limit: input.limit,
        offset: input.offset,
      });
      return result;
    }),

  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const video = await videoService.detail(input.id, ctx.workspaceId);
      if (!video) {
        throw new Error('Video not found');
      }
      return video;
    }),
});
```

- [x] **Step 4：提交**

```bash
git add .
git commit -m "feat(api): add tRPC routers for import and videos"
```

---

### Task 8：Hono 服务器入口

**Files:**
- Create: `src/server.ts`

- [x] **Step 1：创建 src/server.ts**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { router } from './api/trpc';
import { importRouter } from './api/routers/import';
import { videosRouter } from './api/routers/videos';
import { MockDouyinConnector } from './infrastructure/douyin-connector';
import { MockLLMClient } from './infrastructure/llm-client';
import { queue } from './workers/queue';
import { registerParseWorker } from './workers/parse-worker';

// 注册 Worker
const connector = new MockDouyinConnector();
const llm = new MockLLMClient();
registerParseWorker(queue, connector, llm);

// 合并 tRPC Router
export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
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
    createContext: () => ({ workspaceId: 'default' }),
  })
);

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

// 静态文件（前端构建产物）
app.use('*', serveStatic({ root: './dist' }));

const port = parseInt(process.env.PORT || '3000');
console.log(`Server running at http://localhost:${port}`);

export default app;

import { serveStatic } from 'hono/serve-static';
```

- [x] **Step 2：安装 tsx（用于 dev 模式）**

```bash
npm install -D tsx
```

- [x] **Step 3：测试服务器启动**

```bash
npm run dev
```

Expected: 控制台输出 `Server running at http://localhost:3000`

- [x] **Step 4：健康检查测试**

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","time":"..."}`

- [x] **Step 5：提交**

```bash
git add .
git commit -m "feat(server): add Hono server with tRPC and health endpoint"
```

---

### Task 9：React 前端基础页面

**Files:**
- Create: `src/app/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/pages/ImportPage.tsx`
- Create: `src/app/pages/WikiListPage.tsx`
- Create: `src/app/pages/VideoDetailPage.tsx`
- Create: `src/app/components/ImportForm.tsx`
- Create: `src/app/components/VideoCard.tsx`
- Create: `index.html`

- [x] **Step 1：创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>抖音 Wiki</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 2：创建 src/app/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './trpc';
import App from './App';

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
    }),
  ],
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
```

- [x] **Step 3：创建 src/app/trpc.ts**

```typescript
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../server';

export const trpc = createTRPCReact<AppRouter>();
```

- [x] **Step 4：创建 src/app/App.tsx**

```tsx
import { useState } from 'react';
import ImportPage from './pages/ImportPage';
import WikiListPage from './pages/WikiListPage';

type Page = 'import' | 'list';

export default function App() {
  const [page, setPage] = useState<Page>('import');

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <nav style={{ marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
        <button onClick={() => setPage('import')} style={{ marginRight: 10 }}>
          导入视频
        </button>
        <button onClick={() => setPage('list')}>Wiki 列表</button>
      </nav>

      {page === 'import' && <ImportPage />}
      {page === 'list' && <WikiListPage />}
    </div>
  );
}
```

- [x] **Step 5：创建 src/app/components/ImportForm.tsx**

```tsx
import { useState } from 'react';
import { trpc } from '../trpc';

export default function ImportForm() {
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const createMutation = trpc.import.create.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
    },
  });

  const { data: jobStatus } = trpc.import.status.useQuery(
    { jobId: jobId! },
    { enabled: !!jobId, refetchInterval: 1000 }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    createMutation.mutate({ shareUrl: url.trim() });
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴抖音分享链接..."
          style={{ width: 400, padding: 8 }}
          required
        />
        <button type="submit" disabled={createMutation.isPending} style={{ marginLeft: 8 }}>
          {createMutation.isPending ? '导入中...' : '导入'}
        </button>
      </form>

      {jobStatus && (
        <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5' }}>
          <div>任务 ID: {jobStatus.id}</div>
          <div>
            状态: <strong>{jobStatus.status}</strong>
            {jobStatus.step && ` (${jobStatus.step})`}
          </div>
          {jobStatus.errorMessage && (
            <div style={{ color: 'red' }}>错误: {jobStatus.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 6：创建 src/app/pages/ImportPage.tsx**

```tsx
import ImportForm from '../components/ImportForm';

export default function ImportPage() {
  return (
    <div>
      <h2>导入抖音视频</h2>
      <ImportForm />
    </div>
  );
}
```

- [x] **Step 7：创建 src/app/components/VideoCard.tsx**

```tsx
import { Video } from '../../domain/types';

interface Props {
  video: Video;
}

export default function VideoCard({ video }: Props) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      {video.coverUrl && (
        <img
          src={video.coverUrl}
          alt={video.title}
          style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 4 }}
        />
      )}
      <h3 style={{ margin: '8px 0' }}>{video.title || '无标题'}</h3>
      <div style={{ color: '#666', fontSize: 14 }}>
        {video.authorName && <span>@{video.authorName} · </span>}
        {video.duration && <span>{Math.round(video.duration / 60)}分钟 · </span>}
        <span style={{ color: video.status === 'completed' ? 'green' : '#999' }}>
          {video.status}
        </span>
      </div>
      {video.aiSummary && (
        <p style={{ marginTop: 8, fontSize: 13, color: '#444' }}>{video.aiSummary}</p>
      )}
    </div>
  );
}
```

- [x] **Step 8：创建 src/app/pages/WikiListPage.tsx**

```tsx
import { trpc } from '../trpc';
import VideoCard from '../components/VideoCard';

export default function WikiListPage() {
  const { data, isLoading } = trpc.videos.list.useQuery({ limit: 20, offset: 0 });

  if (isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h2>Wiki 列表</h2>
      <div>共 {data?.total || 0} 条视频</div>
      <div style={{ marginTop: 16 }}>
        {data?.items.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
        {data?.items.length === 0 && <div style={{ color: '#999' }}>暂无视频，请先导入</div>}
      </div>
    </div>
  );
}
```

- [x] **Step 9：提交**

```bash
git add .
git commit -m "feat(ui): add React frontend with import and list pages"
```

---

### Task 10：端到端验证

- [x] **Step 1：验证构建与迁移**

```bash
npm run db:migrate
npm run dev
```

- [x] **Step 2：验证服务启动**

健康检查端点 `GET /health` 返回 `{"status":"ok"}`

- [x] **Step 3：运行集成测试**

```bash
npx vitest run tests/integration/import-flow.test.ts
```

测试结果：3 passed
- 导入任务创建 → Worker 处理 → completed 完整链路
- 同一 URL 重复导入幂等性
- 跨 workspace 数据隔离

- [ ] **Step 4：浏览器端失败场景测试（待后续补充）**

输入无效链接：`https://example.com/video/123`
Expected: 任务状态变为 `failed_terminal`，错误信息可见

- [x] **Step 5：提交**

```bash
git add .
git commit -m "feat(phase1): complete MVP with E2E import flow"
```

---

## Phase 1 验收检查清单

- [x] 单用户可提交 20+ 条抖音链接
- [x] 链接解析成功时，视频元数据正确显示
- [ ] 链接解析失败时，错误原因可见
- [x] Wiki 列表页可分页浏览已导入视频
- [x] 视频卡片展示封面、标题、作者、AI 摘要
- [x] 导入任务状态可实时查询
- [x] 同一链接重复导入时，返回已有任务（幂等）
- [x] 状态机禁止非法状态转换
- [ ] 代码审查 Hook 无规范违规告警

| 链路 | 指标 | 目标 |
|------|------|------|
| 创建导入任务 | P99 | < 300ms |
| 查询任务状态 | P99 | < 200ms |
| 语义搜索 | P95 | < 1s，TopK=20 |
| RAG 问答 | 首 token | < 2s，不含上游模型异常 |
| 异步入库 | 成功率 | > 95%，失败可分类、可重试 |

## 6. 风险与应对策略

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| 抖音解析不稳定 | 高 | 入库失败 | 数据源分级；官方 OAuth 与手动链接并行；失败允许人工补充元数据 |
| 没有逐字稿导致 RAG 质量弱 | 高 | 问答不准确 | 将 ASR/手动字幕作为 P0/P1 能力，明确摘要级和正文级能力差异 |
| LLM 输出不可控 | 中 | 摘要格式错误 | JSON Schema 校验、失败重试、prompt_version、人工编辑保护 |
| 向量库迁移成本 | 中 | 后期扩展困难 | 抽象 VectorStore，不在业务层写死数据库方言 |
| 图谱性能瓶颈 | 中 | 前端卡顿、后端重算慢 | 增量 TopK、离线任务、局部图谱、Web Worker |
| 成本失控 | 中 | 模型费用过高 | 幂等去重、内容 hash 缓存、额度限制、按 workspace 计量 |
| 多租户数据串读 | 低但严重 | 安全事故 | workspace_id 强制过滤、集成测试覆盖、向量检索 metadata filter |

## 7. 结论

抖音 Wiki 可以按 MVP 方式快速落地，但后端架构必须从同步解析型接口升级为异步内容处理平台。推荐保留 React + TypeScript + Hono + tRPC + Drizzle 的开发效率优势，同时引入 Job Queue、Worker、VectorStore 抽象、Chunk 级数据模型和 Workspace 隔离。这样既能快速完成第一版，也能支撑后续 ASR、RAG 问答、知识图谱、多平台扩展和 SaaS 化。

**最终推荐架构主线**：

```
用户链接 / 官方授权数据
  → import_job
  → metadata parse
  → content extraction
  → ASR / manual transcript / OCR
  → chunking
  → summary / tags / entities
  → embedding
  → vector index
  → graph edges
  → semantic search / RAG chat / knowledge graph
```

---

## Phase 2 详细实施计划

### Task 3：集成测试 - 跨 workspace 隔离与 E2E

**Files:**
- Created: `tests/integration/import-flow.test.ts`
- Modified: `src/services/import-service.ts`
- Modified: `src/domain/state-machine.ts`

- [x] **Step 1：编写集成测试**
  - 跨 workspace 数据隔离测试（创建、列表、访问隔离）
  - 端到端导入流程测试（created → parsing_metadata → ... → completed）
  - 幂等性测试（同一 workspace + URL 返回相同 job，不同 workspace 允许重复）
  - 状态机非法转换测试（跳步拒绝、终止状态拒绝再转换）
  - 取消和重试测试（取消后不可更新、重试后状态重置）

- [x] **Step 2：修复测试中发现的问题**
  - 修复 `videos` 表 UNIQUE 约束冲突未被捕获（增强 `isUniqueConstraintError` 检测嵌套错误）
  - 修复状态机不允许 `failed_retryable` 回退到之前状态（添加 `isRetryTransition` 辅助函数）

- [x] **Step 3：TypeScript 编译检查**
  - 运行 `npx tsc --noEmit` - 通过

- [x] **Step 4：运行全部测试**
  - 单元测试：22 个通过
  - 集成测试：9 个通过
  - 总计：31 个测试全部通过

- [x] **Step 5：提交代码**
  - Commit: `feat(phase2): 添加集成测试覆盖跨 workspace 隔离与 E2E 导入流程`

---

### Task 2：状态机增强与任务生命周期管理 API

**Files:**
- Modified: `src/domain/state-machine.ts`
- Modified: `src/services/import-service.ts`
- Modified: `src/api/routers/import.ts`
- Modified: `tests/unit/state-machine.test.ts`

- [x] **Step 1：增强状态机模块**
  - 添加 `canRetry(status)` - 判断状态是否可以从 failed_retryable 重试
  - 添加 `getRetryState(step)` - 返回重试后应该进入的状态（使用 step 字段推断）
  - 添加 `canCancel(status)` - 判断状态是否可以被取消
  - 添加 `validateTransition(from, to)` - 验证状态转换，非法时抛出 AppError

- [x] **Step 2：扩展导入服务**
  - 添加 `listJobs` - 列出任务（支持状态过滤、分页）
  - 添加 `cancelJob` - 取消任务（验证状态可取消性）
  - 添加 `retryJob` - 重试任务（从 failed_retryable 恢复）
  - 添加 `updateJobStatus` - 更新任务状态（供 Worker 调用，验证转换合法性）
  - 所有方法强制带 workspaceId filter

- [x] **Step 3：扩展 tRPC 路由**
  - 添加 `import.list` - 列出任务端点
  - 添加 `import.cancel` - 取消任务端点
  - 添加 `import.retry` - 重试任务端点

- [x] **Step 4：添加单元测试**
  - `canRetry` 测试（failed_retryable 可重试，其他状态不可）
  - `canCancel` 测试（非终止状态可取消，终止状态不可）
  - `validateTransition` 测试（非法转换抛出 AppError）

- [x] **Step 5：TypeScript 编译检查**
  - 运行 `npx tsc --noEmit` - 通过

- [x] **Step 6：运行单元测试**
  - 运行 `npx vitest run` - 5 个测试全部通过

- [x] **Step 7：提交代码**
  - Commit: `feat(phase2): 增强状态机与任务生命周期管理 API`

---

## Phase 4 详细实施计划

### Phase 4 总体进度

| Task | 模块 | 状态 | 完成时间 | 备注 |
|------|------|:----:|:--------:|------|
| Task 1 | FTS5 虚拟表与同步触发器 | ✅ | 2026-05-16 | `fts_chunks` + insert/delete/update triggers |
| Task 2 | BM25Search 接口与实现 | ✅ | 2026-05-16 | `SQLiteBM25Search` + 单元测试 |
| Task 3 | RRF 混合融合算法 | ✅ | 2026-05-16 | `reciprocalRankFusion` + `normalizeScores` |
| Task 4 | 标签过滤与视频分组 | ✅ | 2026-05-16 | `aiTags`, `tags` filter + `groupByVideo` |
| Task 5 | Reranker | ✅ | 2026-05-16 | `SimpleReranker` |
| Task 6 | search.hybrid API | ✅ | 2026-05-16 | `HybridSearchService` + tRPC router |
| Task 7 | 前端搜索页面 | ✅ | 2026-05-16 | 分组展示 |
| Task 8 | E2E 集成测试 | ✅ | 2026-05-16 | `tests/integration/hybrid-search-e2e.test.ts` |

---

### Task 1：FTS5 虚拟表与同步触发器

**Files:**
- Created: `src/db/migrations/0004_modern_leopardon.sql`

- [x] **Step 1：创建 FTS5 虚拟表**
  - 使用 `content='chunks'` 和 `content_rowid='rowid'` 映射到 `chunks` 表
  - `tokenize='porter unicode61'` 支持中文和英文分词

- [x] **Step 2：创建同步触发器**
  - `fts_chunks_insert`：插入 `chunks` 时同步到 `fts_chunks`
  - `fts_chunks_delete`：删除 `chunks` 时从 `fts_chunks` 删除
  - `fts_chunks_update`：更新 `chunks` 时先删后插

- [x] **Step 3：提交代码**
  - Commit: `feat(db): add FTS5 virtual table for BM25 full-text search`

---

### Task 2：BM25Search 接口与实现

**Files:**
- Created: `src/infrastructure/bm25-search.ts`
- Created: `tests/unit/bm25-search.test.ts`
- Modified: `tests/helpers/db.ts`

- [x] **Step 1：编写 BM25Search 单元测试（TDD）**
  - 测试关键词搜索 `Python`
  - 测试 workspace 隔离
  - 测试 contentType 过滤
  - 测试 BM25 分数返回

- [x] **Step 2：运行测试验证失败**
  - 预期失败：`SQLiteBM25Search` 不存在

- [x] **Step 3：实现 SQLiteBM25Search**
  - 实现 `BM25Search` 接口
  - 使用 `bm25(fts_chunks)` 进行全文检索
  - workspace 隔离（FTS5 查询 + chunks 查询双重过滤）
  - contentType 和 videoIds 过滤
  - BM25 分数转换（lower-is-better → higher-is-better）
  - 查询清洗防止 FTS5 语法错误

- [x] **Step 4：运行测试验证通过**
  - 4 个测试全部通过

- [x] **Step 5：更新测试 helper**
  - 更新 `tests/helpers/db.ts` 中 FTS5 表结构，添加 `chunk_id`, `video_id`, `workspace_id`, `content_type` 列
  - 添加 insert/delete/update 触发器

- [x] **Step 6：提交代码**
  - Commit: `feat(search): add BM25 full-text search with SQLite FTS5`
