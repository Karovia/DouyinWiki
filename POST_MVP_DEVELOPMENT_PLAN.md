# 抖音 Wiki 后期开发计划（Post-MVP）

> 本文档基于 `LLM_SELF_HOST_MIGRATION_PLAN.md` 的 MVP 范围，规划自部署改造完成后的增强功能与长期演进方向。
> MVP 范围：本地文件存储 + OpenAI-compatible Provider + 设置页 + 摘要/标签/QA/MTA 迁移 + SDK 移除。

---

## 1. 核心目标

MVP 解决"能不能跑"的问题，后期计划解决"好不好用"和"能不能扩展"的问题：

- **智能化**：多模型路由、自动能力匹配、调用优化。
- **可观测性**：全链路调用追踪、成本统计、性能监控。
- **可扩展性**：插件化 Provider、多存储后端、开放 API。
- **体验优化**：移动端适配、批量操作、自动化工作流。

---

## 2. Phase 1：多 Provider 智能路由（高优先级）

### 2.1 背景

MVP 中用户配置一个默认 Provider，所有任务都用同一个模型。实际场景中：

- 用户可能同时配置了本地 Ollama（免费但慢）和远程 OpenAI API（快但有成本）。
- 摘要需要 vision 能力，标签只需要 text，不应该强制用同一个贵模型。
- 某个 Provider 临时不可用时，应自动切换到备用 Provider。

### 2.2 功能设计

#### 2.2.1 按任务类型选择模型

扩展 `llm_providers` 表，支持按用途配置：

```ts
interface ProviderModelMapping {
  providerId: string;
  purpose: 'summary' | 'tags' | 'qa' | 'mta_cooking' | 'mta_training' | 'mta_travel' | 'deep_research' | 'transcription';
  modelName: string;
  priority: number; // 数字越小优先级越高
}
```

新增表 `provider_model_mappings`，允许用户为不同任务指定不同 Provider + 模型。

#### 2.2.2 能力匹配引擎

调用前检查：

1. 任务需要什么 capability（text / vision / video / jsonMode）。
2. 列出所有 enabled 且具备该 capability 的 Provider。
3. 按优先级排序，优先选择有专用 mapping 的 Provider。
4. 如果没有匹配，降级（video → vision → text）。
5. 如果全部失败，返回明确错误提示。

#### 2.2.3 故障转移

- 单次调用超时（默认 60s）或返回 5xx 时，标记该 Provider 为"暂时不可用"。
- 同一任务自动重试下一个可用 Provider。
- 10 分钟内连续失败 3 次的 Provider，自动禁用并通知用户。

### 2.3 验收标准

- [ ] 可以为"摘要"任务单独指定一个 vision 模型，为"标签"指定一个轻量 text 模型。
- [ ] 当默认 Provider 不可用时，自动切换到备用 Provider。
- [ ] 任务执行记录中显示实际使用的 Provider 和模型。

---

## 3. Phase 2：Ollama 原生适配（高优先级）

### 3.1 背景

Ollama 虽然支持 OpenAI-compatible `/v1/chat/completions` 端点，但存在一些差异：

- `/v1/models` 返回的模型列表格式与 OpenAI 略有不同。
- 不支持 `video_url` 内容类型（任何 vision 模型都不支持）。
- 本地模型通常能力较弱，需要更严格的降级策略。
- 不支持 JSON Mode（部分模型通过 system prompt 强制 JSON 输出）。

### 3.2 功能设计

#### 3.2.1 Ollama 专用 Provider

新增 `ollama-provider.ts`：

- 使用 Ollama 原生 API（`/api/generate`、`/api/chat`）作为首选，OpenAI-compatible 作为 fallback。
- 支持自动拉取模型（`ollama pull`）。
- 检测本地模型是否支持 vision（通过 `/api/show` 查看模版图配置）。

#### 3.2.2 Ollama 模型能力检测

```ts
async function detectOllamaCapabilities(modelName: string): Promise<{
  vision: boolean;
  contextLength: number;
  supportsJsonMode: boolean;
}> {
  const info = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    body: JSON.stringify({ model: modelName }),
  });
  // 解析 modelfile 中的 TEMPLATE 和 PARAMETERS
}
```

