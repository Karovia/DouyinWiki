# 项目上下文

## 技术栈

- **核心**: Vite 7, TypeScript, Express
- **UI**: React 19, Tailwind CSS 4, Motion (Framer Motion), Lucide React
- **状态管理**: React useState + useEffect (轻量级)
- **API**: tRPC (Express adapter) — 前端通过 @trpc/client 调用
- **数据库**: libSQL (SQLite兼容) + Drizzle ORM (@libsql/client, 纯JS无原生依赖)
- **AI**: 可配置多 Provider（OpenAI / Ollama / LM Studio / vLLM 等兼容 OpenAI API 的服务）— 后端调用

## 目录结构

```
├── scripts/            # 构建与启动脚本
│   ├── build.sh        # 构建脚本
│   ├── dev.sh          # 开发环境启动脚本
│   ├── prepare.sh      # 预处理脚本
│   └── start.sh        # 生产环境启动脚本
├── server/             # 服务端逻辑
│   ├── connectors/     # 外部服务连接器（抖音、LLM、S3存储）
│   ├── db/             # Drizzle ORM Schema + 数据库初始化
│   ├── domain/         # 领域类型定义
│   ├── routes/         # 传统 API 路由（健康检查）
│   ├── trpc/           # tRPC 路由（import, videos, qa）
│   ├── workers/        # 异步任务队列 + Worker
│   ├── server.ts       # Express 服务入口
│   └── vite.ts         # Vite 中间件集成
├── src/                # 前端源码
│   ├── components/     # UI 组件（Header, Footer, ImportForm, ProcessingCard, WikiGrid）
│   ├── App.tsx         # 主应用（路由 + tRPC 调用）
│   ├── app-router.types.ts  # tRPC 类型定义（与后端同步）
│   ├── trpc.ts         # tRPC 客户端配置
│   ├── types.ts        # 前端领域类型
│   ├── main.tsx        # React 入口
│   └── index.css       # 全局样式（Tailwind + Geist 字体）
├── index.html          # 入口 HTML
├── package.json        # 项目依赖管理
├── tsconfig.json       # TypeScript 配置
└── vite.config.ts      # Vite 配置
```

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。

## API 接口

### tRPC 端点（/trpc）

- `import.create` — 创建导入任务（mutation）
- `import.status` — 查询任务状态（query，轮询）
- `import.retry` — 重试失败任务（mutation）
- `videos.list` — 分页查询视频列表（query）
- `videos.detail` — 查询视频详情（query）
- `videos.delete` — 删除视频及云端文件（mutation）
- `videos.playUrl` — 获取视频签名播放URL（query）
- `qa.ask` — 基于视频内容回答问题（mutation）

### 传统 REST 端点

- `GET /api/health` — 健康检查

## 开发规范

- 使用 Tailwind CSS 进行样式开发
- 前端组件使用 motion/react 做动画
- tRPC 类型通过 `src/app-router.types.ts` 手动同步（不直接引用后端代码）
- 后端 Worker 异步处理导入流水线，前端轮询状态

### 编码规范

- 默认按 TypeScript `strict` 心智写代码
- 禁止隐式 `any` 和 `as any`
- 函数参数、返回值、事件对象应有明确类型
