# 抖音 Wiki 前端设计文档（Phase 1）

## 1. 前端技术栈

| 层级 | 技术选型 | 版本 | 用途 |
|------|----------|------|------|
| 框架 | React | 19.2.6 | UI 组件与页面渲染 |
| 语言 | TypeScript | 6.0.3 | 类型安全开发 |
| 构建工具 | Vite | 8.0.13 | 开发与生产构建 |
| 数据获取 | @tanstack/react-query | 5.100.10 | 服务端状态管理、缓存、自动重试 |
| 远程调用 | @trpc/react-query | 11.17.0 | 端到端类型安全的 API 调用 |
| 协议 | tRPC + httpBatchLink | 11.17.0 | 批量请求、类型推导 |
| JSX 转换 | @vitejs/plugin-react | 6.0.2 | Vite React 插件 |
| 入口 HTML | index.html | - | Vite SPA 入口 |

> **技术选型说明：** Phase 1 采用最简前端架构，不引入路由库（如 React Router）和全局状态库（如 Redux/Zustand），以条件渲染（`page` state）切换页面。所有服务端状态通过 `@tanstack/react-query` + tRPC 管理，天然支持自动刷新、去重、缓存失效。

---

## 2. 项目文件结构

```
src/app/
├── main.tsx              # React 根入口：QueryClient + tRPC Client 初始化
├── trpc.ts               # tRPC React 客户端创建（createTRPCReact）
├── App.tsx               # 根布局：导航栏 + 页面条件渲染
├── pages/
│   ├── ImportPage.tsx    # 导入页面容器
│   └── WikiListPage.tsx  # Wiki 列表页面容器
└── components/
    ├── ImportForm.tsx    # 导入表单（输入框 + 提交 + 状态轮询）
    └── VideoCard.tsx     # 视频卡片（封面 + 标题 + 作者 + AI 摘要）
```

---

## 3. 页面设计

### 3.1 根布局（App.tsx）

```
┌──────────────────────────────────────┐
│  [导入视频]  [Wiki 列表]              │  ← 导航栏
├──────────────────────────────────────┤
│                                      │
│  {page === 'import' ?                │
│    <ImportPage />                    │
│  :                                   │
│    <WikiListPage />                  │
│  }                                   │
│                                      │
└──────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 最大宽度 | 800px |
| 水平居中 | `margin: 0 auto` |
| 内边距 | 20px |
| 导航栏边框 | `border-bottom: 1px solid #eee` |

---

### 3.2 导入页面（ImportPage）

**路由/状态：** `page === 'import'`

**页面结构：**
```
┌──────────────────────────────────────┐
│  导入抖音视频                         │  ← 页面标题（h2）
│                                      │
│  ┌──────────────────────┐ [导入]     │  ← ImportForm
│  │ 粘贴抖音分享链接...   │          │
│  └──────────────────────┘            │
│                                      │
│  任务 ID: xxx                         │  ← 状态面板（导入后显示）
│  状态: created (parsing_metadata)     │
│  错误: ...                            │
│                                      │
└──────────────────────────────────────┘
```

---

### 3.3 Wiki 列表页面（WikiListPage）

**路由/状态：** `page === 'list'`

**页面结构：**
```
┌──────────────────────────────────────┐
│  Wiki 列表                            │  ← 页面标题（h2）
│  共 1 条视频                          │  ← 总数统计
│                                      │
│  ┌────────────────────────────────┐  │
│  │ [封面图]                        │  │  ← VideoCard × N
│  │ Mock Video 123456              │  │
│  │ @Mock Creator · 2分钟 · completed│  │
│  │ AI 摘要：这是一段关于...         │  │
│  └────────────────────────────────┘  │
│                                      │
│  暂无视频，请先导入                   │  ← 空状态
│                                      │
└──────────────────────────────────────┘
```

---

## 4. 组件详细设计

