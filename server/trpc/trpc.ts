import { initTRPC } from '@trpc/server';
import type { DB } from '../db/index';

/**
 * tRPC 上下文：注入数据库实例和请求信息
 */
export function createContext(db: DB) {
  return () => ({
    db,
  });
}

export type Context = ReturnType<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
