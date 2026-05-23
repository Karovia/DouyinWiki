# 抖音视频知识库

基于 Express + Vite + TypeScript + Tailwind CSS 的全栈 Web 应用，用于导入抖音视频并构建可问答的知识库。

**核心特性：**
- 导入抖音分享链接，自动提取标题、作者、封面、标签
- AI 自动生成视频摘要和结构化知识点
- 基于视频内容的智能问答（RAG）
- 支持配置多个 LLM Provider，灵活切换模型
- 本地文件存储，无需外部云服务

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 9+

### 环境配置

复制 `.env.example` 为 `.env`，并根据需要修改配置：

```bash
cp .env.example .env
```

最小可运行配置：

```bash
NODE_ENV=development
DATABASE_URL=file:./data/app.db
```

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

启动后，在浏览器中打开 [http://localhost:5000](http://localhost:5000) 查看应用。

### 构建生产版本

```bash
pnpm build
```

构建产物位于 `dist/`（前端）和 `dist-server/`（后端）。

### 启动生产服务器

```bash
pnpm start
```

## 配置第一个模型 API

首次启动后，需要进入「设置」页面配置 LLM Provider：

1. 打开应用，点击顶部导航栏的「设置」
2. 点击「添加 Provider」
3. 填写以下信息：
   - **名称**：任意标识，如 "OpenAI"、"SiliconFlow"
   - **Base URL**：API 服务地址
     - OpenAI 官方：`https://api.openai.com/v1`
     - SiliconFlow：`https://api.siliconflow.cn/v1`
     - 自定义服务：填写你的服务地址
   - **API Key**：从服务商获取的密钥
   - **默认模型**：如 `gpt-4o`、`deepseek-chat`、`Qwen/Qwen2.5-72B-Instruct`
4. 点击「测试连接」验证配置是否正确
5. 保存后，系统会自动将该 Provider 设为默认

### 支持的模型服务

| 服务商 | Base URL | 示例模型 |
|--------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3`, `Qwen/Qwen2.5-72B-Instruct` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-max`, `qwen-plus` |
| 任意 OpenAI-compatible 服务 | 你的服务地址 | 你的模型名称 |

## 配置本地模型（Ollama / LM Studio / vLLM）

### Ollama

1. 安装并启动 Ollama：[https://ollama.com](https://ollama.com)
2. 拉取模型：`ollama pull qwen2.5`
3. 在设置页面添加 Provider：
   - Base URL：`http://localhost:11434/v1`
   - API Key：任意非空字符串（Ollama 不验证）
   - 默认模型：`qwen2.5`

### LM Studio

1. 安装 LM Studio 并启动本地服务器
2. 在设置页面添加 Provider：
   - Base URL：`http://localhost:1234/v1`
   - API Key：任意非空字符串
   - 默认模型：加载的模型名称

### vLLM

1. 启动 vLLM 服务：`vllm serve your-model`
2. 在设置页面添加 Provider：
   - Base URL：`http://localhost:8000/v1`
   - API Key：任意非空字符串
   - 默认模型：`your-model`

## 数据持久化

应用使用 SQLite 数据库存储所有数据，默认路径为 `./data/app.db`。

### 使用 `data/` 目录持久化

推荐将 `data/` 目录挂载到宿主机或备份该目录：

```bash
# 确保 data 目录存在
mkdir -p data

# 启动应用（数据库和上传的文件都会保存在 data/ 中）
pnpm start
```

### Docker 部署时挂载

```bash
docker run -v $(pwd)/data:/app/data -p 5000:5000 your-image
```

### 备份与恢复

```bash
# 备份
cp -r data data-backup-$(date +%Y%m%d)

# 恢复
cp -r data-backup-20250101 data
```

## 项目结构

```
├── server/                # 后端服务器目录
│   ├── connectors/        # 外部服务连接器（抖音、LLM、本地存储）
│   ├── db/                # Drizzle ORM Schema + 数据库初始化
│   ├── domain/            # 领域类型定义
│   ├── routes/            # API 路由目录
│   ├── trpc/              # tRPC 路由
│   ├── workers/           # 异步任务队列 + Worker
│   ├── server.ts          # Express 服务入口
│   └── vite.ts            # Vite 集成逻辑
├── src/                   # 前端源码目录
│   ├── components/        # UI 组件
│   ├── App.tsx            # 主应用
│   └── main.tsx           # React 入口
├── data/                  # 数据持久化目录（数据库 + 上传文件）
├── scripts/               # 构建与启动脚本
├── index.html             # HTML 入口文件
├── vite.config.ts         # Vite 配置
└── tsconfig.json          # TypeScript 配置
```

## 核心开发规范

- 使用 pnpm 管理依赖
- 使用 TypeScript 进行类型安全开发
- 使用 Tailwind CSS 进行样式开发
- API 路由以 `/api` 或 `/trpc` 开头

## 技术栈

**前端：**
- Vite 7.x
- React 19
- TypeScript 5.x
- Tailwind CSS 4.x
- tRPC Client

**后端：**
- Express 4.x
- tRPC (Express adapter)
- Drizzle ORM + libSQL (SQLite)

**AI：**
- OpenAI-compatible API
- 支持多 Provider 动态切换

## 常见问题

**Q: 如何更换默认模型？**

进入「设置」页面，添加新的 Provider 并点击「设为默认」，或编辑现有 Provider 修改默认模型。

**Q: 数据库文件在哪里？**

默认在 `./data/app.db`，可通过 `DATABASE_URL` 环境变量修改。

**Q: 上传的视频封面和文件存在哪里？**

默认在 `./data/media/` 目录下，与数据库一起持久化。
