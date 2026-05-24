# CLAUDE.md — Douyin Wiki 项目指南

> 本文档是 Claude 与本项目协作的入口。每次代码变更后，必须同步更新本文档中对应的章节。
>
> **更新约定**：修改了技术栈 → 更新「技术栈」章节；新增/重构了模块 → 更新「项目架构」；完成了新任务 → 更新「当前任务进度」；发现了重要约束 → 更新「关键约束与约定」。

---

## 技术栈

| 层级 | 技术 | 版本 | 备注 |
|------|------|------|------|
| 前端框架 | React | ^19.2.6 | 函数组件 + Hooks |
| 前端构建 | Vite | ^7.2.4 | `vite.ts` 中配置 dev server，生产构建走 `scripts/build.sh` |
| 样式 | Tailwind CSS | ^4.3.0 | `@tailwindcss/vite` 插件 |
| 动画 | motion/react | ^12.38.0 | — |
| 状态管理 | React Query (TanStack) | ^5.100.10 | 配合 tRPC 使用 |
| 路由/视图 | 手写视图切换 | — | `App.tsx` 中 `View` 类型：`'import' | 'list' | 'mta' | 'settings'` |
| 后端框架 | Express | ^4.21.2 | 入口 `server.ts` |
| API 层 | tRPC | ^11.17.0 | server/client 两端：`@trpc/server`, `@trpc/client`, `@trpc/react-query` |
| ORM | Drizzle ORM | ^0.45.2 | SQLite 方言 |
| 数据库 | SQLite (@libsql/client) | ^0.17.3 | 本地文件，`DATABASE_URL` 控制路径 |
| 验证 | Zod | ^3 | 用于 tRPC input/output 校验 |
| ID 生成 | nanoid | ^5.1.11 | — |
| Markdown | react-markdown + remark-gfm | ^10.1.0 / ^4.0.1 | 渲染 AI 生成的 Markdown 内容 |
| 图标 | lucide-react | ^1.16.0 | — |
| 包管理器 | pnpm | >=9.0.0 | `preinstall` 钩子强制使用 |

### 环境变量（运行时必须）

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | SQLite 数据库路径 | `file:./data/douyin-wiki.db` |
| `DATA_DIR` | 数据目录根路径 | `./data` |
| `APP_SECRET` | AES-256-GCM 加密密钥 | 32+ 字符随机字符串 |
| `HOSTNAME` | 服务器监听地址 | `0.0.0.0` 或 `127.0.0.1` |
| `PORT` | 服务器端口 | `3000` |

> 开发时复制 `.env.example` 为 `.env` 并填充实际值。

---

## 项目架构

