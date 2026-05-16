import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.worktrees/**',
    ],
    // 集成测试涉及数据库写操作，串行执行避免文件锁冲突
    pool: 'forks',
    maxForks: 1,
  },
});
