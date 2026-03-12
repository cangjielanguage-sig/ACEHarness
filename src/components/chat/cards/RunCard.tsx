'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

interface RunCardProps {
  run: { id: string; configFile?: string; configName?: string; status: string; startTime: string; currentPhase?: string; completedSteps?: number; totalSteps?: number };
  onAction?: (prompt: string) => void;
}

export default function RunCard({ run: initialRun, onAction }: RunCardProps) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);

  // Live polling for running status
  useEffect(() => {
    if (initialRun.status !== 'running') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(initialRun.id)}/detail`);
        if (res.ok) {
          const data = await res.json();
          if (data.run) setRun(prev => ({ ...prev, ...data.run }));
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(id);
  }, [initialRun.id, initialRun.status]);

  const statusConfig: Record<string, { color: string; dot: string; label: string }> = {
    running: { color: 'text-blue-500', dot: 'bg-blue-500 animate-pulse', label: '运行中' },
    completed: { color: 'text-green-500', dot: 'bg-green-500', label: '已完成' },
    failed: { color: 'text-red-500', dot: 'bg-red-500', label: '失败' },
    stopped: { color: 'text-gray-500', dot: 'bg-gray-500', label: '已停止' },
    crashed: { color: 'text-orange-500', dot: 'bg-orange-500', label: '崩溃' },
  };
  const sc = statusConfig[run.status] || statusConfig.stopped;

  const progress = run.totalSteps ? Math.round(((run.completedSteps || 0) / run.totalSteps) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="group relative p-3 rounded-lg border bg-background hover:border-green-500/50 transition-colors cursor-pointer overflow-hidden"
      onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile || '')}?mode=history&runId=${run.id}`)}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
            <span className="font-medium text-sm truncate">{run.configName || run.configFile}</span>
          </div>
          <Badge variant={run.status === 'completed' ? 'default' : 'secondary'} className={`text-[10px] ${sc.color}`}>{sc.label}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
          {run.currentPhase && <span>{run.currentPhase}</span>}
          <span>{new Date(run.startTime).toLocaleString()}</span>
        </div>
        {run.totalSteps && run.totalSteps > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>{run.completedSteps || 0}/{run.totalSteps} 步骤</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
