import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import Footer from './components/Footer';
import ImportForm from './components/ImportForm';
import ProcessingCard from './components/ProcessingCard';
import WikiGrid from './components/WikiGrid';
import MtaPage from './components/MtaPage';
import TrainingPage from './components/TrainingPage';
import PlanningPage from './components/PlanningPage';
import DeepResearchPage from './components/DeepResearchPage';
import { WikiItem, TaskStatus } from './types';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, X, ExternalLink, Tag, AlertCircle, MessageCircle, Send, Trash2, Loader2, Play, ChefHat, RefreshCw, Dumbbell, MapPin, BookOpen, Search } from 'lucide-react';
import { importApi, videosApi, qaApi, mtaApi } from './trpc';
import type { CookingRecipe, MtaRecipeItem, MtaCategory, TrainingPlan, TravelPlan, ResearchDoc } from './trpc';

/**
 * 将秒数格式化为 mm:ss
 */
function formatDuration(seconds: number | string | null): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const secs = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
  if (isNaN(secs) || secs <= 0) return '--:--';
  const min = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * 将后端视频状态映射为前端显示的 timeAgo 文本
 */
function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

/**
 * 将后端任务状态映射为前端进度消息
 */
function getStatusMessage(status: string): string {
  const messages: Record<string, string> = {
    created: '初始化任务...',
    parsing_metadata: '解析视频元数据...',
    fetching_content: '获取视频内容...',
    transcribing: '提取音频转写...',
    chunking: '分段处理中...',
    summarizing: 'AI 生成结构化知识...',
    embedding: '生成向量嵌入...',
    indexing: '索引构建中...',
    graph_updating: '更新知识图谱...',
    completed: '已完成',
    partial_completed: '部分完成',
    failed_retryable: '处理失败，可重试',
    failed_terminal: '处理失败',
    cancelled: '已取消',
  };
  return messages[status] ?? status;
}

/**
 * 将后端 progress(0-100) 映射为前端显示进度
 */
function mapProgress(status: string, progress: number): number {
  if (status === 'completed') return 100;
  return progress;
}

/**
 * 判断任务是否处于终态
 */
function isTerminalStatus(status: string): boolean {
  return ['completed', 'partial_completed', 'failed_terminal', 'cancelled'].includes(status);
}

interface RecentImport {
  id: string;
  title: string;
  date: string;
  status: string;
}

interface VideoDetail {
  id: string;
  title: string;
  authorName: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  duration: number | string | null;
  description: string | null;
  shareUrl: string;
  aiSummary: string | null;
  tags: string[];
  status: string;
  platform: string | null;
  createdAt: number | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 视频播放器组件：从后端获取签名播放 URL
 */
function VideoPlayer({ videoId, coverUrl }: { videoId: string; coverUrl: string | null }) {
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    videosApi.playUrl({ videoId, workspaceId: 'ws_default' })
      .then((result) => {
        if (!cancelled) {
          setPlayUrl(result.playUrl);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '获取播放地址失败');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [videoId]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-white/60 text-[14px] flex items-center gap-2">
          <Loader2 size={20} className="animate-spin" />
          加载视频中...
        </div>
      </div>
    );
  }

  if (error || !playUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3">
        <Play size={36} className="text-white/30" />
        <p className="text-white/50 text-[13px]">{error || '无法加载视频'}</p>
      </div>
    );
  }

