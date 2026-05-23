import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  Clock,
  BookOpen,
  Sparkles,
  Loader2,
  ChevronRight,
  Download,
} from 'lucide-react';
import type { ResearchDoc } from '../trpc';
import { mtaApi } from '../trpc';

interface VideoInfo {
  id: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  duration: number | string | null;
  description: string | null;
  shareUrl: string;
}

interface DeepResearchPageProps {
  video: VideoInfo;
  docs: ResearchDoc[];
  onClose: () => void;
  onDocsChange: () => void;
  workspaceId: string;
}

/* ---------- Markdown 渲染 ---------- */
function MarkdownView({ content }: { content: string }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-xl sm:text-2xl font-bold text-[#1A1A1A] mt-4 mb-3">{children}</h1>,
          h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-lg sm:text-xl font-bold text-[#1A1A1A] mt-4 mb-2">{children}</h2>,
          h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-base sm:text-lg font-bold text-[#1A1A1A] mt-3 mb-2">{children}</h3>,
          p: ({ children }: { children?: React.ReactNode }) => <p className="text-sm sm:text-base text-[#1A1A1A]/80 leading-relaxed my-1.5">{children}</p>,
          ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }: { children?: React.ReactNode }) => <li className="text-sm sm:text-base text-[#1A1A1A]/80 leading-relaxed">{children}</li>,
          blockquote: ({ children }: { children?: React.ReactNode }) => (
            <blockquote className="border-l-4 border-[#2C2C2C]/20 pl-4 my-3 italic text-[#1A1A1A]/70">{children}</blockquote>
          ),
          code: ({ children }: { children?: React.ReactNode }) => (
            <code className="bg-[#FAFAFA] px-1.5 py-0.5 rounded text-sm font-mono text-[#1A1A1A]">{children}</code>
          ),
          pre: ({ children }: { children?: React.ReactNode }) => (
            <pre className="bg-[#FAFAFA] p-3 rounded-lg overflow-x-auto text-sm font-mono text-[#1A1A1A] my-2">{children}</pre>
          ),
          a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>
          ),
          table: ({ children }: { children?: React.ReactNode }) => (
            <table className="w-full border-collapse text-sm my-3">{children}</table>
          ),
          th: ({ children }: { children?: React.ReactNode }) => (
            <th className="border border-[#EAEAEA] px-3 py-2 text-left font-semibold bg-[#FAFAFA]">{children}</th>
          ),
          td: ({ children }: { children?: React.ReactNode }) => (
            <td className="border border-[#EAEAEA] px-3 py-2">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/* ---------- 新建研究弹框 ---------- */
function TopicModal({
  videoTitle,
  onSubmit,
  onCancel,
  loading,
}: {
  videoTitle: string;
  onSubmit: (topic: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [topic, setTopic] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#2C2C2C] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#1A1A1A]">深度研究</h3>
            <p className="text-xs text-[#8C8C8C]">基于视频内容生成深度报告</p>
          </div>
        </div>

        <div className="mt-4 mb-4">
          <p className="text-sm text-[#1A1A1A]/70 mb-3">
            视频：<span className="font-medium text-[#1A1A1A]">{videoTitle}</span>
          </p>
          <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">
            想深入聊点什么？
          </label>
          <input
            ref={inputRef}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && topic.trim() && !loading) onSubmit(topic.trim());
            }}
            placeholder="例如：人工智能的发展趋势、新能源汽车技术..."
            className="w-full px-4 py-3 rounded-xl border border-[#EAEAEA] bg-[#FAFAFA] text-[#1A1A1A] text-sm placeholder:text-[#8C8C8C] focus:outline-none focus:ring-2 focus:ring-[#2C2C2C]/10 focus:border-[#2C2C2C]/30 transition-all"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#EAEAEA] text-sm font-medium text-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => topic.trim() && onSubmit(topic.trim())}
            disabled={!topic.trim() || loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#2C2C2C] text-sm font-medium text-white hover:bg-[#1A1A1A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? '研究中...' : '开始研究'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- 文档列表页 ---------- */
function DocListView({
  docs,
  onNew,
  onOpen,
  onDelete,
  videoTitle,
}: {
  docs: ResearchDoc[];
  onNew: () => void;
  onOpen: (doc: ResearchDoc) => void;
  onDelete: (docId: string) => void;
  videoTitle: string;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
      <div className="max-w-lg mx-auto">
        <p className="text-sm text-[#8C8C8C] mb-4">
          视频：<span className="text-[#1A1A1A]">{videoTitle}</span>
        </p>

        <button
          onClick={onNew}
          className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[#EAEAEA] text-sm font-medium text-[#8C8C8C] hover:border-[#2C2C2C]/30 hover:text-[#1A1A1A] transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建深度研究
        </button>

        {docs.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 mx-auto text-[#EAEAEA] mb-3" />
            <p className="text-sm text-[#8C8C8C]">暂无研究文档</p>
            <p className="text-xs text-[#8C8C8C]/70 mt-1">点击上方按钮开始新的深度研究</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <motion.div
                key={doc.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="group bg-white rounded-xl border border-[#EAEAEA] p-4 hover:border-[#2C2C2C]/20 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => onOpen(doc)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[#1A1A1A] truncate">{doc.title}</h4>
                    <p className="text-xs text-[#8C8C8C] mt-0.5 truncate">
                      主题：{doc.topic}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-[#8C8C8C] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('zh-CN') : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ChevronRight className="w-4 h-4 text-[#EAEAEA] group-hover:text-[#8C8C8C] transition-colors" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(doc.id);
                      }}
                      className="p-1.5 rounded-lg text-[#EAEAEA] hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 报告阅读页 ---------- */
function ReportView({
  doc,
  workspaceId,
  onBack,
  onDelete,
}: {
  doc: ResearchDoc;
  workspaceId: string;
  onBack: () => void;
  onDelete: (docId: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = async (format: 'pdf' | 'docx' | 'html') => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const result = await mtaApi.researchExport({ docId: doc.id, workspaceId, format });
      if (result.error || !result.base64) {
        alert(result.error || '导出失败');
        return;
      }
      const blob = new Blob([Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename || `研究文档.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#EAEAEA]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-[#1A1A1A] hover:text-[#8C8C8C] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>
        <div className="flex items-center gap-2">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              disabled={exporting}
              className="flex items-center gap-1.5 text-sm font-medium text-[#1A1A1A] hover:text-[#8C8C8C] transition-colors disabled:opacity-40"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? '导出中...' : '导出'}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[#EAEAEA] rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
                <button onClick={() => handleExport('pdf')} className="w-full text-left px-3 py-2 text-sm text-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">导出 PDF</button>
                <button onClick={() => handleExport('docx')} className="w-full text-left px-3 py-2 text-sm text-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">导出 Word</button>
                <button onClick={() => handleExport('html')} className="w-full text-left px-3 py-2 text-sm text-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors">导出 HTML</button>
              </div>
            )}
          </div>
          <button
            onClick={() => onDelete(doc.id)}
            className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            删除
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-[#1A1A1A]">{doc.title}</h1>
            <p className="text-sm text-[#8C8C8C] mt-1">研究主题：{doc.topic}</p>
          </div>

          <div className="prose prose-sm max-w-none">
            <MarkdownView content={doc.content} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 生成结果页 ---------- */
function GeneratedView({
  content,
  topic,
  videoTitle,
  onBack,
  onSave,
  onDiscard,
  saving,
}: {
  content: string;
  topic: string;
  videoTitle: string;
  onBack: () => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `${topic} 深度研究报告`;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#EAEAEA]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-[#1A1A1A] hover:text-[#8C8C8C] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-[#8C8C8C] hover:text-[#1A1A1A] hover:bg-[#FAFAFA] transition-colors"
          >
            丢弃
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[#2C2C2C] text-white hover:bg-[#1A1A1A] disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Save className="w-3.5 h-3.5" />
            {saving ? '保存中...' : '保留'}
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-[#1A1A1A]">{title}</h1>
            <p className="text-sm text-[#8C8C8C] mt-1">
              基于「{videoTitle}」· 主题：{topic}
            </p>
          </div>

          <div className="prose prose-sm max-w-none">
            <MarkdownView content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 主组件 ---------- */
export default function DeepResearchPage({
  video,
  docs,
  onClose,
  onDocsChange,
  workspaceId,
}: DeepResearchPageProps) {
  const [view, setView] = useState<'list' | 'topic' | 'generating' | 'result'>('list');
  const [topic, setTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeDoc, setActiveDoc] = useState<ResearchDoc | null>(null);

  const handleStartResearch = useCallback(async (t: string) => {
    setTopic(t);
    setView('generating');
    setGenerating(true);
    try {
      const result = await mtaApi.research({
        videoId: video.id,
        workspaceId,
        topic: t,
      });
      if (result.error || !result.content) {
        alert('深度研究生成失败，请稍后重试');
        setView('topic');
        return;
      }
      setGeneratedContent(result.content);
      setView('result');
    } catch {
      alert('深度研究生成失败，请稍后重试');
      setView('topic');
    } finally {
      setGenerating(false);
    }
  }, [video.id, workspaceId]);

  const handleSave = useCallback(async () => {
    const titleMatch = generatedContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : `${topic} 深度研究报告`;

    setSaving(true);
    try {
      await mtaApi.researchSave({
        videoId: video.id,
        workspaceId,
        title,
        topic,
        content: generatedContent,
      });
      await onDocsChange();
      setView('list');
      setGeneratedContent('');
    } catch {
      alert('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [generatedContent, topic, video.id, workspaceId, onDocsChange]);

  const handleDelete = useCallback(async (docId: string) => {
    if (!confirm('确定要删除这份研究文档吗？')) return;
    try {
      await mtaApi.researchDelete({ docId, workspaceId });
      await onDocsChange();
      if (activeDoc?.id === docId) {
        setActiveDoc(null);
        setView('list');
      }
    } catch {
      alert('删除失败，请稍后重试');
    }
  }, [activeDoc, workspaceId, onDocsChange]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#EAEAEA] flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-[#1A1A1A] hover:text-[#8C8C8C] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回详情
        </button>
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#8C8C8C]" />
          <span className="text-sm font-semibold text-[#1A1A1A]">MTA Deep Research 深度研究</span>
        </div>
        <div className="w-16" />
      </div>

      <AnimatePresence mode="wait">
        {view === 'list' && (
          <DocListView
            key="list"
            docs={docs}
            videoTitle={video.title || '无标题视频'}
            onNew={() => setView('topic')}
            onOpen={(doc) => {
              setActiveDoc(doc);
              setView('result');
            }}
            onDelete={handleDelete}
          />
        )}

        {view === 'topic' && (
          <TopicModal
            key="topic"
            videoTitle={video.title || '无标题视频'}
            onSubmit={handleStartResearch}
            onCancel={() => setView('list')}
            loading={generating}
          />
        )}

        {view === 'generating' && (
          <motion.div
            key="generating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center"
          >
            <Loader2 className="w-10 h-10 text-[#2C2C2C] animate-spin mb-4" />
            <p className="text-lg font-semibold text-[#1A1A1A]">正在深度研究...</p>
            <p className="text-sm text-[#8C8C8C] mt-1">围绕「{topic}」生成研究报告中</p>
          </motion.div>
        )}

        {view === 'result' && activeDoc && (
          <ReportView
            key={`report-${activeDoc.id}`}
            doc={activeDoc}
            workspaceId={workspaceId}
            onBack={() => {
              setActiveDoc(null);
              setView('list');
            }}
            onDelete={handleDelete}
          />
        )}

        {view === 'result' && !activeDoc && (
          <GeneratedView
            key="generated"
            content={generatedContent}
            topic={topic}
            videoTitle={video.title || '无标题视频'}
            onBack={() => setView('topic')}
            onSave={handleSave}
            onDiscard={() => {
              setGeneratedContent('');
              setView('list');
            }}
            saving={saving}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
