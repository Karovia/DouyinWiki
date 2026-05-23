/**
 * MTA (More Than Asking) 页面 — 做菜教程卡片
 * 每步一个卡片，右滑下一步，左滑上一步
 * 有计时需求的步骤显示悬浮计时器（可拖拽）
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import { ChevronLeft, ChevronRight, Timer, Clock, X, ChefHat, Utensils } from 'lucide-react';
import type { CookingRecipe, CookingStep } from '../trpc';

interface MtaPageProps {
  recipe: CookingRecipe;
  coverUrl?: string;
  onBack: () => void;
}

// ─── 可拖拽悬浮计时器组件 ───

interface FloatingTimerProps {
  seconds: number;
  label: string | null;
  onDismiss: () => void;
}

function FloatingTimer({ seconds, label, onDismiss }: FloatingTimerProps) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);

  // 拖拽状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0, px: 0, py: 0 });

  useEffect(() => {
    setRemaining(seconds);
    setRunning(false);
    setFinished(false);
    setPosition({ x: 0, y: 0 });
  }, [seconds]);

  useEffect(() => {
    if (!running || remaining <= 0) return;

    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          setRunning(false);
          setFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [running, remaining]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // 拖拽处理
  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDragging.current = false;
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      px: position.x,
      py: position.y,
    };

    // 长按计时器
    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true);
      setRemaining(seconds);
      setRunning(false);
      setFinished(false);
      setTimeout(() => setIsLongPressing(false), 300);
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressTimer.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }

    if (e.buttons === 1) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDragging.current = true;
      }
      if (isDragging.current) {
        setPosition({
          x: dragStartPos.current.px + dx,
          y: dragStartPos.current.py + dy,
        });
      }
    }
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // 如果没有拖拽（只是短按），触发计时器
    if (!isDragging.current) {
      if (finished) {
        setRemaining(seconds);
        setFinished(false);
      } else {
        setRunning(prev => !prev);
      }
    }
    isDragging.current = false;
  };

  const progress = 1 - remaining / seconds;
  const circumference = 2 * Math.PI * 22;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.9 }}
      animate={{
        opacity: 1,
        y: position.y,
        scale: isLongPressing ? 0.92 : 1,
        x: position.x,
      }}
      exit={{ opacity: 0, y: 40, scale: 0.9 }}
      className="fixed bottom-6 right-4 sm:bottom-8 sm:right-6 z-50 flex items-center gap-3 touch-none"
    >
      {/* 计时器主体 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`
          relative flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg cursor-pointer select-none
          transition-colors duration-300
          ${finished
            ? 'bg-green-500 text-white'
            : running
              ? 'bg-[#1A1A1A] text-white'
              : 'bg-white text-[#1A1A1A] border border-[#EAEAEA]'
          }
        `}
      >
        {/* 圆形进度条 */}
        <div className="relative w-12 h-12 flex-shrink-0">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
            <circle
              cx="24" cy="24" r="22"
              fill="none"
              stroke={finished ? 'rgba(255,255,255,0.3)' : running ? 'rgba(255,255,255,0.2)' : '#EAEAEA'}
              strokeWidth="3"
            />
            <circle
              cx="24" cy="24" r="22"
              fill="none"
              stroke={finished ? '#fff' : running ? '#4ADE80' : '#1A1A1A'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {finished ? (
              <span className="text-[10px] font-bold">完成</span>
            ) : (
              <Timer size={16} className={running ? 'text-green-400' : ''} />
            )}
          </div>
        </div>

        {/* 计时信息 */}
        <div className="flex flex-col">
          <span className={`text-[20px] font-semibold tracking-wide ${finished ? 'text-white' : ''}`}>
            {formatTime(remaining)}
          </span>
          {label && (
            <span className={`text-[11px] ${finished ? 'text-white/80' : 'text-[#8C8C8C]'}`}>
              {label}
            </span>
          )}
          <span className={`text-[10px] mt-0.5 ${finished ? 'text-white/60' : 'text-[#8C8C8C]'}`}>
            {finished ? '点击重置' : running ? '长按重置' : '点击开始'}
          </span>
        </div>
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={onDismiss}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/80 text-[#8C8C8C] hover:text-[#1A1A1A] shadow transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

// ─── 食材卡片 ───

function IngredientsCard({
  dishName,
  servings,
  ingredients,
  coverUrl,
}: {
  dishName: string;
  servings: string;
  ingredients: string[];
  coverUrl?: string;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 封面图 */}
      {coverUrl && (
        <div className="w-full h-36 sm:h-44 rounded-xl overflow-hidden mb-4 flex-shrink-0">
          <img
            src={coverUrl}
            alt={dishName}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* 标题 */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0">
          <ChefHat size={18} className="text-white" />
        </div>
        <div>
          <h2 className="text-[20px] sm:text-[24px] font-semibold text-[#1A1A1A]">{dishName}</h2>
          <p className="text-[13px] text-[#8C8C8C]">{servings}</p>
        </div>
      </div>

      {/* 食材列表 - 可滚动 */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        <div className="flex items-center gap-2 mb-3 sticky top-0 bg-white z-10 py-1">
          <div className="h-px flex-1 bg-[#EAEAEA]" />
          <span className="text-[12px] text-[#8C8C8C] whitespace-nowrap">
            共 {ingredients.length} 项食材
          </span>
          <div className="h-px flex-1 bg-[#EAEAEA]" />
        </div>

        <div className="grid grid-cols-1 gap-2 pb-2">
          {ingredients.map((ing, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA]"
            >
              <div className="w-6 h-6 rounded-full bg-[#1A1A1A] flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-semibold text-white">{idx + 1}</span>
              </div>
              <span className="text-[14px] text-[#1A1A1A]">{ing}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 步骤卡片 ───

function StepCard({
  step,
  totalSteps,
  ingredients,
}: {
  step: CookingStep;
  totalSteps: number;
  ingredients: string[];
}) {
  const hasTimer = step.timerSeconds && step.timerSeconds > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 步骤头部 */}
      <div className="flex items-center justify-between mb-3 sm:mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[#1A1A1A] flex items-center justify-center">
            <span className="text-[13px] font-semibold text-white">{step.step}</span>
          </div>
          <span className="text-[12px] text-[#8C8C8C]">/ {totalSteps} 步</span>
        </div>
        {hasTimer && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 text-orange-600">
            <Clock size={13} />
            <span className="text-[12px] font-medium">{Math.floor(step.timerSeconds! / 60)}:{(step.timerSeconds! % 60).toString().padStart(2, '0')}</span>
          </div>
        )}
      </div>

      {/* 步骤标题 */}
      <h3 className="text-[20px] sm:text-[24px] font-semibold text-[#1A1A1A] mb-2 sm:mb-3 flex-shrink-0">
        {step.title}
      </h3>

      {/* 步骤描述 - 可滚动 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <p className="text-[14px] sm:text-[15px] text-[#4A4A4A] leading-relaxed sm:leading-loose">
          {step.description}
        </p>

        {/* 如果步骤提到了食材，显示食材参考 */}
        {step.step === 1 && ingredients.length > 0 && (
          <div className="mt-4 sm:mt-6 pt-4 border-t border-[#EAEAEA]">
            <p className="text-[12px] text-[#8C8C8C] mb-2">所需食材</p>
            <div className="flex flex-wrap gap-2">
              {ingredients.slice(0, 6).map((ing, idx) => (
                <span key={idx} className="px-2 py-1 rounded-lg bg-[#FAFAFA] text-[12px] text-[#4A4A4A] border border-[#EAEAEA]">
                  {ing}
                </span>
              ))}
              {ingredients.length > 6 && (
                <span className="px-2 py-1 rounded-lg bg-[#FAFAFA] text-[12px] text-[#8C8C8C]">
                  +{ingredients.length - 6}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 计时器提示 */}
      {hasTimer && (
        <div className="mt-4 sm:mt-6 flex-shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-orange-50/70 border border-orange-100">
          <Timer size={16} className="text-orange-500 flex-shrink-0" />
          <span className="text-[13px] text-orange-700">
            此步骤需要计时：{step.timerLabel || `${Math.floor(step.timerSeconds! / 60)}分${step.timerSeconds! % 60 > 0 ? step.timerSeconds! % 60 + '秒' : '钟'}`}
          </span>
        </div>
      )}

      {/* 导航提示 */}
      <div className="mt-3 sm:mt-4 flex-shrink-0 text-center">
        <p className="text-[12px] text-[#8C8C8C]">
          {step.step < totalSteps ? '← 左滑上一步 | 右滑下一步 →' : '← 左滑上一步 | 已是最后一步'}
        </p>
      </div>
    </div>
  );
}

// ─── MTA 主页面 ───

export default function MtaPage({ recipe, coverUrl, onBack }: MtaPageProps) {
  const [currentStep, setCurrentStep] = useState(0); // 0 = 食材卡, 1..N = 步骤卡
  const [activeTimer, setActiveTimer] = useState<CookingStep | null>(null);
  const [direction, setDirection] = useState(1);
  // 手动关闭计时器的步骤记录（避免切回时再次弹出）
  const dismissedSteps = useRef<Set<number>>(new Set());

  const totalCards = recipe.steps.length + 1; // +1 for ingredients card

  const goNext = useCallback(() => {
    if (currentStep < totalCards - 1) {
      setDirection(1);
      setCurrentStep(prev => prev + 1);
    }
  }, [currentStep, totalCards]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // 步骤切换时管理计时器：
  // - 进入有计时步骤且未手动关闭过 → 显示计时器
  // - 离开计时步骤 → 自动隐藏
  // - 食材页 → 隐藏计时器
  useEffect(() => {
    if (currentStep === 0) {
      setActiveTimer(null);
      return;
    }
    const step = recipe.steps[currentStep - 1];
    if (step?.timerSeconds && step.timerSeconds > 0 && !dismissedSteps.current.has(step.step)) {
      setActiveTimer(step);
    } else {
      setActiveTimer(null);
    }
  }, [currentStep, recipe.steps]);

  const handleDismissTimer = () => {
    if (activeTimer) {
      dismissedSteps.current.add(activeTimer.step);
    }
    setActiveTimer(null);
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 50;
    if (info.offset.x > threshold) {
      goPrev();
    } else if (info.offset.x < -threshold) {
      goNext();
    }
  };

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -300 : 300,
      opacity: 0,
    }),
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#EAEAEA]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[14px] text-[#8C8C8C] hover:text-[#1A1A1A] transition-colors"
        >
          <ChevronLeft size={18} />
          返回详情
        </button>
        <div className="flex items-center gap-2">
          <Utensils size={16} className="text-[#8C8C8C]" />
          <span className="text-[14px] font-medium text-[#1A1A1A]">MTA Recipes 烹饪</span>
        </div>
        <div className="w-16" /> {/* 占位对齐 */}
      </div>

      {/* 进度条 */}
      <div className="px-4 sm:px-6 pt-3 sm:pt-4">
        <div className="flex gap-1">
          {Array.from({ length: totalCards }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= currentStep ? 'bg-[#1A1A1A]' : 'bg-[#EAEAEA]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 卡片区域 */}
      <div className="flex-1 overflow-hidden px-4 sm:px-6 py-4 sm:py-6 min-h-0">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentStep}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 30 },
              opacity: { duration: 0.2 },
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.1}
            onDragEnd={handleDragEnd}
            className="h-full cursor-grab active:cursor-grabbing"
          >
            <div className="h-full max-w-lg mx-auto bg-white rounded-2xl border border-[#EAEAEA] p-5 sm:p-8 shadow-sm overflow-hidden flex flex-col">
              {currentStep === 0 ? (
                <IngredientsCard
                  dishName={recipe.dishName}
                  servings={recipe.servings}
                  ingredients={recipe.ingredients}
                  coverUrl={coverUrl}
                />
              ) : (
                <StepCard
                  step={recipe.steps[currentStep - 1]}
                  totalSteps={recipe.steps.length}
                  ingredients={recipe.ingredients}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 底部导航按钮 */}
      <div className="flex items-center justify-between px-4 sm:px-6 pb-6 sm:pb-8 pt-2">
        <button
          onClick={goPrev}
          disabled={currentStep === 0}
          className={`flex items-center gap-1 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
            currentStep === 0
              ? 'text-[#D0D0D0] cursor-not-allowed'
              : 'text-[#1A1A1A] hover:bg-[#FAFAFA] border border-[#EAEAEA]'
          }`}
        >
          <ChevronLeft size={16} />
          上一步
        </button>

        <span className="text-[13px] text-[#8C8C8C]">
          {currentStep === 0 ? '食材' : `步骤 ${currentStep}/${recipe.steps.length}`}
        </span>

        <button
          onClick={goNext}
          disabled={currentStep === totalCards - 1}
          className={`flex items-center gap-1 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
            currentStep === totalCards - 1
              ? 'text-[#D0D0D0] cursor-not-allowed'
              : 'text-white bg-[#1A1A1A] hover:bg-[#333]'
          }`}
        >
          下一步
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 悬浮计时器 — 只在当前步骤有计时需求时显示 */}
      <AnimatePresence>
        {activeTimer && activeTimer.timerSeconds !== null && (
          <FloatingTimer
            key={activeTimer.step}
            seconds={activeTimer.timerSeconds}
            label={activeTimer.timerLabel}
            onDismiss={handleDismissTimer}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