  return (
    <video
      src={playUrl}
      controls
      autoPlay
      poster={coverUrl || undefined}
      className="w-full h-full object-contain"
    />
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState<'import' | 'list' | 'mta'>('import');
  const [mtaSubCategory, setMtaSubCategory] = useState<MtaCategory | 'all'>('training');
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [wikis, setWikis] = useState<WikiItem[]>([]);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [isLoadingWikis, setIsLoadingWikis] = useState(false);
  const [detailVideo, setDetailVideo] = useState<VideoDetail | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isCooking, setIsCooking] = useState(false);
  const [showMtaPage, setShowMtaPage] = useState(false);
  const [mtaRecipe, setMtaRecipe] = useState<CookingRecipe | null>(null);
  const [mtaLoading, setMtaLoading] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [showTrainingPage, setShowTrainingPage] = useState(false);
  const [mtaTraining, setMtaTraining] = useState<TrainingPlan | null>(null);
  const [mtaTrainingLoading, setMtaTrainingLoading] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [showPlanningPage, setShowPlanningPage] = useState(false);
  const [mtaPlanning, setMtaPlanning] = useState<TravelPlan | null>(null);
  const [mtaPlanningLoading, setMtaPlanningLoading] = useState(false);
  const [showResearchPage, setShowResearchPage] = useState(false);
  const [researchDocs, setResearchDocs] = useState<ResearchDoc[]>([]);
  const [researchDocsLoading, setResearchDocsLoading] = useState(false);
  const [researchTopic, setResearchTopic] = useState('');
  const [researchContent, setResearchContent] = useState('');
  const [researchLoading, setResearchLoading] = useState(false);
  const [activeResearchDoc, setActiveResearchDoc] = useState<ResearchDoc | null>(null);
  const [researchFromMta, setResearchFromMta] = useState(false);
  const [mtaList, setMtaList] = useState<MtaRecipeItem[]>([]);
  const [mtaListLoading, setMtaListLoading] = useState(false);
  const listPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载 Wiki 列表
  const loadWikis = useCallback(async () => {
    setIsLoadingWikis(true);
    try {
      const result = await videosApi.list({
        workspaceId: 'ws_default',
        limit: 50,
        offset: 0,
      });
      setWikis(
        result.items.map((v: { id: string; title: string | null; authorName: string | null; timeAgo?: string; duration: number | string | null; aiSummary: string | null; description: string | null; coverUrl: string | null; hasVideo?: boolean; createdAt: number | null }) => ({
          id: v.id,
          title: v.title || '无标题视频',
          author: v.authorName ?? '未知作者',
          timeAgo: formatTimeAgo(v.createdAt),
          duration: formatDuration(v.duration),
          summary: v.aiSummary ?? v.description ?? '暂无摘要',
          imageUrl: v.coverUrl ?? '',
          hasVideo: v.hasVideo ?? false,
        })),
      );
      // 更新最近导入列表（取最近5条已完成的）
      setRecentImports(
        result.items
          .filter((v: { status: string }) => v.status === 'completed')
          .slice(0, 5)
          .map((v: { id: string; title: string | null; createdAt: number | null }) => ({
            id: v.id,
            title: v.title || '无标题视频',
            date: v.createdAt ? new Date(v.createdAt).toLocaleString('zh-CN') : '',
            status: 'Completed',
          })),
      );
    } catch (err) {
      console.error('Failed to load wikis:', err);
    } finally {
      setIsLoadingWikis(false);
    }
  }, []);

  // 加载 MTA 列表
  const loadMtaList = useCallback(async (category?: MtaCategory | 'all') => {
    setMtaListLoading(true);
    try {
      const result = await mtaApi.list({ 
        workspaceId: 'ws_default', 
        limit: 50, 
        offset: 0,
        ...(category && category !== 'all' ? { category: category as MtaCategory } : {})
      });
      setMtaList(result.items);
    } catch (err) {
      console.error('Failed to load MTA list:', err);
    } finally {
      setMtaListLoading(false);
    }
  }, []);

  // 删除 MTA 记录
  const handleMtaDelete = async (recipeId: string) => {
    try {
      await mtaApi.delete({ recipeId, workspaceId: 'ws_default' });
      setMtaList(prev => prev.filter(item => item.id !== recipeId));
    } catch (err) {
      console.error('Failed to delete MTA record:', err);
    }
  };

  // 打开 MTA 卡片详情
  const handleOpenMtaDetail = (item: MtaRecipeItem) => {
    if (item.category === 'training') {
      // 解析 duration · difficulty
      const parts = item.servings?.split(' · ') || ['', ''];
      const duration = parts[0] || '';
      const difficulty = parts[1] || '';
      setMtaTraining({
        workoutName: item.dishName,
        targetMuscle: '',
        duration,
        difficulty,
        warmup: item.ingredients || [],
        steps: item.steps as unknown as import('./trpc').TrainingStep[],
        cooldown: item.cooldown || [],
      });
      setMtaRecipe(null);
      setMtaPlanning(null);
      setShowMtaPage(true);
    } else if (item.category === 'planning') {
      // 解析 duration · budgetLevel
      const parts = item.servings?.split(' · ') || ['', ''];
      const duration = parts[0] || '';
      const budgetLevel = parts[1] || '';
      setMtaPlanning({
        planName: item.dishName,
        destination: '',
        duration,
        budgetLevel,
        theme: '',
        overview: '',
        steps: item.steps as unknown as import('./trpc').PlanningStep[],
        tips: item.ingredients || [],
      });
      setMtaRecipe(null);
      setMtaTraining(null);
      setShowMtaPage(true);
    } else if (item.category === 'research') {
      // 深度研究：直接打开 DeepResearchPage
      setResearchFromMta(true);
      if (item.videoId) {
        handleOpenResearch(item.videoId);
      }
    } else {
      setMtaRecipe({
        dishName: item.dishName,
        servings: item.servings || '',
        ingredients: item.ingredients,
        steps: item.steps,
      });
      setMtaTraining(null);
      setMtaPlanning(null);
      setShowMtaPage(true);
    }
  };

