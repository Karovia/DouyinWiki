import { resolve } from 'path';

/**
 * 将路径归一化为小写正斜杠格式，用于跨平台安全比较
 */
export function normalizePath(p: string): string {
  return resolve(p).toLowerCase().replace(/\\/g, '/');
}

/**
 * 验证给定路径是否安全地位于 baseDir 目录内
 * 防止路径遍历攻击（如 ../etc/passwd）
 */
export function isPathInside(filePath: string, baseDir: string): boolean {
  const resolved = normalizePath(filePath);
  const base = normalizePath(baseDir);
  const sep = base.endsWith('/') ? '' : '/';
  return resolved.startsWith(base + sep) || resolved === base;
}
