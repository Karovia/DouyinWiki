#!/bin/bash
# 任务结束审查脚本
# 检查代码规范合规性、任务完成度、roadmap 更新提醒

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# 收集变更信息
CHANGED_FILES=""
if git rev-parse --git-dir > /dev/null 2>&1; then
  CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
  UNTRACKED_FILES=$(git ls-files --others --exclude-standard 2>/dev/null || true)
  if [ -n "$UNTRACKED_FILES" ]; then
    CHANGED_FILES="${CHANGED_FILES:+$CHANGED_FILES
}$UNTRACKED_FILES"
  fi
fi

# 检查是否有代码文件变更
CODE_FILES_CHANGED="false"
if echo "$CHANGED_FILES" | grep -qE '\.(ts|tsx|js|jsx|py|go|rs|java|sql)$'; then
  CODE_FILES_CHANGED="true"
fi

# 读取 roadmap 中的阶段信息
ROADMAP_PHASES=""
if [ -f ".wiki/development-roadmap.md" ]; then
  ROADMAP_PHASES=$(grep -E '^\| Phase [0-9]+' .wiki/development-roadmap.md 2>/dev/null | sed 's/^| //; s/ |.*$//' | tr '\n' ',' | sed 's/,$//' || true)
fi

# 构建 systemMessage
MESSAGE="🔍 任务结束自动审查\n"

if [ "$CODE_FILES_CHANGED" = "true" ]; then
  MESSAGE="${MESSAGE}\n📋 代码规范检查清单（对照 .wiki/coding-standards.md）：\n"
  MESSAGE="${MESSAGE}  - [ ] 代码严格按分层组织（API Gateway → Application → Domain → Infrastructure → Worker）\n"
  MESSAGE="${MESSAGE}  - [ ] 外部依赖通过接口抽象（LLMClient / ASRClient / VectorStore / DouyinConnector）\n"
  MESSAGE="${MESSAGE}  - [ ] 数据库命名：snake_case，表名复数，布尔字段用形容词\n"
  MESSAGE="${MESSAGE}  - [ ] TypeScript 命名：接口 PascalCase，方法 camelCase，常量 UPPER_SNAKE_CASE\n"
  MESSAGE="${MESSAGE}  - [ ] 所有业务表包含 workspace_id，查询强制带 workspace filter\n"
  MESSAGE="${MESSAGE}  - [ ] 任务状态机转换合规，错误码使用正确前缀（PARSE_/ASR_/LLM_/VEC_/JOB_）\n"
  MESSAGE="${MESSAGE}  - [ ] 摘要和 Embedding 使用 content_hash 缓存\n"
fi

MESSAGE="${MESSAGE}\n✅ 任务完成度检查：\n"
MESSAGE="${MESSAGE}  - [ ] 本次任务目标已达成\n"
MESSAGE="${MESSAGE}  - [ ] 关键路径已验证（如适用）\n"
MESSAGE="${MESSAGE}  - [ ] 无遗留 TODO 或临时代码\n"

if [ -n "$ROADMAP_PHASES" ]; then
  MESSAGE="${MESSAGE}\n📅 Roadmap 更新提醒（.wiki/development-roadmap.md）：\n"
  MESSAGE="${MESSAGE}  当前定义的阶段：$ROADMAP_PHASES\n"
  MESSAGE="${MESSAGE}  如本次任务完成了某阶段的核心目标，请在 roadmap 中标记该阶段状态\n"
fi

if [ -n "$CHANGED_FILES" ]; then
  FILE_COUNT=$(echo "$CHANGED_FILES" | grep -c '^' || echo "0")
  MESSAGE="${MESSAGE}\n📝 本次变更文件数：$FILE_COUNT\n"
fi

# 输出 JSON
printf '{"systemMessage": "%s"}' "$MESSAGE"
