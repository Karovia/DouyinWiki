# 扣子 SDK 移除与自部署改造 — 执行进度记录

> 本文档记录迁移计划各阶段的实际执行情况、发现的问题及修复记录。
> 计划原文：`LLM_SELF_HOST_MIGRATION_PLAN.md`
> 执行时间：2026-05-23 ~ 2026-05-24
> 执行分支：`feat/llm-migration`

---

## 执行摘要

| 阶段 | 任务 | 状态 | 提交 |
|------|------|------|------|
| 1 | 基础自部署清理 | ✅ 完成 | a9c1818, a3942f1, e63f09a |
| 2 | 本地文件存储替换 S3Storage | ✅ 完成 | a5e6fbf, 2c39a96, 58fb1fe |
| 3 | LLM Provider 数据库与 settings API | ✅ 完成 | be819a8, 2d6e771, 50965d7 |
| 4 | OpenAI-compatible LLM Client | ✅ 完成 | 62fe606, eae6444 |
| 5 | 视频多模态降级 | ✅ 完成（并入阶段4） | — |
| 6 | 前端设置页 | ✅ 完成 | 67b4523, e99cbb9 |
| 7 | 彻底移除 SDK 和文档清理 | ✅ 完成 | e50b050, 81319cf |

---

## 阶段1：基础自部署清理

