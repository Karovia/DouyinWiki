import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import {
  X, ChevronLeft, ChevronRight, Clock, RotateCcw, Dumbbell,
  Plus, Minus, Timer, CheckCircle2, Play, Flame, Target, Zap,
  TrendingUp
} from 'lucide-react';

interface TrainingStep {
  step: number;
  title: string;
  description: string;
  sets?: number;
  reps?: number;
  timerSeconds?: number;
  timerLabel?: string;
  restSeconds?: number;
  restLabel?: string;
  side?: 'left' | 'right';
}

interface TrainingPlan {
  workoutName: string;
  targetMuscle: string;
  duration: string;
  difficulty: string;
  warmup: string[];
  steps: TrainingStep[];
  cooldown: string[];
}

interface TrainingPageProps {
  plan: TrainingPlan;
  coverUrl?: string;
  onBack: () => void;
}

/* ==================== Counter ==================== */
function Counter({
  target,
  onChange
}: {
  target: number;
  onChange?: (value: number) => void;
}) {
  const [count, setCount] = useState(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerDown = () => {
    longPressTimer.current = setTimeout(() => {
      setCount(0);
      onChange?.(0);
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClick = () => {
    const next = count + 1;
    setCount(next);
    onChange?.(next);
  };

  return (
    <motion.div
      className="flex items-center gap-3 bg-white rounded-xl border border-[#EAEAEA] px-4 py-2 shadow-sm"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      whileTap={{ scale: 0.95 }}
    >
      <button
        className="w-8 h-8 rounded-full bg-[#EAEAEA] flex items-center justify-center text-[#1A1A1A]"
        onClick={(e) => { e.stopPropagation(); setCount(Math.max(0, count - 1)); onChange?.(Math.max(0, count - 1)); }}
      >
        <Minus size={16} />
      </button>
      <div className="flex flex-col items-center min-w-[48px]">
        <span className="text-[20px] font-bold text-[#1A1A1A] tabular-nums">{count}</span>
        <span className="text-[10px] text-[#8C8C8C]">目标: {target}</span>
      </div>
      <button
        className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white"
        onClick={(e) => { e.stopPropagation(); handleClick(); }}
      >
        <Plus size={16} />
      </button>
    </motion.div>
  );
}

/* ==================== Floating Timer ==================== */
function FloatingTimer({
  seconds,
  label,
  onClose
}: {
  seconds: number;
  label?: string;
  onClose: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMoved = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const circumference = 2 * Math.PI * 28;
  const progress = 1 - timeLeft / seconds;
  const strokeDashoffset = circumference * progress;

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const toggleTimer = () => {
    if (isCompleted || isDragging) return;
    if (isRunning) {
      setIsRunning(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
    } else {
      setIsRunning(true);
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            setIsCompleted(true);
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };

  const resetTimer = () => {
    setIsRunning(false);
    setIsCompleted(false);
    setTimeLeft(seconds);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    hasMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!hasMoved.current) resetTimer();
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const dx = e.movementX;
    const dy = e.movementY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      hasMoved.current = true;
      setIsDragging(true);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      setPosition((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setTimeout(() => setIsDragging(false), 50);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      className="fixed bottom-6 right-4 z-[70] cursor-grab active:cursor-grabbing"
      style={{ x: position.x, y: position.y }}
      animate={{ x: position.x, y: position.y, scale: 1, opacity: 1 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      initial={{ scale: 0, opacity: 0 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <button
        onClick={toggleTimer}
        className={`relative w-20 h-20 rounded-full shadow-xl flex items-center justify-center ${
          isCompleted ? 'bg-green-500 text-white' : isRunning ? 'bg-[#1A1A1A] text-white' : 'bg-white text-[#1A1A1A]'
        }`}
      >
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="#EAEAEA" strokeWidth="3" />
          <circle
            cx="32" cy="32" r="28"
            fill="none"
            stroke={isCompleted ? '#22c55e' : '#1A1A1A'}
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <div className="flex flex-col items-center relative z-10">
          {isRunning ? (
            <Timer size={16} />
          ) : isCompleted ? (
            <CheckCircle2 size={16} />
          ) : (
            <Play size={16} />
          )}
          <span className="text-[11px] font-semibold mt-0.5 tabular-nums">
            {formatTime(timeLeft)}
          </span>
        </div>
      </button>
      {label && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-[#8C8C8C] whitespace-nowrap bg-white px-2 py-0.5 rounded-full border border-[#EAEAEA]">
          {label}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute -top-1 -left-1 w-5 h-5 bg-[#8C8C8C] text-white rounded-full flex items-center justify-center text-[10px]"
      >
        <X size={10} />
      </button>
    </motion.div>
  );
}

/* ==================== Overview Card ==================== */
function OverviewCard({
  plan,
  coverUrl
}: {
  plan: TrainingPlan;
  coverUrl?: string;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 封面图 */}
      {coverUrl && (
        <div className="w-full h-36 sm:h-44 rounded-xl overflow-hidden mb-4 flex-shrink-0">
          <img
            src={coverUrl}
            alt={plan.workoutName}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* 标题 */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#1A1A1A] flex items-center justify-center flex-shrink-0">
          <Dumbbell size={18} className="text-white" />
        </div>
        <div>
          <h2 className="text-[20px] sm:text-[24px] font-semibold text-[#1A1A1A]">{plan.workoutName}</h2>
          <p className="text-[13px] text-[#8C8C8C]">{plan.duration} · {plan.difficulty}</p>
        </div>
      </div>

      {/* 概览信息 */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA]">
            <Target size={14} className="text-[#8C8C8C]" />
            <span className="text-[13px] text-[#1A1A1A]">{plan.targetMuscle}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA]">
            <Flame size={14} className="text-[#8C8C8C]" />
            <span className="text-[13px] text-[#1A1A1A]">{plan.difficulty}</span>
          </div>
        </div>

        {/* 热身概览 */}
        {plan.warmup.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-[#8C8C8C]" />
              <span className="text-[13px] font-semibold text-[#1A1A1A]">热身准备</span>
              <span className="text-[11px] text-[#8C8C8C]">({plan.warmup.length} 项)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.warmup.map((item, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded-full bg-[#FAFAFA] border border-[#EAEAEA] text-[#8C8C8C]">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 训练步骤概览 */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-[#8C8C8C]" />
            <span className="text-[13px] font-semibold text-[#1A1A1A]">训练内容</span>
            <span className="text-[11px] text-[#8C8C8C]">({plan.steps.length} 个动作)</span>
          </div>
          <div className="space-y-1.5">
            {plan.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] text-[#8C8C8C]">
                <span className="w-5 h-5 rounded-full bg-[#EAEAEA] flex items-center justify-center text-[10px] font-bold text-[#1A1A1A] flex-shrink-0">
                  {i + 1}
                </span>
                <span className="truncate">{step.title}</span>
                {step.sets && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAFAFA] border border-[#EAEAEA]">{step.sets}组</span>}
                {step.reps && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FAFAFA] border border-[#EAEAEA]">{step.reps}次</span>}
              </div>
            ))}
          </div>
        </div>

        {/* 拉伸概览 */}
        {plan.cooldown.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <RotateCcw size={14} className="text-[#8C8C8C]" />
              <span className="text-[13px] font-semibold text-[#1A1A1A]">拉伸放松</span>
              <span className="text-[11px] text-[#8C8C8C]">({plan.cooldown.length} 项)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.cooldown.map((item, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded-full bg-[#FAFAFA] border border-[#EAEAEA] text-[#8C8C8C]">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== Warmup / Cooldown Card ==================== */
function ListCard({
  title,
  items,
  icon
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        {icon}
        <h3 className="text-[20px] font-bold text-[#1A1A1A]">{title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        <div className="space-y-2 pb-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-3 py-3 rounded-xl bg-[#FAFAFA] border border-[#EAEAEA]"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1A1A1A] flex items-center justify-center text-[12px] font-bold text-white mt-0.5">
                {i + 1}
              </span>
              <span className="text-[14px] text-[#1A1A1A] leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==================== Step Card ==================== */
function StepCard({
  step,
  total,
}: {
  step: TrainingStep;
  total: number;
}) {
  const [count, setCount] = useState(0);
  const [showTimer, setShowTimer] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-[13px] font-semibold text-[#8C8C8C]">
          第 {step.step} 步 / 共 {total} 步
        </span>
        {step.side && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EAEAEA] text-[#8C8C8C]">
            {step.side === 'left' ? '左侧' : '右侧'}
          </span>
        )}
      </div>

      <h3 className="text-[22px] font-bold text-[#1A1A1A] mb-2">{step.title}</h3>

      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        <p className="text-[15px] text-[#8C8C8C] leading-relaxed mb-4">
          {step.description}
        </p>

        {/* Sets/Reps info */}
        {(step.sets || step.reps) && (
          <div className="flex items-center gap-4 mb-4">
            {step.sets && (
              <div className="flex items-center gap-1.5 text-[13px] text-[#8C8C8C]">
                <RotateCcw size={14} />
                <span>{step.sets} 组</span>
              </div>
            )}
            {step.reps && (
              <div className="flex items-center gap-1.5 text-[13px] text-[#8C8C8C]">
                <Dumbbell size={14} />
                <span>{step.reps} 次/组</span>
              </div>
            )}
          </div>
        )}

        {/* Counter for reps */}
        {step.reps && (
          <div className="mb-4">
            <Counter target={step.reps} onChange={setCount} />
          </div>
        )}

        {/* Timer trigger */}
        {step.timerSeconds && step.timerSeconds > 0 && (
          <motion.button
            onClick={() => setShowTimer(true)}
            className="flex items-center gap-2 bg-[#1A1A1A] text-white px-4 py-2.5 rounded-xl text-[14px] font-medium"
            whileTap={{ scale: 0.95 }}
          >
            <Clock size={16} />
            {step.timerLabel || '开始计时'}
            <span className="text-white/60">({Math.floor(step.timerSeconds / 60)}:{(step.timerSeconds % 60).toString().padStart(2, '0')})</span>
          </motion.button>
        )}
      </div>

      {/* Timer overlay */}
      <AnimatePresence>
        {showTimer && step.timerSeconds && (
          <FloatingTimer
            seconds={step.timerSeconds}
            label={step.timerLabel}
            onClose={() => setShowTimer(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ==================== Training Page ==================== */
export default function TrainingPage({ plan, coverUrl, onBack }: TrainingPageProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);

  // 卡片顺序: 0=概览, 1=热身, 2..n+1=训练步骤, n+2=拉伸放松
  const totalCards = 1 + 1 + plan.steps.length + 1;

  const goNext = useCallback(() => {
    if (currentStep < totalCards - 1) {
      setDirection(1);
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, totalCards]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

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
          <Dumbbell size={16} className="text-[#8C8C8C]" />
          <span className="text-[14px] font-medium text-[#1A1A1A]">MTA Training 健身</span>
        </div>
        <div className="w-16" />
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
              {currentStep === 0 && (
                <OverviewCard plan={plan} coverUrl={coverUrl} />
              )}
              {currentStep === 1 && (
                <ListCard
                  title="热身准备"
                  items={plan.warmup}
                  icon={<Zap size={20} className="text-[#8C8C8C]" />}
                />
              )}
              {currentStep >= 2 && currentStep < totalCards - 1 && (
                <StepCard
                  step={plan.steps[currentStep - 2]}
                  total={plan.steps.length}
                />
              )}
              {currentStep === totalCards - 1 && (
                <ListCard
                  title="拉伸放松"
                  items={plan.cooldown}
                  icon={<RotateCcw size={20} className="text-[#8C8C8C]" />}
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
          {currentStep === 0 ? '概览' : currentStep === 1 ? '热身' : currentStep === totalCards - 1 ? '拉伸' : `步骤 ${currentStep - 1}/${plan.steps.length}`}
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
    </div>
  );
}