#### 3.2.3 本地模型推荐

首次配置 Ollama 时，根据用户硬件自动推荐模型：

- 8GB VRAM → `llama3.2-vision`（vision）/ `qwen2.5`（text）
- 16GB VRAM → `minicpm-v`（vision）/ `llama3.3`（text）
- 24GB+ VRAM → `llava`（vision）/ `deepseek-r1`（text/推理）

### 3.3 验收标准

- [ ] 可以添加 Ollama Provider，自动检测可用模型。
- [ ] Ollama Provider 支持 vision 能力检测。
- [ ] JSON 输出任务在 Ollama 上通过 system prompt 方式实现。
- [ ] 设置页显示本地硬件信息和推荐模型。

---

## 4. Phase 3：可观测性平台（高优先级）

### 4.1 背景

MVP 中模型调用是黑盒，用户不知道：

- 每个任务消耗了多少 token。
- 哪个 Provider 响应最快。
- 为什么某个任务失败了。
- 每月/每周的 API 调用成本。

### 4.2 功能设计

#### 4.2.1 调用日志表

```ts
export const llmCallLogs = sqliteTable('llm_call_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  providerId: text('provider_id').notNull(),
  modelName: text('model_name').notNull(),

  // 任务信息
  taskType: text('task_type').notNull(), // summary / tags / qa / mta / research
  videoId: text('video_id'),

  // Token 统计（从响应头或响应体提取）
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),

  // 耗时
  latencyMs: integer('latency_ms'),

  // 结果
  status: text('status').notNull(), // success / error / timeout / fallback
  errorMessage: text('error_message'),

  // 成本估算（针对付费 API）
  estimatedCost: integer('estimated_cost'), // 单位为 0.0001 美元，避免浮点

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

#### 4.2.2 成本统计面板

新增页面或弹窗展示：

- 今日/本周/本月调用次数和 token 消耗。
- 按 Provider 分组的使用量。
- 按任务类型分组的分布图。
- 平均响应时间趋势。
- 失败率趋势。

#### 4.2.3 Token 用量限制

支持为每个 Provider 设置用量上限：

- 每月 token 上限（防止意外超支）。
- 每分钟请求数上限（RPM 限制）。
- 达到上限时自动切换到备用 Provider。

### 4.3 验收标准

- [ ] 每次 LLM 调用都记录到 `llm_call_logs`。
- [ ] 设置页显示调用统计面板。
- [ ] 可以为 Provider 设置月度 token 预算。
- [ ] 超过预算时自动停用并提示用户。

---

## 5. Phase 4：视频语音转写（ASR + OCR）（中优先级）

### 5.1 背景

当前视频分析依赖：

1. 视频直传（需要 video-capable 模型）。
2. 关键帧抽图（需要 vision-capable 模型）。
3. 纯文本（标题 + 描述 + 已有摘要）。

如果能把视频中的语音转成文本，将大幅提升纯文本模型的分析质量，同时减少对昂贵 vision/video 模型的依赖。

### 5.2 功能设计

#### 5.2.1 ASR 转写

支持两种方式：

1. **本地 whisper.cpp / faster-whisper**：
   - 需要用户本地部署 whisper 模型。
   - 完全离线，无 API 成本。
   - 支持多语言（中文视频效果较好）。

2. **远程 ASR API**：
   - 使用 Provider 的音频转写能力（如 OpenAI Whisper API）。
   - 按用量付费，质量稳定。

新增表 `transcriptions`（MVP 中已存在此表，扩展字段）：

```ts
export const transcriptions = sqliteTable('transcriptions', {
  // ... 已有字段 ...
  source: text('source').notNull(), // asr / subtitle / manual_note / ocr
  modelName: text('model_name'),
  language: text('language'),
  durationSeconds: integer('duration_seconds'),
  segments: text('segments'), // JSON: [{ start, end, text }]
});
```

#### 5.2.2 OCR 字幕提取

抖音视频本身没有字幕时，可以通过 OCR 提取画面中的文字：

- 使用 `paddleocr` 或 `easyocr` 本地执行。
- 或者通过 vision 模型逐帧识别文字。

#### 5.2.3 转写驱动的工作流

导入视频后自动触发：

1. 下载视频文件。
2. 提取音频轨道。
3. 调用 ASR 转写为文本。
4. 将转写文本保存到 `transcriptions` 表。
5. 生成摘要时优先使用转写文本作为输入。

### 5.3 验收标准

- [ ] 导入视频后可选自动 ASR 转写。
- [ ] 转写文本参与摘要生成，提升摘要质量。
- [ ] QA 时可以引用转写文本中的具体时间点。
- [ ] 支持 whisper.cpp 本地部署和 OpenAI Whisper API 两种模式。

---

## 6. Phase 5：S3-Compatible 存储扩展（中优先级）

### 5.1 背景

MVP 中存储默认使用本地文件系统，但用户可能希望：

- 在 NAS / 服务器集群中共享存储（需要 S3）。
- 使用阿里云 OSS、腾讯云 COS、MinIO 等。
- 同时保留本地缓存 + 远程备份。

### 5.2 功能设计

#### 5.2.1 存储策略抽象

```ts
interface StorageStrategy {
  type: 'local' | 's3_compatible';
  // local
  baseDir?: string;
  // s3
  endpointUrl?: string;
  bucketName?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  publicUrlPrefix?: string; // 用于直接访问，不经过签名
}
```

#### 5.2.2 存储连接器重构

`storage-connector.ts` 改为策略模式：

```ts
class StorageManager {
  private strategies: Map<string, StorageBackend>;
  getPrimary(): StorageBackend;
  uploadFromUrl(...): Promise<string>;
  // 支持多写：同时写入本地和 S3（备份模式）
  uploadWithMirror(...): Promise<string>;
}
```

#### 5.2.3 设置页扩展

- 存储模式切换：仅本地 / 仅 S3 / 本地主+S3备。
- S3 配置表单（endpoint、bucket、region、accessKey/secretKey）。
- 测试连接按钮（上传一个测试文件后读取验证）。

### 5.3 验收标准

- [ ] 可以切换到 S3-compatible 存储，所有文件操作正常。
- [ ] 支持 MinIO、阿里云 OSS、腾讯云 COS。
- [ ] 支持本地+远程双写备份模式。
- [ ] 切换存储模式时，已有文件可选迁移或保持原位置。

---

## 7. Phase 6：Douyin Cookie 管理与解析增强（中优先级）

### 7.1 背景

MVP 中支持配置 Douyin Cookie，但：

- Cookie 需要手动从浏览器复制，操作门槛高。
- Cookie 会过期，需要定期更新。
- 没有 Cookie 时的解析成功率不稳定。

### 7.2 功能设计

#### 7.2.1 Cookie 设置页

在 SettingsPage 中新增"抖音解析"模块：

- Cookie 输入框（textarea，支持多行）。
- Cookie 有效性测试按钮（测试能否获取视频详情）。
- Cookie 过期提醒（检测到 401/403 时提示更新）。
- 一键清空 Cookie（回退到无 Cookie 模式）。

#### 7.2.2 解析策略增强

无 Cookie 时的多级 fallback：

1. 直接请求分享链接，解析 `RENDER_DATA`。
2. 如果被封，尝试通过短链重定向获取真实 URL。
3. 尝试解析页面 HTML 中的 meta tags 和 script 标签。
4. 尝试从 `window._SSR_HYDRATED_DATA` 提取。
5. 如果全部失败，提示用户配置 Cookie。

#### 7.2.3 反爬策略

- 请求间隔随机化（1-3 秒）。
- User-Agent 轮换池。
- 可选代理配置（HTTP/SOCKS5）。

### 7.3 验收标准

- [ ] 设置页可以配置和测试 Douyin Cookie。
- [ ] Cookie 过期时前端显示提醒。
- [ ] 无 Cookie 时的解析成功率 > 70%。
- [ ] 支持配置代理服务器。

---

## 8. Phase 7：批量操作与自动化（中优先级）

### 8.1 背景

当前导入流程是单条链接 → 单条处理。用户可能有：

- 一个博主的多个视频链接需要批量导入。
- 收藏夹/列表中的 50 个链接需要一次性处理。
- 希望每天自动同步某个博主的新视频。

### 8.2 功能设计

#### 8.2.1 批量导入

- 支持粘贴多行链接（每行一个）。
- 支持上传 `.txt` 或 `.csv` 文件（一列链接）。
- 批量导入任务队列，显示总体进度。
- 失败链接汇总，支持一键重试。

#### 8.2.2 收藏夹/列表解析

- 解析抖音用户主页视频列表（需要 Cookie）。
- 解析抖音收藏夹（需要 Cookie + 更高权限）。
- 解析结果展示为可选列表，用户勾选后导入。

#### 8.2.3 自动化规则

```ts
interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;

  // 触发条件
  trigger: {
    type: 'schedule' | 'webhook' | 'manual';
    cron?: string; // 定时触发
    urlPattern?: string; // webhook 触发
  };

  // 执行动作
  actions: Array<{
    type: 'import' | 'summarize' | 'tag' | 'notify';
    config: Record<string, unknown>;
  }>;
}
```

例如：

- 每天凌晨 2 点，自动为昨日导入的视频生成摘要。
- 当导入新视频时，自动触发 QA 预生成（常见问题答案）。

### 8.3 验收标准

- [ ] 支持一次性粘贴 100 个链接批量导入。
- [ ] 可以解析抖音用户主页的视频列表。
- [ ] 支持配置定时自动摘要规则。

---

## 9. Phase 8：导出与分享（中优先级）

### 9.1 背景

用户积累的视频 Wiki 需要能导出和分享：

- 将某个视频的摘要 + 笔记导出为 Markdown / PDF。
- 将整个工作区的视频列表导出为知识库。
- 分享单个视频的分析结果给他人（只读链接）。

### 9.2 功能设计

#### 9.2.1 单视频导出

导出格式：

- Markdown（标题、摘要、标签、转写文本、QA 记录）。
- PDF（带封面图片的排版文档）。
- Notion 页面（通过 Notion API 推送）。

#### 9.2.2 工作区导出

- 全部视频元数据导出为 JSON/CSV。
- 生成静态 HTML 站点（可部署到 GitHub Pages / Vercel）。

#### 9.2.3 分享链接

- 生成只读分享链接（带 token，可设置过期时间）。
- 分享页面简洁展示视频信息和 AI 摘要。
- 支持密码保护。

### 9.3 验收标准

- [ ] 单个视频可以导出为 Markdown 文件。
- [ ] 可以生成带密码的只读分享链接。
- [ ] 分享链接在 7 天后自动过期。

---

## 10. Phase 9：插件系统（低优先级，长期）

### 10.1 背景

当前 Provider 和存储都是硬编码实现。为了让社区可以扩展，需要插件机制。

### 10.2 功能设计

#### 10.2.1 Provider 插件接口

```ts
interface LlmProviderPlugin {
  name: string;
  version: string;
  supportedProtocols: string[];