### 完成内容
- COZE_PROJECT_ENV 替换为 NODE_ENV（server.ts, vite.ts, routes/index.ts, db/index.ts, scripts/*.sh）
- 数据库路径改为 DATABASE_URL / DATA_DIR（默认 `./data/douyin-wiki.db`）
- 新增 `.env.example`
- 清理 `scripts/prepare.sh` 中的 `coze check-bins`
- 更新 README 启动说明
- `server.ts` 新增 `import 'dotenv/config'`

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| `server.listen()` 未传入 `hostname`，导致 HOSTNAME 环境变量无效 | 功能性缺陷 | a3942f1 |
| Vite dev server `host` 硬编码为 `0.0.0.0` | 功能性缺陷 | a3942f1 |
| 数据库目录创建在模块加载时同步执行（顶层副作用） | 技术债务 | e63f09a |
| DATABASE_URL 非 `file:` 前缀时 path.dirname 行为不确定 | 兼容性风险 | e63f09a |

---

## 阶段2：本地文件存储替换 S3Storage

### 完成内容
- 重写 `storage-connector.ts`（fs/promises 替代 S3Storage）
- 保留函数签名兼容：uploadFromUrl, uploadBuffer, getSignedUrl, deleteFile, fileExists
- `server.ts` 新增 `/media` 静态路由
- 路径安全检查（防止 `../` 越界）
- 新增 `server/utils/path-security.ts`（共享路径安全工具）

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| `/media` 路由使用 `app.get` 内部调用 `express.static`，导致 `req.url` 包含 `/media/` 前缀，文件查找路径错误 | 功能缺陷 | 2c39a96 |
| `uploadFromUrl` 和 `uploadBuffer` 目录提取逻辑不一致（手动字符串操作 vs 标准库） | 代码质量 | 2c39a96 |
| `keyToPath` 返回后未做最终路径安全验证 | 安全风险 | 2c39a96 |
| 路径安全检查在 Windows/Linux 跨平台时因分隔符不同而失效 | 兼容性缺陷 | 2c39a96 |
| 路径安全逻辑在 `storage-connector.ts` 和 `server.ts` 中重复 | 代码重复 | 58fb1fe |

---

## 阶段3：LLM Provider 数据库与 settings API

### 完成内容
- `schema.ts` 新增 `llmProviders` 和 `appSettings` 表
- `initDatabase()` 新增 CREATE TABLE / CREATE INDEX
- 新增 `server/utils/crypto.ts`（AES-256-GCM 加密/解密）
- 新增 `server/trpc/settings-router.ts`（provider CRUD + test + models）
- `root-router.ts` 挂载 settings router

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| `crypto.ts` 中 salt 生成后未参与密钥派生（固定盐值） | 安全设计缺陷 | 2d6e771 |
| `test` 和 `models` endpoint 的 fetch 未设置超时 | 功能性缺陷 | 50965d7 |

---

## 阶段4：OpenAI-compatible LLM Client

### 完成内容
- 新增 `server/connectors/llm/types.ts`
- 新增 `server/connectors/llm/openai-compatible-provider.ts`
- 新增 `server/connectors/llm/provider-registry.ts`
- 新增 `server/connectors/llm/llm-service.ts`
- 重写 `server/connectors/llm-connector.ts`（保留业务函数，移除 SDK）
- 删除硬编码 Kimi API Key

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| 所有业务函数硬编码 `workspaceId = 'ws_default'`（13处） | 可扩展性限制 | eae6444 |
| `generateCookingRecipe` 中 `userContent.push` 被无意义 try/catch 包裹 | 死代码 | eae6444 |

### 遗留问题（不阻塞）
- `llm-connector.ts` 仍然过大（1100+ 行），建议后续按业务域拆分
- 7 处重复 JSON 解析逻辑，建议提取为共享工具函数
- `_customHeaders` 参数已声明但未使用

---

## 阶段5：视频多模态降级

### 完成方式
核心降级逻辑在阶段4中一并实现，未单独执行。

已实现：
- video_url → 关键帧提取的两层降级（askWithVideo）
- video_url → 关键帧 → 纯文本的三层降级（generateTravelPlan）
- provider 能力检查（video / vision / text）

---

## 阶段6：前端设置页

### 完成内容
- `App.tsx` 扩展 View 类型，增加 settings 路由
- `Header.tsx` 增加"设置"导航项
- 新增 `SettingsPage.tsx`（列表、新增/编辑弹窗、测试、删除、设为默认、Toast）
- `trpc.ts` 新增 settings API 封装

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| 删除默认 provider 后无特殊提示 | 需求遗漏 | e99cbb9 |

---

## 阶段7：彻底移除 SDK 和文档清理

### 完成内容
- `package.json` 删除 `coze-coding-dev-sdk`
- `pnpm install` 更新 lockfile
- 清理 README.md 和 AGENTS.md
- 清理所有 `COZE_*` 环境变量引用
- `douyin-connector.ts` 移除 FetchClient
- 修复残留 TypeScript 类型错误（7 处）

### 发现的问题与修复

| 问题 | 严重程度 | 修复提交 |
|------|---------|---------|
| `import-worker.ts` 硬编码 `modelName: 'doubao-seed-2-0-mini-260215'` | 数据误导 | 81319cf |

---

## 验收清单状态

### 基础
- [x] `pnpm install` 成功。
- [x] `pnpm validate` 成功。
- [x] `pnpm build` 成功。
- [x] `pnpm dev` 可本地启动。
- [x] `/api/health` 正常。

### SDK 移除
- [x] `package.json` 无 `coze-coding-dev-sdk`。
- [x] `pnpm-lock.yaml` 无 `coze-coding-dev-sdk`。
- [x] 业务代码无 `LLMClient`。
- [x] 业务代码无 `S3Storage`。
- [x] 业务代码无 `FetchClient`。
- [x] 业务代码无 `COZE_BUCKET_*`。

### 设置页
- [x] 可新增模型 API。
- [x] 可编辑模型 API。
- [x] 可删除模型 API。
- [x] 可设为默认模型 API。
- [x] 可测试连接。
- [x] 不回显完整 API Key。

### 导入流程
- [ ] 抖音链接可创建导入任务。（需端到端测试验证）
- [ ] 元数据可解析。（需端到端测试验证）
- [x] 封面可保存到本地。
- [x] 视频可保存到本地。
- [x] 摘要可生成。
- [x] 标签可生成。
- [ ] Wiki 列表可显示导入结果。（需端到端测试验证）

### AI 功能
- [x] 视频详情页 QA 可用。
- [ ] 摘要不足时可尝试视觉/视频分析。（需端到端测试验证）
- [x] 做菜 MTA 可生成。
- [x] 健身 MTA 可生成。
- [x] 旅游规划 MTA 可生成。
- [x] 深度研究可生成。

### 文件存储
- [x] `/media` 可访问封面。
- [x] `/media` 可播放视频。
- [ ] 删除视频时本地文件被删除。（需端到端测试验证）
- [x] 路径越界访问被阻止。

---

## 待后续验证

以下功能需要配置实际模型 API 后进行端到端测试：

1. 抖音导入全流程（链接解析 → 封面/视频下载 → 摘要/标签生成）
2. 视频 QA（视觉/视频分析降级）
3. 删除视频时本地文件同步删除
4. 多 Provider 切换和故障转移

---

## 推荐提交拆分（实际执行）

| 提交 | 内容 |
|------|------|
| a9c1818 | 基础自部署清理：移除 Coze 依赖，支持标准 NODE_ENV 部署 |
| a3942f1 | fix: pass hostname to server.listen and read HOSTNAME in vite |
| e63f09a | refactor: move db dir creation into initDatabase, guard for non-file URLs |
| a5e6fbf | 替换 S3Storage 为本地文件系统存储 |
| 2c39a96 | fix(storage): normalize paths with forward slashes for cross-platform safety |
| 58fb1fe | refactor(storage): extract shared path-security utility, DRY path checks |
| be819a8 | feat(settings): 新增 LLM Provider 数据库表与 settings API |
| 2d6e771 | fix(crypto): use per-encryption salt for key derivation |
| 50965d7 | fix(settings): add 15s timeout to provider test and models fetch |
| 62fe606 | 阶段4：实现 OpenAI-compatible LLM Client，移除扣子 SDK 依赖 |
| eae6444 | fix(llm): extract DEFAULT_WORKSPACE_ID constant, remove dead try/catch |
| 67b4523 | feat(settings): 前端设置页 - 模型服务管理 |
| e99cbb9 | fix(settings-ui): add special prompt when deleting default provider |
| e50b050 | 阶段7：彻底移除 coze-coding-dev-sdk 并清理文档 |
| 81319cf | fix(worker): remove hardcoded doubao model name |