### 4.1 ImportForm 组件

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/app/components/ImportForm.tsx` |
| 职责 | URL 输入、提交导入任务、轮询任务状态 |
| 内部状态 | `url: string` — 输入框内容 |
| 内部状态 | `jobId: string \| null` — 当前任务 ID |
| tRPC Mutation | `trpc.import.create.useMutation()` — 创建导入任务 |
| tRPC Query | `trpc.import.status.useQuery()` — 每秒轮询任务状态 |

**数据流：**
```
用户输入 URL → 点击「导入」→ mutation.mutate({ shareUrl })
                                    ↓
                              onSuccess: setJobId(data.jobId)
                                    ↓
                              触发 useQuery（enabled: !!jobId）
                                    ↓
                              refetchInterval: 1000ms 轮询状态
                                    ↓
                              状态面板实时显示 created → ... → completed
```

---

### 4.2 VideoCard 组件

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/app/components/VideoCard.tsx` |
| 职责 | 展示单条视频的元数据、AI 摘要和状态 |
| Props | `video: Video`（来自 `src/domain/types.ts`） |

**字段展示映射：**

| 数据源 | 展示位置 | 说明 |
|--------|----------|------|
| `video.coverUrl` | `<img src={coverUrl}>` | 封面图，400×600 比例 |
| `video.title` | `<h3>` | 视频标题，无标题时显示「无标题」 |
| `video.authorName` | 元信息行 | 前缀 `@`，如 `@Mock Creator` |
| `video.duration` | 元信息行 | 转换为分钟，如 `2分钟` |
| `video.status` | 元信息行 | 颜色编码：`completed` → 绿色，其他 → 灰色 |
| `video.aiSummary` | `<p>` | AI 生成的摘要，字号 13px |

**样式规范：**

| 元素 | 样式 |
|------|------|
| 卡片容器 | `border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px` |
| 封面图 | `width: 100%; height: 180px; object-fit: cover; border-radius: 4px` |
| 标题 | `margin: 8px 0` |
| 元信息 | `color: #666; font-size: 14px` |
| AI 摘要 | `margin-top: 8px; font-size: 13px; color: #444` |

---

## 5. 按钮清单

以下列出前端所有交互按钮及其功能说明。

| 序号 | 按钮文本 | 所在组件 | 触发事件 | 状态/禁用规则 | 功能说明 |
|------|----------|----------|----------|---------------|----------|
| 1 | **导入视频** | App.tsx | `onClick` | 始终可用 | 切换页面状态到 `page = 'import'`，显示导入表单 |
| 2 | **Wiki 列表** | App.tsx | `onClick` | 始终可用 | 切换页面状态到 `page = 'list'`，显示视频列表 |
| 3 | **导入** | ImportForm.tsx | `type="submit"` | `disabled={createMutation.isPending}` | 提交 URL 到后端，创建异步导入任务 |
| 4 | **导入中...** | ImportForm.tsx | `type="submit"` | 自动替换（mutation pending 时） | 提交按钮的 loading 状态，防止重复提交 |

### 5.1 按钮交互详细说明

#### 按钮 1/2：导航切换按钮

```tsx
// App.tsx 第 13-16 行
<nav>
  <button onClick={() => setPage('import')}>
    导入视频
  </button>
  <button onClick={() => setPage('list')}>
    Wiki 列表
  </button>
</nav>
```

| 属性 | 值 |
|------|-----|
| 事件处理器 | `onClick={() => setPage('import' \| 'list')}` |
| 状态变量 | `page: 'import' \| 'list'` |
| 初始值 | `'import'` |
| 无样式类 | 纯原生 `<button>`，无 CSS 类 |

#### 按钮 3/4：导入提交按钮

```tsx
// ImportForm.tsx 第 36-38 行
<button
  type="submit"
  disabled={createMutation.isPending}
>
  {createMutation.isPending ? '导入中...' : '导入'}
</button>
```

| 属性 | 值 |
|------|-----|
| 按钮类型 | `type="submit"`（隶属于 `<form>`） |
| 禁用条件 | `createMutation.isPending === true` |
| Loading 文案 | `导入中...` |
| 默认文案 | `导入` |
| 提交事件 | `handleSubmit`（`e.preventDefault()` + `mutation.mutate()`） |
| 防重复提交 | 通过 `disabled` + mutation pending 状态双重保障 |

---

## 6. tRPC API 调用清单