  // 创建客户端实例
  createClient(config: ProviderConfig): LlmClient;

  // 检测能力
  detectCapabilities(config: ProviderConfig): Promise<ProviderCapabilities>;

  // 测试连接
  testConnection(config: ProviderConfig): Promise<TestResult>;
}
```

#### 10.2.2 存储插件接口

```ts
interface StoragePlugin {
  name: string;
  scheme: string; // "s3", "gcs", "azure-blob", etc.

  createBackend(config: StorageConfig): StorageBackend;
}
```

#### 10.2.3 插件加载机制

- 插件放在 `plugins/` 目录，服务启动时自动加载。
- 每个插件为一个 npm 包，遵循约定接口。
- 前端动态注册 Provider 类型选项。

### 10.3 验收标准

- [ ] 新增 Provider 类型无需修改核心代码。
- [ ] 社区可以发布独立的 Provider 插件包。
- [ ] 插件有版本管理和兼容性检查。

---

## 11. Phase 10：移动端适配与 PWA（低优先级）

### 11.1 功能设计

- 响应式布局优化（手机端侧边栏变为底部导航）。
- 视频播放器适配竖屏。
- PWA 支持（离线查看已导入视频列表）。
- 推送通知（导入完成、摘要生成完成）。

### 11.2 验收标准

- [ ] 手机浏览器访问布局正常。
- [ ] 可安装为 PWA。
- [ ] 导入完成后收到系统通知。

---

## 12. 实施优先级总览

| 阶段 | 功能 | 优先级 | 预估工时 | 依赖 |
|------|------|--------|----------|------|
| 1 | 多 Provider 智能路由 | 高 | 3-4 天 | MVP Phase 4 |
| 2 | Ollama 原生适配 | 高 | 2-3 天 | MVP Phase 4 |
| 3 | 可观测性平台 | 高 | 3-4 天 | MVP Phase 4 |
| 4 | 视频语音转写（ASR） | 中 | 4-5 天 | MVP Phase 2 |
| 5 | S3-Compatible 存储 | 中 | 2-3 天 | MVP Phase 2 |
| 6 | Douyin Cookie 管理 | 中 | 1-2 天 | MVP Phase 6 |
| 7 | 批量操作与自动化 | 中 | 4-5 天 | MVP 全部 |
| 8 | 导出与分享 | 中 | 3-4 天 | MVP 全部 |
| 9 | 插件系统 | 低 | 5-7 天 | Phase 1-3 |
| 10 | 移动端/PWA | 低 | 3-4 天 | MVP 全部 |

---

## 13. 技术债务与风险

### 13.1 技术债务

| 项目 | 影响 | 处理建议 |
|------|------|----------|
| 数据库迁移管理 | 目前使用 `CREATE TABLE IF NOT EXISTS`，缺乏版本控制 | 引入 drizzle-kit 迁移或自研迁移脚本 |
| 前端状态管理 | 当前 React 状态较分散 | 后期考虑引入 Zustand 或 Jotai |
| 测试覆盖 | 无单元测试和集成测试 | Phase 3 后补充核心链路测试 |

### 13.2 风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 抖音反爬升级 | 高 | 导入功能失效 | 持续维护解析策略，提供 Cookie 配置 |
| 本地模型推理慢 | 中 | 用户体验差 | 默认推荐小模型，提供云端模型选项 |
| ASR 依赖 ffmpeg | 中 | 部署门槛提高 | 提供 Docker 镜像，预装 ffmpeg |
| 多 Provider 配置复杂 | 中 | 用户放弃使用 | 提供一键模板（OpenAI / Ollama / 豆包） |

---

## 14. 里程碑定义

### v1.1（MVP 后 2 周）

- 多 Provider 路由 + Ollama 适配 + 基础调用日志。

### v1.2（MVP 后 4 周）

- ASR 转写 + S3 存储 + Cookie 管理页。

### v1.3（MVP 后 6 周）

- 批量导入 + 自动化规则 + 导出功能。

### v2.0（MVP 后 3 个月）

- 插件系统 + 移动端适配 + 完整可观测性面板。

---

## 15. 附录：新增数据库表汇总

```sql
-- Phase 1: 模型用途映射
CREATE TABLE provider_model_mappings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model_name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER
);

-- Phase 3: LLM 调用日志
CREATE TABLE llm_call_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  task_type TEXT NOT NULL,
  video_id TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  estimated_cost INTEGER,
  created_at INTEGER
);

-- Phase 7: 自动化规则
CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_config TEXT NOT NULL, -- JSON
  actions_config TEXT NOT NULL, -- JSON
  created_at INTEGER,
  updated_at INTEGER
);

-- Phase 7: 批量导入任务
CREATE TABLE batch_import_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  total_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_urls TEXT, -- JSON 数组
  status TEXT NOT NULL,
  created_at INTEGER,
  completed_at INTEGER
);
```
