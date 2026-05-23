// ABOUTME: Express server with Vite integration + tRPC
// ABOUTME: Handles API routes, tRPC procedures, and serves frontend in dev/prod modes

import 'dotenv/config';
import { createServer, type Server } from 'http';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { resolve } from 'path';
import { isPathInside } from './utils/path-security';
import router from './routes/index';
import { setupVite } from './vite';
import { initDatabase } from './db/index';
import { appRouter } from './trpc/root-router';
import { createContext } from './trpc/trpc';
import { db } from './db/index';
import { getUploadsDir } from './connectors/storage-connector';

// 初始化 Worker（副作用：注册任务处理器）
import './workers/import-worker';

// 全局错误捕获：防止未处理的 Promise rejection 导致进程崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
});

const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000', 10);
const hostname = process.env.HOSTNAME || '0.0.0.0';
const app = express();
// 使用 http.createServer 包装 Express app，以便支持 WebSocket 等协议升级
const server = createServer(app);

async function startServer(): Promise<Server> {
  // 初始化数据库
  await initDatabase();

  // 请求日志（仅开发环境）
  if (isDev) {
    app.use((req, _res, next) => {
      const start = Date.now();
      _res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${ms}ms`);
      });
      next();
    });
  }

  // 添加请求体解析
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // /media 静态文件路由（本地存储的文件访问）
  // 先挂载安全中间件，再挂载 static 中间件，express 会自动去掉 /media 前缀
  const uploadsDir = getUploadsDir();
  app.use('/media', (req, res, next) => {
    const rawPath = req.url || '';

    try {
      // 安全检查：禁止包含 ..
      if (rawPath.includes('..')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // 解码 URL 编码的 key
      const decodedPath = decodeURIComponent(rawPath);

      // 安全检查：解码后再次检查
      if (decodedPath.includes('..')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // 解析为绝对路径
      const requestedPath = resolve(uploadsDir, decodedPath);

      // 确保请求的路径在 uploads 目录内
      if (!isPathInside(requestedPath, uploadsDir)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      next();
    } catch {
      res.status(400).json({ error: 'Bad request' });
    }
  }, express.static(uploadsDir));

  // tRPC 中间件
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContext(db),
    }),
  );

  // 注册传统 API 路由（保留健康检查等）
  app.use(router);

  // 集成 Vite（开发模式）或静态文件服务（生产模式）
  await setupVite(app);

  // 全局错误处理
  app.use((err: Error, _req: express.Request, res: express.Response) => {
    console.error('Server error:', err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = 'status' in err ? (err as any).status || 500 : 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
    });
  });

  server.once('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });

  server.listen(port, hostname, () => {
    console.log(`\n✨ Server running at http://${hostname}:${port}`);
    console.log(`📝 Environment: ${isDev ? 'development' : 'production'}\n`);
  });

  return server;
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