```
douyin-wiki/
├── server/                     # 后端（Express + tRPC）
│   ├── connectors/             # 外部服务连接器
│   │   ├── douyin-connector.ts     # 抖音视频元数据抓取
│   │   ├── llm-connector.ts        # LLM 业务函数（摘要/标签/QA/MTA/深度研究）
│   │   ├── storage-connector.ts    # 本地文件存储（替代原 S3Storage）
│   │   └── llm/                    # LLM Provider 抽象层
│   │       ├── types.ts                # 共享类型（LlmMessage, LlmInvokeOptions 等）
│   │       ├── openai-compatible-provider.ts  # OpenAI-compatible API 实现
│   │       ├── provider-registry.ts    # Provider 注册与选择（含 API Key 解密）
│   │       └── llm-service.ts          # 业务入口（invokeDefaultLlm）
│   ├── db/                     # 数据库
│   │   ├── index.ts                # 数据库连接 + initDatabase()
│   │   └── schema.ts               # Drizzle 表定义
│   ├── domain/                 # 领域类型
│   │   └── types.ts                # JobStatus, ErrorCode, 状态转换规则
│   ├── trpc/                   # tRPC 路由
│   │   ├── root-router.ts          # 根路由聚合
│   │   ├── import-router.ts        # 导入任务 API
│   │   ├── videos-router.ts        # 视频管理 API
│   │   ├── qa-router.ts            # 视频 QA API
│   │   ├── mta-router.ts           # MTA（做菜/健身/旅游/深度研究）API
│   │   └── settings-router.ts      # LLM Provider / App Settings API
│   ├── utils/                  # 共享工具
│   │   ├── crypto.ts               # AES-256-GCM API Key 加密/解密
│   │   └── path-security.ts        # 跨平台路径安全检查
│   ├── workers/                # 后台 Worker
│   │   ├── import-worker.ts        # 导入流水线（解析→下载→摘要→标签）
│   │   └── worker-queue.ts         # Worker 注册框架
│   ├── server.ts               # Express 入口（路由 + /media 静态文件 + tRPC）
│   └── vite.ts                 # Vite dev server 配置
├── src/                        # 前端（React）
│   ├── components/             # 页面级组件
│   │   ├── App.tsx                 # 视图路由 + 全局状态
│   │   ├── Header.tsx              # 顶部导航
│   │   ├── ImportPage.tsx          # 导入页面
│   │   ├── VideoListPage.tsx       # 视频列表
│   │   ├── VideoDetailPage.tsx     # 视频详情 + QA
│   │   ├── MtaPage.tsx             # MTA 工作台
│   │   └── SettingsPage.tsx        # 模型服务管理（Provider CRUD + 测试）
│   ├── trpc.ts                 # tRPC 客户端封装（轻量 fetch 实现）
│   └── main.tsx                # React 应用入口
├── scripts/                    # 构建/开发脚本
│   ├── build.sh
│   ├── dev.sh
│   └── start.sh
├── data/                       # 运行时数据目录（gitignore）
│   ├── douyin-wiki.db            # SQLite 数据库
│   └── uploads/                  # 本地文件存储（视频/封面/帧）
├── .env.example                # 环境变量模板
├── package.json
├── tsconfig.json
├── LLM_SELF_HOST_MIGRATION_PLAN.md   # 迁移计划原文
├── MIGRATION_EXECUTION_LOG.md        # 迁移执行记录（含问题与修复）
├── POST_MVP_DEVELOPMENT_PLAN.md      # 后期开发计划
└── CLAUDE.md                   # 本文件
```

### 数据流

1. **导入流程**：用户提交抖音链接 → `import-router.ts` 创建 ingestion job → `import-worker.ts` 异步处理
   - 解析元数据 (`douyin-connector.ts`) → 下载视频/封面 (`storage-connector.ts`) → 生成摘要和标签 (`llm-connector.ts`)
2. **LLM 调用链**：业务函数 (`llm-connector.ts`) → `llm-service.ts` → `provider-registry.ts`（选择默认 Provider + 解密 API Key）→ `openai-compatible-provider.ts`（HTTP fetch）
3. **多模态降级**：vision 不可用 → 只用文本；video 不可用 → 用关键帧；关键帧不可用 → 纯文本
4. **文件访问**：`getSignedUrl(key)` → `/media/{key}` → `express.static` 从 `DATA_DIR/uploads/` 读取

---

## 当前任务进度

> 基于迁移执行记录 `MIGRATION_EXECUTION_LOG.md`，最后更新：2026-05-24

### 已完成 — 阶段 1~7（LLM 自部署迁移）

| 阶段 | 任务 | 状态 | 关键提交 |
|------|------|------|----------|
| 1 | 基础自部署清理（NODE_ENV、DATABASE_URL、.env.example） | 完成 | a9c1818, a3942f1, e63f09a |
| 2 | 本地文件存储替换 S3Storage | 完成 | a5e6fbf, 2c39a96, 58fb1fe |
| 3 | LLM Provider 数据库与 settings API | 完成 | be819a8, 2d6e771, 50965d7 |
| 4 | OpenAI-compatible LLM Client | 完成 | 62fe606, eae6444 |
| 5 | 视频多模态降级（并入阶段4） | 完成 | — |
| 6 | 前端设置页（Provider CRUD + 测试） | 完成 | 67b4523, e99cbb9 |
| 7 | 彻底移除 SDK 和文档清理 | 完成 | e50b050, 81319cf |

