# 扣子 SDK 移除与自部署大模型设置改造计划

## 1. 背景与目标

当前项目的大模型、对象存储、网页抓取能力都与 `coze-coding-dev-sdk` 存在耦合。为了让项目可以本地自部署，并允许用户在设置页自由添加 OpenAI-compatible 或类似协议的大模型 API，需要完成一次基础设施层改造。

本次改造目标：

- 完全移除 `coze-coding-dev-sdk` 依赖。
- 新增设置页，允许用户添加、编辑、测试、启用多个大模型 API。
- 后端通过统一 LLM Provider 抽象调用模型，不再硬编码扣子 SDK 或豆包模型。
- 默认支持本地部署：本地 SQLite 数据库、本地文件存储、普通 `pnpm dev/build/start` 启动。
- 保留现有功能：抖音导入、AI 摘要、标签生成、视频问答、MTA 烹饪/健身/旅游/深度研究。

## 2. 当前耦合点盘点

### 2.1 LLM 调用

文件：`server/connectors/llm-connector.ts`

现状：

- 第 6 行直接导入 `LLMClient`、`Config`。
- 第 7 行直接导入 SDK 的 `ContentPart` 类型。
- 多处通过 `new LLMClient(new Config())` 创建客户端。
- 多处硬编码模型名：
  - `doubao-seed-2-0-pro-260215`
  - `doubao-seed-2-0-mini-260215`
- 文件顶部还存在硬编码 Kimi API Key，需要立即移除。

影响范围：

- `generateSummary`
- `generateTags`
- `askWithSummary`
- `askWithVideo`
- `generateCookingRecipe`
- `generateTrainingPlan`
- `generateTravelPlan`
- `generateDeepResearch`

### 2.2 对象存储

文件：`server/connectors/storage-connector.ts`

现状：

- 直接导入 `S3Storage`。
- 读取 `COZE_BUCKET_ENDPOINT_URL`、`COZE_BUCKET_NAME`。
- 当前存储接口被以下文件依赖：
  - `server/workers/import-worker.ts`
  - `server/trpc/videos-router.ts`
  - `server/trpc/qa-router.ts`
  - `server/trpc/mta-router.ts`
  - `server/connectors/llm-connector.ts`

当前导出的函数需要保留兼容：

- `uploadFromUrl`
- `uploadBuffer`
- `getSignedUrl`
- `deleteFile`
- `fileExists`

### 2.3 抖音网页抓取

文件：`server/connectors/douyin-connector.ts`

现状：

- 直接导入 `FetchClient`。
- 当短链无法正常重定向或 HTML 解析失败时，会 fallback 到 `fetchClient.fetch(shareUrl)`。

改造后需要移除此 fallback，改成普通 `fetch` + HTML/JSON 解析。为了提高自部署稳定性，可增加可选 Douyin Cookie 配置。

### 2.4 自部署环境变量

文件：

- `server/db/index.ts`
- `server/server.ts`
- `server/vite.ts`
- `scripts/*.sh`
- `README.md`

现状：

- 使用 `COZE_PROJECT_ENV` 判断环境。
- 生产数据库路径写死到 `/tmp/douyin-wiki.db`，不适合长期自部署。
- `scripts/prepare.sh` 仍调用 `coze check-bins`。
- README 仍以 `coze dev/build/start` 为主要命令。

### 2.5 前端导航与页面结构

文件：

- `src/App.tsx`
- `src/components/Header.tsx`
- `src/trpc.ts`

现状：

- 当前主视图只有 `import | list | mta`。
- Header 主导航只有“导入视频 / Wiki列表 / MTA”。
- 尚无设置页，也无 settings tRPC 客户端封装。

## 3. 改造后的目标架构

### 3.1 分层结构

建议改造为以下结构：

```text
server/
  connectors/
    llm/
      types.ts
      provider-registry.ts
      openai-compatible-provider.ts
      llm-service.ts
    storage-connector.ts
    douyin-connector.ts
  trpc/
    settings-router.ts
  db/
    schema.ts
    index.ts
src/
  components/
    SettingsPage.tsx
  trpc.ts
```

职责划分：

