// ABOUTME: Vite integration for Express server
// ABOUTME: Handles dev middleware and production static file serving

import type { Application } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * 集成 Vite 开发服务器（中间件模式）
 * 使用动态 import 避免在 Node.js CJS 环境下解析 Vite 插件内部路径
 */
export async function setupVite(app: Application) {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        port: 5000,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: {
          overlay: true,
          path: '/hot/vite-hmr',
          port: 6000,
          clientPort: 443,
          timeout: 30000,
        },
        watch: {
          usePolling: true,
          interval: 100,
        },
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
    console.log('🚀 Vite dev server initialized');
  } else {
    setupStaticServer(app);
  }
}

/**
 * 设置生产环境静态文件服务
 */
function setupStaticServer(app: Application) {
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!fs.existsSync(distPath)) {
    console.error('❌ dist folder not found. Please run "pnpm build" first.');
    process.exit(1);
  }

  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
