/**
 * 抖音视频连接器
 *
 * 通过直接获取抖音分享页面的 HTML，
 * 从中提取视频元数据（标题、作者、封面、标签等）。
 *
 * 优先级：
 * 1. RENDER_DATA / SSR JSON（完整元数据包括视频地址）
 * 2. 正则 fallback
 */

/** 抖音视频元数据 */
export interface DouyinVideoMeta {
  title: string;
  authorName: string | null;
  authorId: string | null;
  coverUrl: string | null;
  duration: number | null;       // 秒
  description: string | null;
  videoPlayUrl: string | null;   // 视频下载地址
  tags: string[];
}

/**
 * 从分享文本中提取抖音 URL
 */
export function extractDouyinUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/?/);
  if (urlMatch) return urlMatch[0];
  const longMatch = text.match(/https?:\/\/www\.douyin\.com\/video\/\d+/);
  if (longMatch) return longMatch[0];
  return null;
}

/**
 * 标准化抖音 URL（解析短链接 → 长链接）
 *
 * 注意：抖音对无 Cookie 的请求可能返回首页而不是正确重定向，
 * 所以需要验证重定向结果是否包含视频 ID
 */
export async function normalizeDouyinUrl(shortUrl: string): Promise<string> {
  try {
    const resp = await fetch(shortUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    const finalUrl = resp.url;

    // 验证重定向结果是否是有效的视频页面
    // 有效格式：https://www.douyin.com/video/123456789 或包含 modal_id 参数
    if (finalUrl && (finalUrl.includes('/video/') || finalUrl.includes('modal_id='))) {
      return finalUrl;
    }

    // 如果重定向到首页或其他无效页面，保留原始 URL
    console.warn(`[DouyinConnector] Redirect to invalid URL: ${finalUrl}, keeping original: ${shortUrl}`);
    return shortUrl;
  } catch (e) {
    console.warn(`[DouyinConnector] Failed to normalize URL: ${shortUrl}`, e);
    return shortUrl;
  }
}

/**
 * 获取抖音视频的元数据
 */
export async function fetchDouyinVideoMeta(shareUrl: string): Promise<DouyinVideoMeta> {
  console.log(`[DouyinConnector] Fetching video meta for: ${shareUrl}`);

  const defaultMeta: DouyinVideoMeta = {
    title: '无标题视频',
    authorName: null,
    authorId: null,
    coverUrl: null,
    duration: null,
    description: null,
    videoPlayUrl: null,
    tags: [],
  };

  try {
    // 1. 标准化 URL（尝试解析短链接）
    const normalizedUrl = await normalizeDouyinUrl(shareUrl);
    console.log(`[DouyinConnector] Normalized URL: ${normalizedUrl}`);

    // 2. 尝试从 HTML 获取 RENDER_DATA
    const directHtml = await fetchRawHtml(normalizedUrl);
    if (directHtml) {
      const renderData = extractRenderData(directHtml);
      if (renderData) {
        const metaFromRender = extractMetaFromRenderData(renderData);
        if (metaFromRender) {
          console.log(`[DouyinConnector] Extracted from RENDER_DATA:`, JSON.stringify({
            title: metaFromRender.title, author: metaFromRender.authorName,
            duration: metaFromRender.duration,
            hasCover: !!metaFromRender.coverUrl,
            hasVideoUrl: !!metaFromRender.videoPlayUrl,
            tags: metaFromRender.tags,
          }));
          // RENDER_DATA 可能没有封面，用正则补充
          if (!metaFromRender.coverUrl) {
            metaFromRender.coverUrl = extractCoverUrl(directHtml);
          }
          return metaFromRender;
        }
      }
      // 正则 fallback 从 HTML
      const regexMeta = extractMetaFromHtml(directHtml, defaultMeta);
      if (regexMeta.title !== defaultMeta.title || regexMeta.coverUrl) {
        console.log(`[DouyinConnector] Extracted from HTML regex:`, JSON.stringify({
          title: regexMeta.title, hasCover: !!regexMeta.coverUrl,
        }));
        return regexMeta;
      }
    }

    console.warn('[DouyinConnector] Failed to extract metadata from HTML');
    return defaultMeta;

  } catch (error) {
    console.error('[DouyinConnector] Failed:', error);
    return defaultMeta;
  }
}

// ============ HTML 解析辅助函数 ============

/**
 * 从 HTML 正则提取元数据
 */
function extractMetaFromHtml(html: string, defaultMeta: DouyinVideoMeta): DouyinVideoMeta {
  return {
    title: extractTitle(html) || defaultMeta.title,
    authorName: extractAuthor(html),
    authorId: null,
    coverUrl: extractCoverUrl(html),
    duration: extractDurationFromHtml(html),
    description: extractDescription(html),
    videoPlayUrl: extractVideoPlayUrl(html),
    tags: extractTags(html),
  };
}

/**
 * 获取原始 HTML
 */
async function fetchRawHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': 'ttwid=1%7Cxxx',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const html = await resp.text();
    console.log(`[DouyinConnector] Direct HTML length: ${html.length}`);
    return html;
  } catch (error) {
    console.error('[DouyinConnector] Direct HTML fetch failed:', error);
    return null;
  }
}