- `llm/types.ts`：定义项目自己的消息、内容块、provider、capability 类型。
- `openai-compatible-provider.ts`：实现 OpenAI-compatible `/v1/chat/completions` 调用。
- `provider-registry.ts`：读取数据库配置，解析默认 provider。
- `llm-service.ts`：承接现有 `generateSummary` 等业务函数，内部调用 provider。
- `storage-connector.ts`：默认使用本地文件系统存储。
- `settings-router.ts`：提供设置页 CRUD 和测试连接 API。
- `SettingsPage.tsx`：提供前端模型 API 配置界面。

### 3.2 LLM Provider 能力模型

每个 provider 建议具备以下字段：

```ts
interface LlmProviderConfig {
  id: string;
  workspaceId: string;
  name: string;
  providerType: 'openai_compatible';
  baseUrl: string;
  apiKey: string;
  defaultTextModel: string;
  defaultVisionModel: string | null;
  defaultVideoModel: string | null;
  capabilities: {
    text: boolean;
    vision: boolean;
    video: boolean;
    jsonMode: boolean;
  };
  isDefault: boolean;
  enabled: boolean;
}
```

第一阶段只实现 `openai_compatible`。后续可扩展：

- `ollama`
- `anthropic`
- `gemini`
- `azure_openai`
- `custom`

### 3.3 多模态策略

不同模型能力不一致，建议按以下降级链处理：

1. 如果 provider 支持 `video`，尝试视频 URL 输入。
2. 如果 provider 支持 `vision`，用 ffmpeg 抽关键帧，将多张图片作为 `image_url` 输入。
3. 如果 provider 只支持 `text`，只使用标题、描述、已有摘要、标签生成结果。

这能保证本地部署用户即使只配置普通文本模型，也能跑通主流程，只是视频深度理解能力会下降。

## 4. 数据库改造

### 4.1 新增表：`llm_providers`

建议在 `server/db/schema.ts` 增加：

```ts
export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull().default('openai_compatible'),
  baseUrl: text('base_url').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  defaultTextModel: text('default_text_model').notNull(),
  defaultVisionModel: text('default_vision_model'),
  defaultVideoModel: text('default_video_model'),
  capabilities: text('capabilities').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

### 4.2 新增表：`app_settings`

用于保存本地存储、抖音 Cookie 等通用设置：

```ts
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

建议设置项：

- `douyin.cookie`
- `storage.mode`
- `storage.localDataDir`
- `llm.defaultProviderId`

### 4.3 初始化迁移

在 `server/db/index.ts` 中新增：

- `CREATE TABLE IF NOT EXISTS llm_providers (...)`
- `CREATE TABLE IF NOT EXISTS app_settings (...)`
- `CREATE INDEX IF NOT EXISTS idx_llm_providers_workspace ON llm_providers(workspace_id)`
- `CREATE INDEX IF NOT EXISTS idx_llm_providers_default ON llm_providers(workspace_id, is_default)`

### 4.4 API Key 存储

最低要求：

- 不再硬编码 API Key。
- 不在前端返回完整 API Key。
- 数据库中字段命名为 `api_key_encrypted`，即使第一阶段只做基础加密，也保留后续升级空间。

建议方案：

- 使用 `APP_SECRET` 作为加密密钥。
- Node `crypto.createCipheriv('aes-256-gcm', ...)` 加密。
- 如果未设置 `APP_SECRET`，启动时提示用户设置；开发环境可生成临时密钥，但应打印警告。

## 5. tRPC API 设计

新增文件：`server/trpc/settings-router.ts`

挂载到 `server/trpc/root-router.ts`：

```ts
export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  qa: qaRouter,
  mta: mtaRouter,
  settings: settingsRouter,
});
```

### 5.1 Provider 列表

```ts
settings.providers.list
```

输入：

```ts
{
  workspaceId: string;
}
```

输出：

```ts
{
  providers: Array<{
    id: string;
    name: string;
    providerType: string;
    baseUrl: string;
    hasApiKey: boolean;
    defaultTextModel: string;
    defaultVisionModel: string | null;
    defaultVideoModel: string | null;
    capabilities: ProviderCapabilities;
    isDefault: boolean;
    enabled: boolean;
    createdAt: number | null;
    updatedAt: number | null;
  }>;
}
```