  // 初始加载
  useEffect(() => {
    loadWikis();
  }, [loadWikis]);

  // 轮询导入任务状态
  useEffect(() => {
    if (!task || task.status !== 'processing') return;

    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const result = await importApi.status({
          jobId: task.id,
          workspaceId: 'ws_default',
        });

        if (stopped) return;
        if (!result.found || !result.status) return;

        const newStatus: TaskStatus['status'] = isTerminalStatus(result.status)
          ? (result.status === 'completed' ? 'completed' : 'failed')
          : 'processing';

        setTask({
          id: result.jobId ?? task.id,
          progress: mapProgress(result.status, result.progress ?? 0),
          status: newStatus,
          message: getStatusMessage(result.status),
        });

        // 如果任务完成，延迟刷新列表（等后端 Worker 完成最终写入）
        if (newStatus === 'completed') {
          setTimeout(() => { if (!stopped) loadWikis(); }, 3000);
        }
      } catch (err) {
        console.error('Failed to poll task status:', err);
        // 轮询失败不清除 task，让用户看到当前状态，下次轮询会重试
      }
    };

    const interval = setInterval(poll, 2000);
    return () => { stopped = true; clearInterval(interval); };
  }, [task?.id, task?.status, loadWikis]);

  // 处理导入
  const handleImport = async (url: string) => {
    setDuplicateMessage(null);
    try {
      const result = await importApi.create({
        shareUrl: url,
        workspaceId: 'ws_default',
      });

      if (result.isDuplicate) {
        // 重复链接：查询已有任务状态
        const statusResult = await importApi.status({
          jobId: result.jobId,
          workspaceId: 'ws_default',
        });

        if (statusResult.found && statusResult.status) {
          const isTerminal = isTerminalStatus(statusResult.status);
          const newStatus: TaskStatus['status'] = isTerminal
            ? (statusResult.status === 'completed' ? 'completed' : 'failed')
            : 'processing';

          if (newStatus === 'completed') {
            // 视频已导入完成，显示提示
            setDuplicateMessage('该视频已导入完成，可在 Wiki 列表中查看');
            setTimeout(() => loadWikis(), 1000);
          } else if (newStatus === 'processing') {
            // 视频正在处理中
            setDuplicateMessage('该视频正在处理中，请稍后在 Wiki 列表中查看');
            setTask({
              id: result.jobId,
              progress: mapProgress(statusResult.status, statusResult.progress ?? 0),
              status: 'processing',
              message: getStatusMessage(statusResult.status),
            });
          } else {
            setDuplicateMessage('该视频之前处理失败，可尝试重新导入');
          }
        } else {
          loadWikis();
        }
        return;
      }

      setTask({
        id: result.jobId,
        progress: 0,
        status: 'processing',
        message: getStatusMessage(result.status),
      });
    } catch (err) {
      console.error('Failed to create import:', err);
      setTask({
        id: 'ERROR',
        progress: 0,
        status: 'failed',
        message: '创建导入任务失败',
      });
    }
  };

  // 切换到列表视图时刷新数据，并启动自动轮询
  const handleNavigate = (view: 'import' | 'list' | 'mta', subCategory?: MtaCategory | 'all') => {
    setCurrentView(view);
    setShowMtaPage(false);
    setShowResearchPage(false);
    if (view === 'list') {
      loadWikis();
    }
    if (view === 'mta') {
      const cat = subCategory || mtaSubCategory;
      if (subCategory) setMtaSubCategory(subCategory);
      loadMtaList(cat);
    }
  };

  // 列表页自动刷新（30秒轮询）
  useEffect(() => {
    if (currentView === 'list') {
      loadWikis();
      listPollRef.current = setInterval(() => {
        loadWikis();
      }, 30000);
    }
    return () => {
      if (listPollRef.current) {
        clearInterval(listPollRef.current);
        listPollRef.current = null;
      }
    };
  }, [currentView, loadWikis]);

  // 查看视频详情
  const handleViewDetail = async (videoId: string) => {
    try {
      const result = await videosApi.detail({
        videoId,
        workspaceId: 'ws_default',
      });
      if (result.found && result.video) {
        setDetailVideo(result.video as VideoDetail);
        setChatMessages([]);
        setChatInput('');
      }
    } catch (err) {
      console.error('Failed to load video detail:', err);
    }
  };

  // 删除视频
  const handleDeleteVideo = async () => {
    if (!detailVideo) return;
    if (!window.confirm(`确定要删除「${detailVideo.title || '无标题视频'}」吗？云端视频文件也将被删除，此操作不可恢复。`)) return;

    try {
      await videosApi.delete({ videoId: detailVideo.id, workspaceId: 'ws_default' });
      setDetailVideo(null);
      loadWikis();
    } catch (err) {
      console.error('Failed to delete video:', err);
      alert('删除失败，请稍后重试');
    }
  };

  // 发送 Q&A 消息
  const handleSendQuestion = async () => {
    if (!chatInput.trim() || !detailVideo || chatLoading) return;

    const question = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: question }]);
    setChatLoading(true);

    try {
      const result = await qaApi.ask({
        videoId: detailVideo.id,
        question,
        workspaceId: 'ws_default',
      });

      if (result.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `抱歉，${result.error}` }]);
      } else if (result.answer) {
        const sourceTag = result.source === 'video' ? '（基于视频深度分析）' : '';
        setChatMessages(prev => [...prev, { role: 'assistant', content: result.answer + (sourceTag ? `\n\n${sourceTag}` : '') }]);
      }
    } catch (err) {
      console.error('QA error:', err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: '抱歉，回答生成失败，请稍后重试' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // 检测是否为做菜视频
  useEffect(() => {
    if (detailVideo?.tags) {
      const cookingKeywords = ['做菜', '烹饪', '食谱', '教程', '料理', '烘焙', '炒', '煎', '煮', '炸', '蒸', '烤', '焖', '炖', '菜谱', '美食', '厨房', '家常菜', '下厨', '快手菜'];
      const text = [...detailVideo.tags, detailVideo.title || '', detailVideo.aiSummary || ''].join(' ').toLowerCase();
      setIsCooking(cookingKeywords.some(kw => text.includes(kw)));
    } else {
      setIsCooking(false);
    }
  }, [detailVideo]);

  // 检测是否为健身视频
  useEffect(() => {
    if (detailVideo?.tags) {
      const trainingKeywords = ['健身', '训练', '运动', '锻炼', '拉伸', '瑜伽', '普拉提', 'HIIT', '有氧', '无氧', '力量', '增肌', '减脂', '塑形', '核心', '腹肌', '深蹲', '俯卧撑', '引体', '跑步', '跳绳', '燃脂', '暴汗', '跟练', 'tabata'];
      const text = [...detailVideo.tags, detailVideo.title || '', detailVideo.aiSummary || ''].join(' ').toLowerCase();
      setIsTraining(trainingKeywords.some(kw => text.includes(kw)));
    } else {
      setIsTraining(false);
    }
  }, [detailVideo]);

  // 检测是否为旅游攻略视频
  useEffect(() => {
    if (detailVideo?.tags) {
      const travelKeywords = ['旅游', '旅行', '攻略', '游记', '打卡', '景点', '景区', '游玩', '度假', '自由行', '酒店', '民宿', '美食街', '夜市', '必吃', '必玩', '必去', '路线', '行程', '日程', '古镇', '古城', '博物馆', '爬山', '看海', '日出', '日落', '夜景', '购物', '伴手礼', '特产'];
      const text = [...detailVideo.tags, detailVideo.title || '', detailVideo.aiSummary || ''].join(' ').toLowerCase();
      setIsPlanning(travelKeywords.some(kw => text.includes(kw)));
    } else {
      setIsPlanning(false);
    }
  }, [detailVideo]);

  // 一键做同款
  const handleStartCooking = async () => {
    if (!detailVideo) return;
    setMtaLoading(true);
    try {
      const result = await mtaApi.generateRecipe({
        videoId: detailVideo.id,
        workspaceId: 'ws_default',
      });
      if (result.recipe) {
        setMtaRecipe(result.recipe);
        setMtaTraining(null);
        setShowMtaPage(true);
      } else {
        alert(result.error || '菜谱生成失败');
      }
    } catch {
      alert('菜谱生成失败，请稍后重试');
    } finally {
      setMtaLoading(false);
    }
  };

  // 一键跟练
  const handleStartTraining = async () => {
    if (!detailVideo) return;
    setMtaTrainingLoading(true);
    try {
      const result = await mtaApi.generateTraining({ videoId: detailVideo.id, workspaceId: 'ws_default' });
      if (result.plan) {
        setMtaTraining(result.plan);
        setMtaRecipe(null);
        setShowMtaPage(true);
        loadMtaList(mtaSubCategory);
      } else {
        const error = result.error || '训练计划生成失败';
        setChatMessages(prev => [...prev, { role: 'assistant' as const, content: error }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: '训练计划生成失败，请稍后重试' }]);
    }
    setMtaTrainingLoading(false);
  };

  // 一键做同款攻略
  const handleStartPlanning = async () => {
    if (!detailVideo) return;
    setMtaPlanningLoading(true);
    try {
      const result = await mtaApi.generatePlanning({ videoId: detailVideo.id, workspaceId: 'ws_default' });
      if (result.plan) {
        setMtaPlanning(result.plan);
        setMtaRecipe(null);
        setMtaTraining(null);
        setShowMtaPage(true);
        loadMtaList(mtaSubCategory);
      } else {
        const error = result.error || '旅游攻略生成失败';
        setChatMessages(prev => [...prev, { role: 'assistant' as const, content: error }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant' as const, content: '旅游攻略生成失败，请稍后重试' }]);
    }
    setMtaPlanningLoading(false);
  };

  // 深度研究
  const handleOpenResearch = async (videoId?: string) => {
    if (!videoId) {
      setResearchFromMta(false);
    }
    setShowMtaPage(false);
    setMtaList([]);
    setMtaRecipe(null);
    setMtaTraining(null);
    setMtaPlanning(null);
    setShowResearchPage(true);
    setResearchTopic('');
    setResearchContent('');
    setActiveResearchDoc(null);
    let targetVideoId = videoId || detailVideo?.id;
    if (videoId && (!detailVideo || detailVideo.id !== videoId)) {
      try {
        const result = await videosApi.detail({ videoId, workspaceId: 'ws_default' });
        if (result && result.video) {
          const v = result.video;
          setDetailVideo({
            id: v.id,
            title: v.title || '',
            coverUrl: v.coverUrl || '',
            hasVideo: v.hasVideo,
            duration: v.duration,
            description: v.description,
            shareUrl: v.shareUrl || '',
            aiSummary: v.aiSummary,
            authorName: v.authorName,
            tags: v.tags || [],
            status: v.status || '',
            platform: v.platform,
            createdAt: v.createdAt,
          });
          targetVideoId = v.id;
        }
      } catch {
        // ignore
      }
    }
    if (targetVideoId) {
      loadResearchDocs(targetVideoId);
    }
  };

  const loadResearchDocs = useCallback(async (vid?: string) => {
    const targetId = vid || detailVideo?.id;
    if (!targetId) return;
    setResearchDocsLoading(true);
    try {
      const docs = await mtaApi.researchList({ videoId: targetId, workspaceId: 'ws_default' });
      setResearchDocs(docs);
    } catch {
      setResearchDocs([]);
    } finally {
      setResearchDocsLoading(false);
    }
  }, [detailVideo]);

  const handleSubmitResearchTopic = async (topic: string) => {
    if (!detailVideo || !topic.trim()) return;
    setResearchLoading(true);
    setResearchContent('');
    try {
      const result = await mtaApi.research({ videoId: detailVideo.id, workspaceId: 'ws_default', topic: topic.trim() });
      if (result.content) {
        setResearchContent(result.content);
      } else {
        setResearchContent('研究生成失败，请稍后重试');
      }
    } catch {
      setResearchContent('研究生成失败，请稍后重试');
    }
    setResearchLoading(false);
  };

  const handleSaveResearchDoc = async () => {
    if (!detailVideo || !researchContent || !researchTopic) return;
    try {
      await mtaApi.researchSave({ videoId: detailVideo.id, workspaceId: 'ws_default', title: researchTopic, topic: researchTopic, content: researchContent });
      loadResearchDocs();
    } catch {
      // ignore
    }
  };

  const handleDeleteResearchDoc = async (docId: string) => {
    if (!detailVideo) return;
    try {
      await mtaApi.researchDelete({ docId, workspaceId: 'ws_default' });
      loadResearchDocs();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-black selection:text-white">
      <Header currentView={currentView} onNavigate={handleNavigate} mtaSubCategory={mtaSubCategory} />
      
      <main className="flex-grow w-full px-4 sm:px-6 md:px-12 max-w-[1200px] mx-auto py-8 md:py-20">
        <AnimatePresence mode="wait">
          {currentView === 'import' ? (
            <motion.div 
              key="import-view"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="space-y-10 md:space-y-16"
            >
              <ImportForm onImport={handleImport} isProcessing={!!task && task.status === 'processing'} />
              
              {task && <ProcessingCard task={task} />}

              {/* 重复链接提示 */}
              <AnimatePresence>
                {duplicateMessage && (
                  <motion.div
                    key="duplicate-msg"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="max-w-[700px] mx-auto flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-[14px] text-yellow-800"
                  >
                    <AlertCircle size={18} className="shrink-0" />
                    <span className="flex-grow">{duplicateMessage}</span>
                    <button
                      onClick={() => setDuplicateMessage(null)}
                      className="shrink-0 text-yellow-600 hover:text-yellow-900 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {!task && (
                <div className="space-y-8 pt-20 max-w-[700px] mx-auto">
                  <h3 className="text-center text-[12px] font-bold text-text-secondary uppercase tracking-[0.2em]">最近导入</h3>
                  <div className="space-y-3">
                    {recentImports.length > 0 ? (
                      recentImports.map((item) => (
                        <div key={item.id} className="card p-5 flex justify-between items-center hover:border-text-secondary transition-all cursor-pointer">
                          <div className="space-y-1">
                            <p className="text-[15px] font-bold text-text-primary">{item.title}</p>
                            <p className="text-[12px] text-text-secondary">{item.date}</p>
                          </div>
                          <div className="flex items-center gap-2 text-[13px] text-text-secondary font-medium">
                            <CheckCircle2 size={16} className="text-green-500" />
                            {item.status}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-[14px] text-text-secondary py-8">暂无导入记录</p>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ) : currentView === 'list' ? (
            <motion.div 
              key="list-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {isLoadingWikis ? (
                <div className="text-center py-20">
                  <p className="text-text-secondary text-[16px]">加载中...</p>
                </div>
              ) : (
                <WikiGrid items={wikis} onViewDetail={handleViewDetail} onRefresh={loadWikis} isRefreshing={isLoadingWikis} />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="mta-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {/* MTA 列表页 */}
              <div className="space-y-6 md:space-y-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <h2 className="text-[24px] sm:text-[32px] md:text-[48px] font-bold text-text-primary">
                    {mtaSubCategory === 'training' ? 'MTA Training 健身' :
                     mtaSubCategory === 'recipes' ? 'MTA Recipes 烹饪' :
                     mtaSubCategory === 'planning' ? 'MTA Planning 旅游规划' :
                     mtaSubCategory === 'research' ? 'MTA Deep Research 深度研究' : 'MTA'}
                  </h2>
                  <button
                    onClick={() => loadMtaList(mtaSubCategory)}
                    className="text-[13px] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw size={14} className={mtaListLoading ? 'animate-spin' : ''} />
                    刷新
                  </button>
                </div>

                {/* MTA 子分类描述 */}
                <p className="text-[14px] text-text-secondary">
                  {mtaSubCategory === 'training' && '健身跟练卡片，通过视频学习动作与训练计划'}
                  {mtaSubCategory === 'recipes' && '精选食谱合集，一键生成步骤教程卡片'}
                  {mtaSubCategory === 'planning' && '旅游规划助手，根据视频生成行程攻略'}
                  {mtaSubCategory === 'research' && '深度研究助手，探索前沿科技与知识'}
                </p>

                {mtaListLoading ? (
                  <div className="text-center py-20">
                    <p className="text-text-secondary text-[16px]">加载中...</p>
                  </div>
                ) : mtaList.length === 0 ? (
                  <div className="text-center py-20">
                    <p className="text-text-secondary text-[16px]">
                      {mtaSubCategory === 'training' ? '暂无健身记录' :
                       mtaSubCategory === 'recipes' ? '暂无菜谱记录' :
                       mtaSubCategory === 'planning' ? '暂无攻略记录' :
                       mtaSubCategory === 'research' ? '暂无研究记录' : '暂无记录'}
                    </p>
                    <p className="text-text-secondary text-[13px] mt-2">
                      {mtaSubCategory === 'training' ? '在详情页识别到健身视频后，可一键生成跟练卡片' :
                       mtaSubCategory === 'recipes' ? '在详情页识别到做菜视频后，可一键生成步骤教程' :
                       mtaSubCategory === 'planning' ? '在详情页识别到旅游视频后，可一键生成行程攻略' :
                       mtaSubCategory === 'research' ? '在详情页识别到知识视频后，可一键生成深度研究' : '在详情页识别视频后可生成卡片'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                    {mtaList.map((item) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="card p-4 sm:p-6 hover:border-text-secondary transition-all cursor-pointer group"
                        onClick={() => handleOpenMtaDetail(item)}
                      >
                        {item.coverUrl && (
                          <div className="mb-3 overflow-hidden rounded-md">
                            <img
                              src={item.coverUrl}
                              alt={item.dishName}
                              className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                        )}
                        <h3 className="text-[15px] sm:text-[16px] font-bold text-text-primary mb-1">{item.dishName}</h3>
                        {item.videoTitle && (
                          <p className="text-[12px] text-text-secondary mb-2 line-clamp-1">{item.videoTitle}</p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-text-secondary">{item.steps.length} 个步骤</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMtaDelete(item.id); }}
                            className="text-[12px] text-text-secondary hover:text-red-500 transition-colors"
                          >
                            删除
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 视频详情弹窗 */}
      <AnimatePresence>
        {detailVideo && (
          <motion.div
            key="detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setDetailVideo(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface rounded-2xl shadow-2xl max-w-[700px] w-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 视频/封面区域 */}
              <div className="relative aspect-[16/10] overflow-hidden rounded-t-2xl bg-black">
                {detailVideo.hasVideo ? (
                  <VideoPlayer videoId={detailVideo.id} coverUrl={detailVideo.coverUrl} />
                ) : detailVideo.coverUrl ? (
                  <img
                    src={detailVideo.coverUrl}
                    alt={detailVideo.title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/40">
                    <Play size={48} />
                  </div>
                )}
                <button
                  onClick={() => setDetailVideo(null)}
                  className="absolute top-4 right-4 w-8 h-8 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                >
                  <X size={18} />
                </button>
                {detailVideo.duration != null && (
                  <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-white text-[11px] font-medium">
                    {formatDuration(detailVideo.duration)}
                  </div>
                )}
              </div>

              <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
                {!detailVideo.coverUrl && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setDetailVideo(null)}
                      className="w-8 h-8 bg-border-subtle rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  <h2 className="text-[20px] sm:text-[24px] font-bold text-text-primary leading-tight">
                    {detailVideo.title || '无标题视频'}
                  </h2>
                  <div className="flex items-center gap-2 text-[14px] text-text-secondary">
                    {detailVideo.authorName && detailVideo.authorName !== '未知作者' && <span>{detailVideo.authorName}</span>}
                    {detailVideo.authorName && detailVideo.authorName !== '未知作者' && <span>·</span>}
                    <span>{formatTimeAgo(detailVideo.createdAt)}</span>
                  </div>
                </div>

                {detailVideo.aiSummary ? (
                  <div className="space-y-2">
                    <h3 className="text-[14px] font-bold text-text-primary">AI 摘要</h3>
                    <p className="text-[14px] text-text-secondary leading-relaxed">
                      {detailVideo.aiSummary}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <h3 className="text-[14px] font-bold text-text-primary">AI 摘要</h3>
                    <p className="text-[14px] text-text-secondary/60 italic">
                      AI 摘要生成中，请稍后刷新查看...
                    </p>
                  </div>
                )}

                {detailVideo.tags && detailVideo.tags.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[14px] font-bold text-text-primary">标签</h3>
                    <div className="flex flex-wrap gap-2">
                      {detailVideo.tags.map((tag: string, idx: number) => (
                        <span
                          key={`${tag}-${idx}`}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-surface-container border border-border-subtle rounded-full text-[12px] font-medium text-text-secondary"
                        >
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Q&A 聊天区域 */}
                <div className="space-y-3">
                  <h3 className="text-[14px] font-bold text-text-primary flex items-center gap-2">
                    <MessageCircle size={16} />
                    向 AI 提问
                  </h3>
                  <div className="bg-surface-container border border-border-subtle rounded-xl p-3 sm:p-4 space-y-3 max-h-[200px] sm:max-h-[280px] overflow-y-auto">
                    {chatMessages.length === 0 && (
                      <p className="text-[13px] text-text-secondary text-center py-4">
                        对视频内容有疑问？在此输入问题，AI 将基于视频信息回答
                      </p>
                    )}
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] sm:max-w-[80%] px-3 sm:px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-accent text-white rounded-br-md'
                            : 'bg-white border border-border-subtle text-text-primary rounded-bl-md'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white border border-border-subtle px-4 py-2.5 rounded-2xl rounded-bl-md text-[13px] text-text-secondary flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          <span>正在分析视频内容，可能需要较长时间...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleSendQuestion(); }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="输入你的问题..."
                      disabled={chatLoading}
                      className="flex-grow px-4 py-2.5 bg-surface-container border border-border-subtle rounded-xl text-[14px] text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50 transition-all"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      className="px-4 py-2.5 bg-accent text-white rounded-xl text-[14px] font-medium hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                    >
                      <Send size={14} />
                    </button>
                  </form>
                </div>

                {detailVideo.description && (
                  <div className="space-y-2">
                    <h3 className="text-[14px] font-bold text-text-primary">原始描述</h3>
                    <p className="text-[14px] text-text-secondary leading-relaxed">
                      {detailVideo.description}
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-3 sm:pt-4 border-t border-border-subtle">
                  {/* 一键做同款按钮 */}
                  {isCooking && (
                    <button
                      onClick={handleStartCooking}
                      disabled={mtaLoading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#1A1A1A] text-white text-[14px] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
                    >
                      {mtaLoading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          正在生成菜谱...
                        </>
                      ) : (
                        <>
                          <ChefHat size={16} />
                          一键做同款
                        </>
                      )}
                    </button>
                  )}
                  {isTraining && detailVideo?.id && !showMtaPage && (
                    <button
                      onClick={() => { handleStartTraining(); }}
                      disabled={mtaTrainingLoading}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {mtaTrainingLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          正在生成训练...
                        </span>
                      ) : (
                        <>
                          <Dumbbell size={16} />
                          一键跟练
                        </>
                      )}
                    </button>
                  )}
                  {isPlanning && detailVideo?.id && !showMtaPage && (
                    <button
                      onClick={() => { handleStartPlanning(); }}
                      disabled={mtaPlanningLoading}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {mtaPlanningLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          正在生成攻略...
                        </span>
                      ) : (
                        <>
                          <MapPin size={16} />
                          一键做同款攻略
                        </>
                      )}
                    </button>
                  )}
                  {detailVideo?.id && (
                    <button
                      onClick={() => { handleOpenResearch(); }}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 active:bg-violet-800 transition-colors text-sm font-medium"
                    >
                      <Search size={16} />
                      深度研究
                    </button>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between">
                    <a
                      href={detailVideo.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center sm:justify-start gap-2 text-[14px] font-medium text-text-primary hover:text-black transition-colors"
                    >
                      <ExternalLink size={16} />
                      在抖音中查看
                    </a>
                    <button
                      onClick={handleDeleteVideo}
                      className="inline-flex items-center justify-center sm:justify-start gap-2 text-[14px] font-medium text-red-500 hover:text-red-700 transition-colors"
                    >
                      <Trash2 size={16} />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MTA 做菜教程页面 */}
      <AnimatePresence>
        {showMtaPage && mtaRecipe && (
          <MtaPage
            recipe={mtaRecipe}
            coverUrl={detailVideo?.coverUrl || undefined}
            onBack={() => { setShowMtaPage(false); setMtaRecipe(null); }}
          />
        )}
      </AnimatePresence>

      {/* MTA Training 健身跟练页面 */}
      <AnimatePresence>
        {showMtaPage && mtaTraining && (
          <TrainingPage
            plan={mtaTraining}
            coverUrl={detailVideo?.coverUrl || undefined}
            onBack={() => { setShowMtaPage(false); setMtaTraining(null); }}
          />
        )}
      </AnimatePresence>

      {/* MTA Planning 旅游攻略页面 */}
      <AnimatePresence>
        {showMtaPage && mtaPlanning && (
          <PlanningPage
            plan={mtaPlanning}
            coverUrl={detailVideo?.coverUrl || undefined}
            onBack={() => { setShowMtaPage(false); setMtaPlanning(null); }}
          />
        )}
      </AnimatePresence>

      {/* MTA Deep Research 深度研究页面 */}
      <AnimatePresence>
        {showResearchPage && detailVideo && (
          <DeepResearchPage
            video={detailVideo}
            docs={researchDocs}
            onClose={() => {
              setShowResearchPage(false);
              setResearchTopic('');
              setResearchContent('');
              setActiveResearchDoc(null);
              if (researchFromMta) {
                setShowMtaPage(true);
                loadMtaList('research');
              }
            }}
            onDocsChange={loadResearchDocs}
            workspaceId="ws_default"
          />
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