/**
 * 从 HTML 文本中提取 RENDER_DATA JSON
 */
function extractRenderData(html: string): Record<string, unknown> | null {
  try {
    // 方式1: <script id="RENDER_DATA"> 标签
    const renderMatch = html.match(/<script\s+id="RENDER_DATA"\s*[^>]*>([\s\S]*?)<\/script>/i);
    if (renderMatch) {
      const decoded = decodeURIComponent(renderMatch[1].trim());
      return JSON.parse(decoded) as Record<string, unknown>;
    }

    // 方式2: window._ROUTER_DATA
    const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i);
    if (routerMatch) {
      return JSON.parse(routerMatch[1]) as Record<string, unknown>;
    }
  } catch (error) {
    console.warn('[DouyinConnector] Failed to parse RENDER_DATA:', error);
  }
  return null;
}

/**
 * 从 RENDER_DATA 中提取视频元数据
 */
function extractMetaFromRenderData(data: Record<string, unknown>): DouyinVideoMeta | null {
  try {
    let awemeDetail: Record<string, unknown> | null = null;

    for (const key of Object.keys(data)) {
      const value = data[key] as Record<string, unknown> | undefined;
      if (!value || typeof value !== 'object') continue;

      if (value.awemeDetail && typeof value.awemeDetail === 'object') {
        awemeDetail = value.awemeDetail as Record<string, unknown>;
        break;
      }

      const app = value.app as Record<string, unknown> | undefined;
      if (app?.videoDetail && typeof app.videoDetail === 'object') {
        awemeDetail = app.videoDetail as Record<string, unknown>;
        break;
      }

      for (const subKey of Object.keys(value)) {
        const subValue = value[subKey];
        if (subValue && typeof subValue === 'object') {
          const sub = subValue as Record<string, unknown>;
          if (sub.awemeDetail && typeof sub.awemeDetail === 'object') {
            awemeDetail = sub.awemeDetail as Record<string, unknown>;
            break;
          }
        }
      }
      if (awemeDetail) break;
    }

    if (!awemeDetail) {
      console.log('[DouyinConnector] No awemeDetail found in RENDER_DATA');
      return null;
    }

    const desc = getStringField(awemeDetail, 'desc') || '无标题视频';
    const authorObj = awemeDetail.author as Record<string, unknown> | undefined;
    const authorName = authorObj ? getStringField(authorObj, 'nickname') : null;
    const authorId = authorObj ? getStringField(authorObj, 'unique_id') || getStringField(authorObj, 'sec_uid') : null;

    const videoObj = awemeDetail.video as Record<string, unknown> | undefined;
    let coverUrl: string | null = null;
    let videoPlayUrl: string | null = null;
    let duration: number | null = null;

    if (videoObj) {
      const coverObj = videoObj.cover as Record<string, unknown> | undefined;
      const originCoverObj = videoObj.origin_cover as Record<string, unknown> | undefined;
      if (coverObj) {
        const urlList = coverObj.url_list as string[] | undefined;
        if (urlList && urlList.length > 0) coverUrl = urlList[urlList.length - 1];
      }
      if (!coverUrl && originCoverObj) {
        const urlList = originCoverObj.url_list as string[] | undefined;
        if (urlList && urlList.length > 0) coverUrl = urlList[urlList.length - 1];
      }

      const playAddrObj = videoObj.play_addr as Record<string, unknown> | undefined;
      if (playAddrObj) {
        const urlList = playAddrObj.url_list as string[] | undefined;
        if (urlList && urlList.length > 0) videoPlayUrl = urlList[urlList.length - 1];
      }
      if (!videoPlayUrl) {
        const play265 = videoObj.play_addr_265 as Record<string, unknown> | undefined;
        if (play265) {
          const urlList = play265.url_list as string[] | undefined;
          if (urlList && urlList.length > 0) videoPlayUrl = urlList[urlList.length - 1];
        }
      }

      const dur = getNumberField(videoObj, 'duration');
      if (dur && dur > 0) duration = Math.round(dur / 1000);
    }

    const tags: string[] = [];
    const textExtra = awemeDetail.text_extra as Record<string, unknown>[] | undefined;
    if (Array.isArray(textExtra)) {
      for (const extra of textExtra) {
        const tagName = getStringField(extra, 'hashtag_name');
        if (tagName) tags.push(tagName);
      }
    }

    return {
      title: desc, authorName, authorId, coverUrl, duration,
      description: desc, videoPlayUrl, tags,
    };
  } catch (error) {
    console.error('[DouyinConnector] extractMetaFromRenderData failed:', error);
    return null;
  }
}

// ============ 正则提取辅助函数 ============

