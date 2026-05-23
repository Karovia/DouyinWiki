import { WikiItem } from '../types';
import { motion } from 'motion/react';
import { ArrowRight, RefreshCw } from 'lucide-react';

interface WikiGridProps {
  items: WikiItem[];
  onViewDetail?: (videoId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export default function WikiGrid({ items, onViewDetail, onRefresh, isRefreshing }: WikiGridProps) {
  return (
    <div className="space-y-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] sm:text-[48px] font-bold tracking-tight text-text-primary">Wiki 列表</h1>
          <span className="px-3 py-1 sm:px-4 sm:py-1.5 bg-surface-container border border-border-subtle rounded-full text-[13px] sm:text-[14px] font-medium">
            {items.length} 项
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="sm:ml-auto inline-flex items-center justify-center gap-2 px-4 py-2 border border-border-subtle rounded-full text-[13px] font-medium text-text-secondary hover:text-text-primary hover:border-text-secondary transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? '刷新中...' : '刷新'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
        {items.map((item, index) => (
          <motion.article 
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="card p-4 sm:p-6 flex flex-col group hover:border-text-secondary hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] cursor-default"
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-border-subtle mb-4 sm:mb-6">
              {item.imageUrl ? (
                <img 
                  src={item.imageUrl} 
                  alt={item.title || '视频封面'}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 z-10"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center text-text-secondary/40 text-[14px] z-0">
                暂无封面
              </div>
              <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-white text-[11px] font-medium z-20">
                {item.duration || '--:--'}
              </div>
            </div>

            <div className="flex flex-col flex-grow space-y-3">
              <h2 className="text-[18px] font-bold leading-tight line-clamp-2 text-text-primary group-hover:text-black">
                {item.title || '无标题视频'}
              </h2>
              
              <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                <span>{item.author || '未知作者'}</span>
                <span>·</span>
                <span>{item.timeAgo || '未知时间'}</span>
              </div>

              <p className="text-[14px] text-text-secondary leading-relaxed line-clamp-3 flex-grow">
                {item.summary || '暂无摘要'}
              </p>

              <button
                onClick={() => onViewDetail?.(item.id)}
                className="inline-flex items-center justify-center gap-2 text-[14px] font-bold bg-black text-white rounded-full px-5 py-2.5 hover:gap-3 transition-all mt-2 sm:mt-4 self-center"
              >
                Read Wiki <ArrowRight size={16} />
              </button>
            </div>
          </motion.article>
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-center py-20">
          <p className="text-text-secondary text-[14px] sm:text-[16px]">暂无 Wiki 条目，去导入视频吧</p>
        </div>
      )}
    </div>
  );
}
