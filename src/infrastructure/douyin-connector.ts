import { VideoMetadata, ParsedUrl, Platform } from '../domain/types';
import { PARSE_INVALID_URL, PARSE_PLATFORM_UNSUPPORTED } from '../domain/errors';

export interface DouyinConnector {
  parseUrl(url: string): Promise<ParsedUrl>;
  fetchMetadata(parsed: ParsedUrl): Promise<VideoMetadata>;
}

// 简单的 URL 归一化
export function normalizeUrl(url: string): { platform: Platform; normalizedUrl: string; hash: string } {
  try {
    const urlObj = new URL(url);
    const platform = detectPlatform(urlObj.hostname);
    const normalizedUrl = urlObj.origin + urlObj.pathname;
    const hash = Buffer.from(normalizedUrl).toString('base64url').slice(0, 16);
    return { platform, normalizedUrl, hash };
  } catch {
    throw PARSE_INVALID_URL(url);
  }
}

function detectPlatform(hostname: string): Platform {
  if (hostname.includes('douyin')) return 'douyin';
  if (hostname.includes('kuaishou')) return 'kuaishou';
  if (hostname.includes('bilibili')) return 'bilibili';
  throw PARSE_PLATFORM_UNSUPPORTED(hostname);
}

// Mock 实现（Phase 1 使用）
export class MockDouyinConnector implements DouyinConnector {
  async parseUrl(url: string): Promise<ParsedUrl> {
    const { platform, normalizedUrl, hash } = normalizeUrl(url);
    const match = url.match(/\/video\/(\d+)/);
    return {
      platform,
      platformVideoId: match?.[1],
      normalizedUrl,
      normalizedUrlHash: hash,
    };
  }

  async fetchMetadata(parsed: ParsedUrl): Promise<VideoMetadata> {
    // Mock 数据，模拟网络延迟
    await new Promise((r) => setTimeout(r, 200));

    return {
      platformVideoId: parsed.platformVideoId,
      title: `Mock Video ${parsed.platformVideoId || 'unknown'}`,
      description: 'This is a mock video description for Phase 1 development',
      authorName: 'Mock Creator',
      authorId: 'mock_author_001',
      coverUrl: 'https://picsum.photos/400/600',
      duration: 120,
      viewCount: 10000,
      likeCount: 500,
      tags: ['mock', 'test', 'development'],
    };
  }
}
