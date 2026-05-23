import { S3Storage } from 'coze-coding-dev-sdk';

/**
 * 对象存储连接器 — 统一封装 S3Storage
 * 
 * 存储规范：
 * - 持久化时存储 key（而非签名 URL）
 * - 访问时通过 generatePresignedUrl 生成临时 URL
 * - 视频文件：videos/{videoId}.mp4
 * - 封面图片：covers/{videoId}.jpg
 */

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

/**
 * 从 URL 下载文件并上传到对象存储
 * @returns 存储的 key（注意：与 fileName 不同，SDK 会添加 UUID 前缀）
 */
export async function uploadFromUrl(url: string, fileName: string, contentType?: string): Promise<string> {
  console.log(`[Storage] Uploading from URL: ${url} → ${fileName}`);
  
  try {
    // 先下载到 buffer，再上传（更可控）
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Referer': 'https://www.douyin.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000), // 60s 超时
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[Storage] Downloaded ${buffer.length} bytes from ${url}`);

    const key = await storage.uploadFile({
      fileContent: buffer,
      fileName,
      contentType: contentType || response.headers.get('content-type') || 'application/octet-stream',
    });

    console.log(`[Storage] Uploaded as key: ${key}`);
    return key;
  } catch (error) {
    console.error(`[Storage] Upload from URL failed: ${url}`, error);
    throw error;
  }
}

/**
 * 上传本地文件到对象存储
 */
export async function uploadBuffer(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  console.log(`[Storage] Uploading buffer: ${buffer.length} bytes → ${fileName}`);
  
  const key = await storage.uploadFile({
    fileContent: buffer,
    fileName,
    contentType,
  });

  console.log(`[Storage] Uploaded as key: ${key}`);
  return key;
}

/**
 * 生成签名访问 URL
 * @param key 对象存储 key
 * @param expireTime 有效期（秒），默认 1 小时
 */
export async function getSignedUrl(key: string, expireTime: number = 3600): Promise<string> {
  return storage.generatePresignedUrl({ key, expireTime });
}

/**
 * 删除对象存储文件
 */
export async function deleteFile(key: string): Promise<boolean> {
  console.log(`[Storage] Deleting key: ${key}`);
  return storage.deleteFile({ fileKey: key });
}

/**
 * 检查文件是否存在
 */
export async function fileExists(key: string): Promise<boolean> {
  return storage.fileExists({ fileKey: key });
}