### 5.2 新增 Provider

```ts
settings.providers.create
```

输入：

```ts
{
  workspaceId: string;
  name: string;
  providerType: 'openai_compatible';
  baseUrl: string;
  apiKey: string;
  defaultTextModel: string;
  defaultVisionModel?: string;
  defaultVideoModel?: string;
  capabilities: ProviderCapabilities;
  setDefault?: boolean;
}
```

### 5.3 更新 Provider

```ts
settings.providers.update
```

注意：

- `apiKey` 为空或不传时，不覆盖旧 key。
- 只有用户输入新 key 时才更新。

### 5.4 删除 Provider

```ts
settings.providers.delete
```

规则：

- 如果删除默认 provider，需要自动选择另一个 enabled provider 作为默认。
- 如果没有可用 provider，导入和 AI 功能应提示“请先配置模型”。

### 5.5 设置默认 Provider

```ts
settings.providers.setDefault
```

同一 workspace 下只能有一个默认 provider。

### 5.6 测试连接

```ts
settings.providers.test
```

测试逻辑：

- 请求 `${baseUrl}/v1/chat/completions`。
- 使用用户填写的 text model。
- 发送一句轻量 prompt，例如：`请回复 OK`。
- 成功则返回模型响应耗时。
- 失败时返回明确错误信息，但不要泄露 API Key。

### 5.7 获取模型列表

可选：

```ts
settings.providers.models
```

请求 `${baseUrl}/v1/models`。部分 provider 不支持，应允许失败。

## 6. LLM Connector 改造细节

### 6.1 定义项目自己的消息类型

新增：`server/connectors/llm/types.ts`

```ts
export type LlmRole = 'system' | 'user' | 'assistant';

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'video_url'; video_url: { url: string; fps?: number } };

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

export interface LlmInvokeOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  capability?: 'text' | 'vision' | 'video';
}

export interface LlmInvokeResult {
  content: string;
  modelName: string;
  providerId: string;
}
```

### 6.2 OpenAI-compatible provider

新增：`server/connectors/llm/openai-compatible-provider.ts`

职责：

- 拼接 `baseUrl.replace(/\/$/, '') + '/v1/chat/completions'`。
- 添加 `Authorization: Bearer ${apiKey}`。
- 将 `maxTokens` 映射为 `max_tokens`。
- 将项目内部 `image_url` 内容转换为 OpenAI-compatible 格式。
- 默认不传 `video_url`，除非 provider 标记支持 video。

### 6.3 业务函数迁移

保留原有业务函数名，降低调用方改动：

- `generateSummary`
- `generateTags`
- `askWithSummary`
- `askWithVideo`
- `generateCookingRecipe`
- `generateTrainingPlan`
- `generateTravelPlan`
- `generateDeepResearch`

内部替换：

```ts
const result = await invokeDefaultLlm(messages, {
  capability: 'vision',
  modelPurpose: 'summary',
  temperature: 0.5,
});
return result.content.trim();
```

### 6.4 模型用途映射

建议在 provider 配置里先简单使用三类模型：

- `defaultTextModel`：标签、纯文本问答、深度研究。
- `defaultVisionModel`：摘要、图片帧分析、MTA。
- `defaultVideoModel`：视频直传分析，可为空。

后续可扩展细粒度用途：

- summary model
- tag model
- qa model
- research model
- mta model

## 7. 本地存储改造

### 7.1 默认存储目录

建议：

```text
data/
  douyin-wiki.db
  uploads/
    videos/
    covers/
    frames/
```

默认环境变量：

```env
DATA_DIR=./data
DATABASE_URL=file:./data/douyin-wiki.db
```

### 7.2 storage-connector 保持函数兼容

保留现有函数签名：

```ts
uploadFromUrl(url, fileName, contentType)
uploadBuffer(buffer, fileName, contentType)
getSignedUrl(key, expireTime)
deleteFile(key)
fileExists(key)
```

但内部实现改为：

- `uploadFromUrl`：fetch 下载后写入本地文件。
- `uploadBuffer`：直接写入本地文件。
- `getSignedUrl`：返回 `/media/${encodeURIComponent(key)}` 或带 token 的 `/media/...`。
- `deleteFile`：删除本地文件。
- `fileExists`：检查本地文件是否存在。