function extractTitle(text: string): string | null {
  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)(?:\s*[-|]\s*抖音|$)/i);
  if (titleMatch) return decodeHtmlEntities(titleMatch[1].trim());
  const ssrTitle = text.match(/"desc"\s*:\s*"([^"]+)"/);
  if (ssrTitle) return decodeHtmlEntities(ssrTitle[1]);
  const ogTitle = text.match(/property="og:title"\s+content="([^"]+)"/i);
  if (ogTitle) return decodeHtmlEntities(ogTitle[1]);
  return null;
}

function extractAuthor(text: string): string | null {
  const authorMatch = text.match(/"nickname"\s*:\s*"([^"]+)"/);
  if (authorMatch) return decodeHtmlEntities(authorMatch[1]);
  const metaAuthor = text.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (metaAuthor) return decodeHtmlEntities(metaAuthor[1]);
  return null;
}

function extractCoverUrl(text: string): string | null {
  // 1. 匹配 RENDER_DATA / SSR JSON 中的 cover url_list
  const coverMatch = text.match(/"cover"\s*:\s*\{[^}]*"url_list"\s*:\s*\[\s*"([^"]+)"/);
  if (coverMatch) return coverMatch[1].replace(/\\u002F/g, '/');

  // 2. 匹配 origin_cover url_list（抖音原图质量更高）
  const originCoverMatch = text.match(/"origin_cover"\s*:\s*\{[^}]*"url_list"\s*:\s*\[\s*"([^"]+)"/);
  if (originCoverMatch) return originCoverMatch[1].replace(/\\u002F/g, '/');

  // 3. 匹配 poster 属性
  const posterMatch = text.match(/poster\s*=\s*"([^"]+)"/);
  if (posterMatch) return posterMatch[1];

  // 4. 匹配 og:image meta 标签
  const ogImage = text.match(/property="og:image"\s+content="([^"]+)"/i);
  if (ogImage) return ogImage[1];
  const ogImage2 = text.match(/content="([^"]+)"\s+property="og:image"/i);
  if (ogImage2) return ogImage2[1];

  // 5. 匹配抖音 CDN 图片 URL（常见域名和路径模式）
  const douyinPicMatch = text.match(/(https?:\/\/[^\s"<>]+douyinpic\.com[^\s"<>]*\.(?:jpg|jpeg|png|webp))/i);
  if (douyinPicMatch) return douyinPicMatch[1];

  const tosPicMatch = text.match(/(https?:\/\/[^\s"<>]*tos-[^\s"<>]*\.[^/]+\/[^\s"<>]*\.(?:jpg|jpeg|png|webp))/i);
  if (tosPicMatch) return tosPicMatch[1];

  const awemePicMatch = text.match(/(https?:\/\/[^\s"<>]*aweme[^\s"<>]*\.(?:jpg|jpeg|png|webp))/i);
  if (awemePicMatch) return awemePicMatch[1];

  // 6. 匹配 background-image url
  const bgMatch = text.match(/background-image:\s*url\((?:["']?)([^"')]+)\1?\)/i);
  if (bgMatch) return bgMatch[1];

  // 7. 匹配 page 中的大图 img src
  const imgMatch = text.match(/<img[^>]*src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
  if (imgMatch) return imgMatch[1];

  // 8. 匹配任何看起来像图片的 https URL（兜底，优先大域名）
  const genericPicMatch = text.match(/(https?:\/\/p\d+-[^/]+\.douyinpic\.com[^\s"<>]*)/i);
  if (genericPicMatch) return genericPicMatch[1];

  return null;
}

function extractVideoPlayUrl(text: string): string | null {
  const playMatch = text.match(/"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["([^"]+)"/);
  if (playMatch) return playMatch[1].replace(/\\u002F/g, '/');
  const videoSrc = text.match(/<video[^>]*src="([^"]+)"/i);
  if (videoSrc) return videoSrc[1];
  const playApi = text.match(/"playApi"\s*:\s*"([^"]+)"/);
  if (playApi) return playApi[1].replace(/\\u002F/g, '/');
  return null;
}

function extractDurationFromHtml(text: string): number | null {
  const durationMatch = text.match(/"duration"\s*:\s*(\d+)/);
  if (durationMatch) {
    const ms = parseInt(durationMatch[1], 10);
    return Math.round(ms / 1000);
  }
  return null;
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const hashTags = text.match(/#([^\s#<>"']+)/g);
  if (hashTags) {
    for (const tag of hashTags) {
      const clean = tag.substring(1).trim();
      if (clean.length > 0 && clean.length < 30 && tags.length < 10) {
        tags.push(clean);
      }
    }
  }
  return tags;
}

function extractDescription(text: string): string | null {
  const descMatch = text.match(/"desc"\s*:\s*"([^"]+)"/);
  if (descMatch) return decodeHtmlEntities(descMatch[1]);
  return null;
}

function getStringField(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === 'string' ? val : null;
}

function getNumberField(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  return typeof val === 'number' ? val : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