**验收状态**：`pnpm validate` 通过、`pnpm build` 通过、`pnpm dev` 可启动、`/api/health` 正常。

### 待验证（需配置真实模型 API）

- [ ] 抖音导入全流程（链接解析 → 封面/视频下载 → 摘要/标签生成）
- [ ] 视频 QA（视觉/视频分析降级链路）
- [ ] 删除视频时本地文件同步删除
- [ ] 多 Provider 切换和故障转移

### 待完成 — POST-MVP（参见 `POST_MVP_DEVELOPMENT_PLAN.md`）

按优先级排列：

1. **端到端测试覆盖** — 导入流程、AI 功能降级链路、文件删除
2. **Provider 故障转移** — `llm-service.ts` 中当默认 Provider 失败时自动尝试下一个
3. **llm-connector.ts 拆分** — 当前 1100+ 行，按业务域拆分为多个 connector
4. **重复 JSON 解析提取** — 7 处重复逻辑合并为共享工具函数
5. **自定义 Headers 支持** — `_customHeaders` 参数接入 provider 配置
6. **批量导入** — 支持同时提交多个抖音链接
7. **Wiki 内容导出** — Markdown / HTML 导出功能
8. **搜索增强** — 全文搜索 + 标签筛选
9. **暗色模式** — Tailwind CSS dark mode 适配
10. **数据备份/恢复** — SQLite 导出 + uploads 目录打包

---

## 关键约束与约定

### 代码约定

1. **每次代码变更必须同步更新本文档**。如果修改了架构，更新「项目架构」章节；如果完成了新任务，更新「当前任务进度」；如果发现了新的环境变量要求，更新「环境变量」表格。
2. **路径安全**：所有文件操作必须通过 `path-security.ts` 中的 `isPathInside()` 检查，禁止 `../` 越界。跨平台使用正斜杠统一化（`replace(/\\/g, '/')`）。
3. **API Key 加密**：所有存储到数据库的 API Key 必须使用 `crypto.ts` 的 `encryptApiKey()` / `decryptApiKey()`。每次加密使用随机 salt，通过 scryptSync 派生密钥。加密后的格式为 `salt:iv:tag:ciphertext`（Base64）。
4. **tRPC 客户端**：前端使用手写轻量 fetch 客户端（非 `@trpc/client` 标准 HTTP 客户端），请求格式为 `POST /trpc/{router}.{procedure}?batch=1`，避免 v11 streaming 的 415 错误。
5. **Worker 容错**：`import-worker.ts` 中单步骤失败不导致整个任务崩溃，视频/封面上传失败是非致命错误。
6. **LLM 降级策略**：调用 LLM 前先检查 Provider 能力（video → vision → text），逐级降级，不得在没有 vision 能力的 Provider 上发送图片 URL。
7. **静态文件路由**：`/media` 路由使用 `app.use('/media', securityMiddleware, express.static(...))`，禁止在 `app.get` 回调内嵌套 `express.static`（会导致 `req.url` 包含前缀，路径解析错误）。

### 数据库约定

- `workspaceId` 默认值为 `'ws_default'`，已提取为 `DEFAULT_WORKSPACE_ID` 常量（`llm-connector.ts`）。
- `llm_providers` 表中的 `capabilities` 字段为 JSON 字符串，格式：`["text", "vision", "video"]`。
- `app_settings` 表用于存储全局配置（如默认 Provider ID）。

---

## 快速参考

```bash
# 安装依赖
pnpm install

# 开发（热重载）
pnpm dev

# 类型检查 + lint
pnpm validate

# 生产构建
pnpm build

# 启动生产服务
pnpm start

# 数据库迁移（Drizzle）
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

*本文档最后由 Claude 于 2026-05-24 编写。后续每次代码变更后请更新对应章节。*