### 7.3 Express 静态文件路由

在 `server/server.ts` 增加：

```ts
app.use('/media', express.static(resolveDataUploadsDir()));
```

如果需要避免任意文件访问，要确保 key 被限制在 `uploads` 目录内，路径解析必须防止 `../`。

## 8. 抖音连接器改造

### 8.1 移除 SDK import

删除：

```ts
import { FetchClient } from 'coze-coding-dev-sdk';
import type { FetchResponse, FetchContentItem } from 'coze-coding-dev-sdk';
```

### 8.2 删除 FetchClient fallback

移除：

```ts
const fetchClient = new FetchClient();
const response = await fetchClient.fetch(shareUrl);
return extractMetaFromStructuredContent(response, defaultMeta);
```

### 8.3 保留和强化 HTML 解析

保留现有：

- `normalizeDouyinUrl`
- `fetchRawHtml`
- `extractRenderData`
- `extractMetaFromRenderData`
- `extractMetaFromHtml`
- `extractCoverUrl`
- `extractVideoPlayUrl`

### 8.4 可选 Douyin Cookie 设置

新增设置项：

- `douyin.cookie`

`fetchRawHtml` 读取设置后注入 Cookie：

```ts
headers: {
  'User-Agent': '...',
  'Cookie': douyinCookie || '',
}
```

注意：设置页应提示 Cookie 仅保存在本地服务端。

## 9. 前端设置页设计

### 9.1 路由状态扩展

修改 `src/App.tsx`：

```ts
type View = 'import' | 'list' | 'mta' | 'settings';
```

修改 `src/components/Header.tsx`：

```ts
const mainNavItems = [
  { key: 'import', label: '导入视频' },
  { key: 'list', label: 'Wiki列表' },
  { key: 'mta', label: 'MTA' },
  { key: 'settings', label: '设置' },
] as const;
```

### 9.2 新增 SettingsPage

新增文件：`src/components/SettingsPage.tsx`

页面模块：

- 模型服务列表
- 新增模型服务表单
- 编辑模型服务弹窗或内联表单
- 测试连接按钮
- 默认 provider 标记
- 删除 provider
- 抖音 Cookie 配置
- 本地存储状态展示

### 9.3 表单字段

大模型 API 表单：

- 服务名称
- Base URL，例如 `http://localhost:11434` 或 `https://api.openai.com`
- API Key
- 文本模型名
- 视觉模型名
- 视频模型名
- 能力开关：
  - 文本
  - 图片
  - 视频
  - JSON 模式
- 是否设为默认

### 9.4 前端 tRPC 客户端

修改 `src/trpc.ts`，新增：

```ts
export const settingsApi = {
  listProviders: (...) => trpcQuery(...),
  createProvider: (...) => trpcMutation(...),
  updateProvider: (...) => trpcMutation(...),
  deleteProvider: (...) => trpcMutation(...),
  setDefaultProvider: (...) => trpcMutation(...),
  testProvider: (...) => trpcMutation(...),
};
```

## 10. 自部署脚本与文档改造

### 10.1 package.json

移除：

```json
"coze-coding-dev-sdk": "^0.7.22"
```

保留 pnpm 限制。

### 10.2 scripts/prepare.sh

删除：

```sh
if command -v coze > /dev/null 2>&1 && coze check-bins --help > /dev/null 2>&1; then
  coze check-bins --fix
fi
```

### 10.3 环境变量示例

新增 `.env.example`：

```env
NODE_ENV=development
PORT=5000
HOSTNAME=0.0.0.0

DATA_DIR=./data
DATABASE_URL=file:./data/douyin-wiki.db

APP_SECRET=change-me-to-a-long-random-string
```

### 10.4 README 更新

将 Coze 命令替换为：

```sh
pnpm install
pnpm dev
pnpm build
pnpm start
```

补充：

- 如何配置第一个模型 API。
- 如何配置本地 Ollama / LM Studio / vLLM / OpenAI-compatible 服务。
- 如何挂载 `data/` 目录用于持久化。

## 11. 分阶段实施计划

