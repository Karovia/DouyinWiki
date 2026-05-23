import { motion } from 'motion/react';
import { TaskStatus } from '../types';

interface ProcessingCardProps {
  task: TaskStatus;
}

export default function ProcessingCard({ task }: ProcessingCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card w-full max-w-[700px] p-8 mx-auto mt-12"
    >
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-1">
          <span className="text-[12px] text-text-secondary font-medium tracking-wider">Task ID</span>
          <p className="text-[18px] font-bold text-text-primary">#{task.id}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-surface border border-border-subtle rounded-full cursor-default">
          <div className={`w-2 h-2 rounded-full ${task.status === 'processing' ? 'bg-orange-400 animate-pulse' : 'bg-green-500'}`} />
          <span className="text-[12px] font-medium text-text-primary capitalize">{task.status}</span>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-center text-[14px]">
          <span className="text-text-primary font-medium">{task.message}</span>
          <span className="text-text-secondary font-bold">{task.progress}%</span>
        </div>
        
        <div className="h-2 w-full bg-border-subtle rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-text-primary"
            initial={{ width: 0 }}
            animate={{ width: `${task.progress}%` }}
            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
          />
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-border-subtle">
        <p className="text-[13px] text-text-secondary">解析完成后自动保存到 Wiki 列表</p>
      </div>
    </motion.div>
  );
}