| 调用方 | tRPC Hook | 端点 | 类型 | 输入 | 输出 | 说明 |
|--------|-----------|------|------|------|------|------|
| ImportForm | `useMutation` | `import.create` | Mutation | `{ shareUrl: string }` | `{ jobId: string, status: JobStatus }` | 创建导入任务 |
| ImportForm | `useQuery` | `import.status` | Query | `{ jobId: string }` | `{ id, status, step, progress, errorCode, errorMessage, ... }` | 每秒轮询任务状态，`refetchInterval: 1000` |
| WikiListPage | `useQuery` | `videos.list` | Query | `{ limit: number, offset: number }` | `{ items: Video[], total: number }` | 分页加载视频列表 |

---

## 7. 状态管理

### 7.1 服务端状态（React Query）

| 状态键 | 类型 | 来源 | 缓存策略 |
|--------|------|------|----------|
| `import.status` | Query | tRPC `import.status` | 主动轮询（1s），任务完成后可停止 |
| `videos.list` | Query | tRPC `videos.list` | 默认缓存，切换页面后自动失效/刷新 |

### 7.2 客户端状态（React useState）

| 状态 | 组件 | 类型 | 初始值 | 说明 |
|------|------|------|--------|------|
| `page` | App.tsx | `'import' \| 'list'` | `'import'` | 当前活跃页面，条件渲染控制 |
| `url` | ImportForm.tsx | `string` | `''` | 导入链接输入框内容 |
| `jobId` | ImportForm.tsx | `string \| null` | `null` | 当前导入任务 ID，控制状态查询的启用 |

---

## 8. 数据流时序图

### 8.1 视频导入流程

```
用户                    前端                        后端                    Worker
 │                       │                          │                       │
 │  输入 URL + 点击导入   │                          │                       │
 │ ────────────────────> │                          │                       │
 │                       │  POST /trpc/import.create  │                       │
 │                       │ ────────────────────────>│                       │
 │                       │                          │  创建 ingestionJobs   │
 │                       │                          │  + videos (pending)   │
 │                       │  { jobId, status }       │                       │
 │                       │ <────────────────────────│                       │
 │                       │                          │  queue.enqueue(...)   │
 │                       │                          │ ─────────────────────>│
 │  显示「任务 ID: xxx」  │                          │                       │
 │ <──────────────────── │                          │                       │
 │                       │                          │                       │  解析元数据
 │                       │  GET /trpc/import.status │                       │  生成 AI 摘要
 │                       │  (refetchInterval: 1s)   │                       │  更新 DB
 │                       │ <────────────────────────>│                       │
 │  状态: parsing...     │                          │                       │
 │ <──────────────────── │                          │                       │
 │                       │                          │                       │
 │  状态: completed      │                          │                       │
 │ <──────────────────── │                          │                       │
 │                       │                          │                       │
 │  切换「Wiki 列表」     │  GET /trpc/videos.list   │                       │
 │ ────────────────────> │ ────────────────────────>│                       │
 │                       │  { items: [Video], ... } │                       │
 │                       │ <────────────────────────│                       │
 │  显示视频卡片          │                          │                       │
 │ <──────────────────── │                          │                       │
```

---

## 9. Phase 1 已知限制

| 限制 | 说明 | 后续规划 |
|------|------|----------|
| 无路由库 | 使用 `useState` 条件渲染，无浏览器历史 | Phase 2+ 引入 React Router |
| 无全局状态 | 无 Zustand/Redux，服务端状态全交 React Query | Phase 3+ 按需引入 |
| 无样式系统 | 使用内联 `style`，无 Tailwind/CSS-in-JS | Phase 2+ 引入 Tailwind CSS |
| 无组件库 | 使用原生 HTML 元素 | Phase 2+ 引入 shadcn/ui 或 Ant Design |
| 无图谱页 | Phase 1 仅实现导入 + 列表 | Phase 5 实现知识图谱页 |
| 无搜索页 | Phase 1 仅基础 CRUD | Phase 4 实现语义搜索页 |
| 无视频详情页 | VideoCard 仅展示摘要，无详情跳转 | Phase 2+ 添加详情页路由 |
| 无分页 UI | 仅传入 limit/offset，无分页控件 | Phase 2 添加分页组件 |
| 无错误边界 | React 错误直接崩溃 | Phase 2 添加 ErrorBoundary |
| 无加载骨架 | `isLoading` 时仅显示「加载中...」文本 | Phase 2 添加 Skeleton |