### 阶段 1：基础自部署清理

目标：项目不依赖 Coze 环境即可启动。

任务：

- 将 `COZE_PROJECT_ENV` 替换为 `NODE_ENV`。
- 将数据库路径改为 `DATABASE_URL` 或 `DATA_DIR` 下的默认路径。
- 新增 `.env.example`。
- 清理 `scripts/prepare.sh` 中的 Coze CLI 调用。
- 更新 README 启动说明。

验收：

- `pnpm install`
- `pnpm ts-check`
- `pnpm dev`
- 浏览器可打开本地页面。
- `/api/health` 正常返回。

### 阶段 2：本地文件存储替换 S3Storage

目标：移除存储层 SDK 依赖。

任务：

- 重写 `server/connectors/storage-connector.ts`。
- 增加 `/media` 静态路由。
- 确保 `uploadFromUrl`、`uploadBuffer`、`getSignedUrl`、`deleteFile`、`fileExists` 兼容旧调用。
- 增加路径安全检查，禁止 `../` 越界访问。

验收：

- 导入视频后，封面和视频写入 `data/uploads`。
- Wiki 列表能显示封面。
- 详情弹窗能播放本地视频。
- 删除视频时本地文件也被删除。

### 阶段 3：LLM Provider 数据库与 settings API

目标：后端能保存、读取、测试模型配置。

任务：

- 新增 `llm_providers` 表。
- 新增 API key 加密工具。
- 新增 `settings-router.ts`。
- root router 挂载 `settings`。
- 实现 provider CRUD。
- 实现 test connection。

验收：

- 可通过 tRPC 新增 provider。
- list 接口不返回完整 API key。
- test 接口可调用配置的模型并返回成功/失败。

### 阶段 4：OpenAI-compatible LLM Client

目标：业务 LLM 调用不再依赖扣子 SDK。

任务：

- 新增项目内 LLM 类型定义。
- 新增 OpenAI-compatible provider 实现。
- 新增 provider registry。
- 将 `llm-connector.ts` 的 SDK 调用替换为新 client。
- 删除硬编码 Kimi key。
- 删除所有 `LLMClient`、`Config`、SDK `ContentPart` 引用。

验收：

- `rg "LLMClient|Config|ContentPart|coze-coding-dev-sdk" server` 不再命中有效引用。
- 配置模型后可以生成摘要。
- 可以生成标签。
- 可以进行 QA。
- MTA 三类生成和深度研究可用。

### 阶段 5：视频多模态降级

目标：没有视频理解 API 时仍能用抽帧方案完成分析。

任务：

- 标准化抽帧函数，作为视频分析公共能力。
- provider 支持 video 时优先直传。
- provider 支持 vision 时抽帧传图。
- provider 只支持 text 时降级文本。
- 在结果中记录实际使用的 model/provider/capability。

验收：

- 文本模型可完成基础摘要和标签。
- 视觉模型可基于封面/关键帧完成 MTA。
- 视频模型可直接分析视频 URL。
- 不支持能力时有清晰错误或降级提示。

### 阶段 6：前端设置页

目标：用户可以在 UI 中管理模型 API。

任务：

- Header 新增“设置”。
- App 增加 settings view。
- 新增 `SettingsPage.tsx`。
- `src/trpc.ts` 新增 settings API。
- 支持新增、编辑、删除、测试、设为默认。
- 支持配置 Douyin Cookie。

验收：

- 可以从页面新增 provider。
- 可以测试连接。
- 可以设为默认。
- 删除默认 provider 后有合理提示或自动切换。
- API Key 不明文回显。

### 阶段 7：彻底移除 SDK 和文档清理

目标：仓库不再含扣子 SDK 依赖。

任务：

- 从 `package.json` 删除 `coze-coding-dev-sdk`。
- `pnpm install` 更新 lockfile。
- 清理 README 和 AGENTS 中的旧描述。
- 清理所有 `COZE_*` 环境变量引用。

验收：

- `rg "coze-coding-dev-sdk|LLMClient|S3Storage|FetchClient|COZE_" .` 无业务代码命中。
- `pnpm validate` 通过。
- `pnpm build` 通过。
- 本地启动后导入、摘要、问答、MTA 主流程可用。

