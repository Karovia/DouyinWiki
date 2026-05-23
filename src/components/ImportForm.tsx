import { useState, FormEvent } from 'react';
import { ArrowRight, ClipboardPaste } from 'lucide-react';

interface ImportFormProps {
  onImport: (url: string) => void;
  isProcessing: boolean;
}

/**
 * 从抖音分享文本中提取 URL
 * 支持格式：
 * - 纯 URL: https://v.douyin.com/xxxxx/
 * - 分享文本: "3.89 07/08 ... https://v.douyin.com/xxxxx/ 复制此链接..."
 */
function extractDouyinUrl(text: string): string {
  const trimmed = text.trim();

  // 尝试匹配抖音短链接
  const shortUrlMatch = trimmed.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/?/);
  if (shortUrlMatch) return shortUrlMatch[0];

  // 尝试匹配抖音长链接
  const longUrlMatch = trimmed.match(/https?:\/\/www\.douyin\.com\/video\/\d+/);
  if (longUrlMatch) return longUrlMatch[0];

  // 尝试匹配任何 douyin.com URL
  const anyDouyinMatch = trimmed.match(/https?:\/\/[^\s]*douyin\.com[^\s]*/);
  if (anyDouyinMatch) return anyDouyinMatch[0];

  // 都没匹配到，返回原始文本（后端会验证）
  return trimmed;
}

export default function ImportForm({ onImport, isProcessing }: ImportFormProps) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onImport(extractDouyinUrl(url));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // clipboard API 不可用时忽略
    }
  };

  return (
    <div className="flex flex-col items-center text-center space-y-8 md:space-y-12">
      <div className="space-y-3 md:space-y-4">
        <h1 className="text-[32px] md:text-[48px] font-bold tracking-tight text-text-primary leading-[1.2]">
          将视频变成知识
        </h1>
        <p className="text-text-secondary text-[14px] md:text-[16px]">
          粘贴抖音链接，让 AI 帮你提取结构化知识
        </p>
      </div>

      <form 
        onSubmit={handleSubmit}
        className="w-full max-w-[700px] space-y-3"
      >
        {/* 输入框：桌面端给右侧按钮留空间 */}
        <div className="relative group">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴抖音分享链接或分享文本，自动提取链接"
            disabled={isProcessing}
            className="w-full h-14 md:h-16 px-5 md:px-6 md:pr-72 bg-surface border border-border-subtle rounded-2xl text-[15px] md:text-[16px] focus:outline-none focus:border-text-primary transition-all shadow-sm group-hover:border-text-secondary disabled:opacity-50"
          />
          {/* 桌面端：按钮在输入框内右侧 */}
          <div className="hidden md:flex absolute right-2 top-2 bottom-2 items-center gap-2">
            <button
              type="button"
              onClick={handlePaste}
              className="h-full px-3 text-text-secondary hover:text-text-primary transition-colors flex items-center"
              title="从剪贴板粘贴"
            >
              <ClipboardPaste size={20} />
            </button>
            <button
              type="submit"
              disabled={isProcessing || !url.trim()}
              className="h-full bg-accent text-white px-5 rounded-xl flex items-center gap-2 hover:bg-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              开始提取
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* 移动端：按钮在输入框正下方 */}
        <div className="flex md:hidden gap-2">
          <button
            type="button"
            onClick={handlePaste}
            className="flex-1 h-12 px-4 border border-border-subtle rounded-xl text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors flex items-center justify-center gap-2 text-[14px]"
          >
            <ClipboardPaste size={18} />
            粘贴
          </button>
          <button
            type="submit"
            disabled={isProcessing || !url.trim()}
            className="flex-1 h-12 bg-accent text-white px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[14px]"
          >
            开始提取
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
