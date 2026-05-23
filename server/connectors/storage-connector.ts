import { mkdir, writeFile, readFile, unlink, access } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';

/**
 * 本地文件系统存储连接器
 *
 * 存储规范：
 * - 持久化时存储 key（而非 URL）
 * - 访问时通过 getSignedUrl 生成本地可访问 URL
 * - 视频文件：videos/{videoId}.mp4
 * - 封面图片：covers/{videoId}.jpg
 * - 帧图片：frames/{videoId}_frame_{i}.jpg
 *
 * 所有文件存储在 ${DATA_DIR}/uploads/ 下
 */

const DATA_DIR = process.env.DATA_DIR || './data';
const UPLOADS_DIR = resolve(DATA_DIR, 'uploads');

/**
 * 确保 uploads 目录存在
 */
async function ensureUploadsDir(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

/**
 * 将 key 转换为本地绝对文件路径
 * key 格式如：videos/xxx.mp4, covers/xxx.jpg
 */
function keyToPath(key: string): string {
  // 安全检查：禁止包含 .. 或绝对路径
  if (key.includes('..')) {
    throw new Error(`Invalid key: contains ".."`);
  }
  if (isAbsolute(key)) {
    throw new Error(`Invalid key: absolute path not allowed`);
  }
  return resolve(UPLOADS_DIR, key);
}

/**
 * 验证 key 解析后的路径是否在 uploads 目录内
 */
function isPathSafe(filePath: string): boolean {
  const resolved = resolve(filePath);
  const uploadsResolved = resolve(UPLOADS_DIR);
  return resolved.startsWith(uploadsResolved + '\\') || resolved.startsWith(uploadsResolved + '/') || resolved === uploadsResolved;
}

/**
 * 从 URL 下载文件并保存到本地
 * @returns 存储的 key（与传入的 fileName 一致）
 */
export async function uploadFromUrl(url: string, fileName: string, contentType?: string): Promise<string> {
  console.log(`[Storage] Uploading from URL: ${url} → ${fileName}`);

  // 安全检查
  if (fileName.includes('..')) {
    throw new Error(`Invalid fileName: contains ".."`);
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Referer': 'https://www.douyin.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[Storage] Downloaded ${buffer.length} bytes from ${url}`);

    await ensureUploadsDir();
    const filePath = keyToPath(fileName);

    // 确保子目录存在
    const dir = filePath.substring(0, filePath.lastIndexOf('/') !== -1 ? filePath.lastIndexOf('/') : filePath.lastIndexOf('\\'));
    if (dir && dir !== UPLOADS_DIR) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, buffer);

    console.log(`[Storage] Saved to: ${filePath}`);
    return fileName;
  } catch (error) {
    console.error(`[Storage] Upload from URL failed: ${url}`, error);
    throw error;
  }
}

/**
 * 上传 Buffer 到本地文件系统
 */
export async function uploadBuffer(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  console.log(`[Storage] Uploading buffer: ${buffer.length} bytes → ${fileName}`);

  // 安全检查
  if (fileName.includes('..')) {
    throw new Error(`Invalid fileName: contains ".."`);
  }

  await ensureUploadsDir();
  const filePath = keyToPath(fileName);

  // 确保子目录存在
  const lastSlash = filePath.lastIndexOf('/');
  const lastBackslash = filePath.lastIndexOf('\\');
  const sepIndex = Math.max(lastSlash, lastBackslash);
  if (sepIndex > 0) {
    const dir = filePath.substring(0, sepIndex);
    await mkdir(dir, { recursive: true });
  }

  await writeFile(filePath, buffer);

  console.log(`[Storage] Saved to: ${filePath}`);
  return fileName;
}

/**
 * 生成访问 URL
 * 本地文件不需要签名，直接通过 /media 静态路由访问
 * @param key 文件 key
 * @param _expireTime 保留参数以兼容签名 URL 接口（本地文件永久可访问）
 */
export async function getSignedUrl(key: string, _expireTime?: number): Promise<string> {
  // 安全检查
  if (key.includes('..')) {
    throw new Error(`Invalid key: contains ".."`);
  }
  return `/media/${encodeURIComponent(key)}`;
}

/**
 * 删除本地文件
 */
export async function deleteFile(key: string): Promise<boolean> {
  console.log(`[Storage] Deleting key: ${key}`);

  // 安全检查
  if (key.includes('..')) {
    throw new Error(`Invalid key: contains ".."`);
  }

  try {
    const filePath = keyToPath(key);
    if (!isPathSafe(filePath)) {
      throw new Error(`Path traversal detected: ${key}`);
    }
    await unlink(filePath);
    console.log(`[Storage] Deleted: ${filePath}`);
    return true;
  } catch (error) {
    // 文件不存在不算失败
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    console.error(`[Storage] Delete failed: ${key}`, error);
    return false;
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(key: string): Promise<boolean> {
  // 安全检查
  if (key.includes('..')) {
    throw new Error(`Invalid key: contains ".."`);
  }

  try {
    const filePath = keyToPath(key);
    if (!isPathSafe(filePath)) {
      throw new Error(`Path traversal detected: ${key}`);
    }
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取 uploads 目录的绝对路径（供 server.ts 使用）
 */
export function getUploadsDir(): string {
  return UPLOADS_DIR;
}