## 12. 风险与处理方案

### 12.1 抖音解析成功率下降

移除 `FetchClient` 后，短链和页面解析可能不如 SDK 稳定。

处理：

- 支持用户配置 Douyin Cookie。
- 加强 `RENDER_DATA`、`ROUTER_DATA`、meta tag、正则解析。
- 允许无视频文件时仍保存元数据和摘要。

### 12.2 模型能力差异

不同 OpenAI-compatible 服务对图片、JSON、视频支持不一致。

处理：

- 设置页显式配置 capabilities。
- 后端按能力降级。
- test connection 分为文本测试和视觉测试。

### 12.3 API Key 安全

本地部署不能把 key 明文暴露给前端。

处理：

- 后端加密存储。
- 前端只显示 `hasApiKey`。
- 日志禁止打印 Authorization header。

### 12.4 数据持久化

当前生产 DB 在 `/tmp`，自部署有丢数据风险。

处理：

- 默认写入 `./data/douyin-wiki.db`。
- Docker 或服务器部署时挂载 `data/`。

### 12.5 ffmpeg 依赖

抽帧依赖系统 ffmpeg。

处理：

- 启动时可检测 ffmpeg 是否存在。
- 设置页展示 ffmpeg 状态。
- 如果不可用，视频分析降级为文本。

## 13. 验收清单

基础：

- [ ] `pnpm install` 成功。
- [ ] `pnpm validate` 成功。
- [ ] `pnpm build` 成功。
- [ ] `pnpm dev` 可本地启动。
- [ ] `/api/health` 正常。

SDK 移除：

- [ ] `package.json` 无 `coze-coding-dev-sdk`。
- [ ] `pnpm-lock.yaml` 无 `coze-coding-dev-sdk`。
- [ ] 业务代码无 `LLMClient`。
- [ ] 业务代码无 `S3Storage`。
- [ ] 业务代码无 `FetchClient`。
- [ ] 业务代码无 `COZE_BUCKET_*`。

设置页：

- [ ] 可新增模型 API。
- [ ] 可编辑模型 API。
- [ ] 可删除模型 API。
- [ ] 可设为默认模型 API。
- [ ] 可测试连接。
- [ ] 不回显完整 API Key。

导入流程：

- [ ] 抖音链接可创建导入任务。
- [ ] 元数据可解析。
- [ ] 封面可保存到本地。
- [ ] 视频可保存到本地。
- [ ] 摘要可生成。
- [ ] 标签可生成。
- [ ] Wiki 列表可显示导入结果。

AI 功能：

- [ ] 视频详情页 QA 可用。
- [ ] 摘要不足时可尝试视觉/视频分析。
- [ ] 做菜 MTA 可生成。
- [ ] 健身 MTA 可生成。
- [ ] 旅游规划 MTA 可生成。
- [ ] 深度研究可生成。

文件存储：

- [ ] `/media` 可访问封面。
- [ ] `/media` 可播放视频。
- [ ] 删除视频时本地文件被删除。
- [ ] 路径越界访问被阻止。

## 14. 推荐首批提交拆分

建议按以下提交顺序拆：

1. `chore: replace coze env assumptions for self-host runtime`
2. `feat(storage): add local filesystem media storage`
3. `feat(settings): add llm provider schema and trpc router`
4. `feat(llm): add openai-compatible provider client`
5. `refactor(llm): migrate video ai workflows to provider service`
6. `feat(ui): add settings page for model providers`
7. `chore: remove coze sdk dependency and update docs`

## 15. 最小可用版本范围

如果希望先快速交付一个能跑的自部署版本，建议 MVP 范围为：

- 本地文件存储。
- `llm_providers` 表。
- 设置页新增/测试/设默认 OpenAI-compatible provider。
- 摘要、标签、QA 迁移到新 provider。
- MTA 暂时只支持文本 + 图片帧，不支持直接视频。
- 完全删除 `coze-coding-dev-sdk`。

MVP 之后再增强：

- 多 provider 按任务类型选择。
- Ollama 专用适配器。
- S3-compatible 存储。
- Douyin Cookie 设置页。
- 模型调用日志和 token 统计。
