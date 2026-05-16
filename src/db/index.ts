import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data/douyin-wiki.db',
});

export const db = drizzle(client, { schema });

export type DbClient = typeof db;
export { schema };

/**
 * 创建独立的数据库连接（用于测试等需要隔离数据库的场景）
 * @param url 数据库 URL，默认使用内存数据库 `:memory:`
 */
export function createDbClient(url: string = ':memory:'): DbClient {
  const testClient = createClient({ url });
  return drizzle(testClient, { schema });
}
