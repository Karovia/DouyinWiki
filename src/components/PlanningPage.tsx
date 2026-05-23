import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { MapPin, Clock, Wallet, Compass, Lightbulb, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { TravelPlan, PlanningStep } from '../trpc';

const SWIPE_THRESHOLD = 60;

function useLocalStoragePage(planName: string) {
  const key = `planning_page_${planName}`;

  const getSavedPage = useCallback(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  }, [key]);

  const savePage = useCallback((index: number) => {
    try {
      localStorage.setItem(key, String(index));
    } catch {
      // ignore
    }
  }, [key]);

  return { getSavedPage, savePage };
}

function OverviewCard({ plan, onNext }: { plan: TravelPlan; onNext: () => void }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 封面图区域 */}
      <div className="relative h-40 sm:h-52 shrink-0 overflow-hidden rounded-b-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-100 to-orange-50 flex items-center justify-center">
          <MapPin size={48} className="text-amber-300" />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 bg-gradient-to-t from-black/60 to-transparent">
          <h2 className="text-xl sm:text-2xl font-bold text-white">{plan.planName}</h2>
          <p className="text-sm text-white/80 mt-1 flex items-center gap-1">
            <MapPin size={14} />
            {plan.destination}
          </p>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-5 space-y-4">
        {/* 基本信息 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-amber-50 rounded-xl p-3 text-center">
            <Clock size={18} className="mx-auto text-amber-600 mb-1" />
            <p className="text-[11px] text-text-secondary">天数</p>
            <p className="text-sm font-semibold text-text-primary">{plan.duration}</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 text-center">
            <Wallet size={18} className="mx-auto text-amber-600 mb-1" />
            <p className="text-[11px] text-text-secondary">预算</p>
            <p className="text-sm font-semibold text-text-primary">{plan.budgetLevel}</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 text-center">
            <Compass size={18} className="mx-auto text-amber-600 mb-1" />
            <p className="text-[11px] text-text-secondary">主题</p>
            <p className="text-sm font-semibold text-text-primary">{plan.theme}</p>
          </div>
        </div>

        {/* 概览 */}
        <div className="bg-white rounded-xl p-4 border border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-1.5">
            <Lightbulb size={15} className="text-amber-500" />
            行程概览
          </h3>
          <p className="text-[13px] text-text-secondary leading-relaxed">{plan.overview}</p>
        </div>

        {/* 天数预览 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <CalendarDays size={15} className="text-amber-500" />
            行程预览
          </h3>
          {plan.steps.map((step) => (
            <div key={step.day} className="flex items-center gap-3 bg-white rounded-lg p-3 border border-border-subtle">
              <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center shrink-0">
                D{step.day}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{step.title}</p>
                <p className="text-xs text-text-secondary truncate">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 通用建议 */}
        {plan.tips.length > 0 && (
          <div className="bg-amber-50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-2">旅行贴士</h3>
            <ul className="space-y-1.5">
              {plan.tips.map((tip, i) => (
                <li key={i} className="text-[12px] text-text-secondary flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="p-4 sm:p-5 border-t border-border-subtle shrink-0">
        <button
          onClick={onNext}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1A1A1A] text-white text-sm font-medium hover:bg-[#333] transition-colors"
        >
          开始行程
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function DayCard({ step, dayNumber, totalDays }: { step: PlanningStep; dayNumber: number; totalDays: number }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Day Header */}
      <div className="shrink-0 p-4 sm:p-5 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
            第 {dayNumber} / {totalDays} 天
          </span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold text-text-primary">{step.title}</h2>
        <p className="text-sm text-text-secondary mt-1">{step.description}</p>
      </div>

      {/* Timeline */}
      <div className="flex-1 p-4 sm:p-5 space-y-4">
        {step.schedule.map((item, idx) => (
          <div key={idx} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-14 h-7 rounded-full bg-[#1A1A1A] text-white text-[11px] font-semibold flex items-center justify-center">
                {item.time}
              </div>
              {idx < step.schedule.length - 1 && (
                <div className="w-px flex-1 bg-border-subtle my-1" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <p className="text-sm font-medium text-text-primary">{item.activity}</p>
              {item.note && (
                <p className="text-xs text-text-secondary mt-0.5">{item.note}</p>
              )}
            </div>
          </div>
        ))}

        {step.tips && (
          <div className="bg-amber-50 rounded-xl p-3 mt-2">
            <p className="text-xs font-medium text-amber-700 mb-1">当天贴士</p>
            <p className="text-xs text-text-secondary">{step.tips}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface PlanningPageProps {
  plan: TravelPlan;
  coverUrl?: string;
  onBack: () => void;
}

export default function PlanningPage({ plan, onBack }: PlanningPageProps) {
  const totalCards = 1 + plan.steps.length; // overview + days
  const { getSavedPage, savePage } = useLocalStoragePage(plan.planName);
  const [currentIndex, setCurrentIndex] = useState(() => getSavedPage());
  const [direction, setDirection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  useTransform(x, [-300, 0, 300], [25, 0, -25]);

  useEffect(() => {
    savePage(currentIndex);
  }, [currentIndex, savePage]);

  const goNext = useCallback(() => {
    if (currentIndex < totalCards - 1) {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, totalCards]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      goNext();
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      goPrev();
    }
  };

  const variants = {
    enter: (dir: number) => ({
      rotateX: dir > 0 ? 110 : -110,
      y: dir > 0 ? '30%' : '-30%',
      opacity: 0,
      scale: 0.9,
    }),
    center: {
      rotateX: 0,
      y: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir: number) => ({
      rotateX: dir > 0 ? -110 : 110,
      y: dir > 0 ? '-30%' : '30%',
      opacity: 0,
      scale: 0.9,
    }),
  };

  const renderCard = () => {
    if (currentIndex === 0) {
      return <OverviewCard plan={plan} onNext={goNext} />;
    }
    const step = plan.steps[currentIndex - 1];
    return <DayCard step={step} dayNumber={step.day} totalDays={plan.steps.length} />;
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
          <MapPin size={16} className="text-[#8C8C8C]" />
          <span className="text-[14px] font-medium text-[#1A1A1A]">MTA Planning 旅游规划</span>
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
                i <= currentIndex ? 'bg-[#1A1A1A]' : 'bg-[#EAEAEA]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 日历本体 */}
      <div className="flex-1 overflow-hidden px-4 sm:px-6 py-4 sm:py-6 min-h-0">
        <div className="h-full max-w-lg mx-auto bg-[#FDF8F0] rounded-2xl border border-[#E8E0D5] shadow-sm overflow-hidden flex flex-col">
          {/* 顶部装订线 */}
          <div className="shrink-0 bg-[#E8E0D5] px-4 py-2 flex items-center justify-between border-b border-[#D5CFC5]">
            <span className="text-sm font-bold text-[#1A1A1A]">旅行攻略</span>
            {currentIndex > 0 && (
              <div className="flex items-center gap-1.5">
                <CalendarDays size={14} className="text-amber-600" />
                <span className="text-sm font-bold text-amber-700">
                  Day {plan.steps[currentIndex - 1]?.day}
                </span>
              </div>
            )}
          </div>

          {/* 螺旋装订孔 */}
          <div className="shrink-0 bg-[#FDF8F0] px-4 py-1 flex items-center justify-center gap-4 border-b border-dashed border-[#D5CFC5]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-2.5 h-2.5 rounded-full bg-[#C4BCB0]" />
            ))}
          </div>

          {/* 卡片内容区 */}
          <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ perspective: 1200 }}>
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={currentIndex}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  rotateX: { type: 'spring', stiffness: 200, damping: 25 },
                  y: { type: 'spring', stiffness: 200, damping: 25 },
                  opacity: { duration: 0.25 },
                  scale: { type: 'spring', stiffness: 300, damping: 30 },
                }}
                style={{
                  transformOrigin: 'top center',
                  position: 'absolute',
                  inset: 0,
                }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.15}
                onDragEnd={handleDragEnd}
              >
                {renderCard()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 底部导航 */}
          <div className="shrink-0 p-3 sm:p-4 bg-[#FDF8F0] border-t border-[#E8E0D5]">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
                上一步
              </button>

              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalCards }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === currentIndex
                        ? 'w-6 bg-[#1A1A1A]'
                        : i < currentIndex
                          ? 'w-1.5 bg-[#1A1A1A]/40'
                          : 'w-1.5 bg-[#1A1A1A]/15'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={goNext}
                disabled={currentIndex === totalCards - 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                下一步
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
