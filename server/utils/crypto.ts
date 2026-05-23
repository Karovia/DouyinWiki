/**
 * API Key 加密/解密工具
 * 使用 AES-256-GCM 加密，密钥来自 APP_SECRET 环境变量
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function getKey(): Buffer {
  const envSecret = process.env.APP_SECRET;
  if (!envSecret) {
    // 生成临时密钥并打印警告
    const tempKey = randomBytes(32).toString('hex');
    console.warn('[WARN] APP_SECRET 环境变量未设置，已生成临时加密密钥。重启后所有已加密的 API key 将无法解密！');
    console.warn('[WARN] 请设置 APP_SECRET 环境变量以保证数据持久性。');
    return Buffer.from(tempKey, 'hex');
  }
  // 使用固定盐值派生密钥，确保相同 APP_SECRET 产生相同密钥
  return scryptSync(envSecret, 'douyin-wiki-salt', 32);
}

let cachedKey: Buffer | null = null;

function getCachedKey(): Buffer {
  if (!cachedKey) {
    cachedKey = getKey();
  }
  return cachedKey;
}

/**
 * 加密 API Key
 * 格式: base64(salt + iv + ciphertext + authTag)
 */
export function encryptApiKey(apiKey: string): string {
  const key = getCachedKey();
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(apiKey, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const result = Buffer.concat([salt, iv, encrypted, authTag]);
  return result.toString('base64');
}

/**
 * 解密 API Key
 */
export function decryptApiKey(encrypted: string): string {
  const key = getCachedKey();
  const data = Buffer.from(encrypted, 'base64');

  if (data.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data');
  }

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH, data.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
