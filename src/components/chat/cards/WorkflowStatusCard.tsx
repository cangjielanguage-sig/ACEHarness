'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import FollowUpSuggestions from './FollowUpSuggestions';

interface WorkflowStatusCardProps {
  initialStatus: { status: string; currentConfigFile?: string; currentPhase?: string; currentStep?: string; completedSteps?: string[]; runId?: string };
  onAction?: (prompt: string) => void;
}

export default function WorkflowStatusCard({ initialStatus, onAction }: WorkflowStatusCardProps) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (initialStatus.status !== 'running') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/workflow/status');
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(id);
  }, [initialStatus.status]);

  const isRunning = status.status === 'running';
  const statusColors: Record<string, string> = {
    running: 'bg-blue-500',
    idle: 'bg-gray-400',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    stopped: 'bg-yellow-500',
    pending_approval: 'bg-amber-500 animate-pulse',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-lg border bg-background overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status.status] || 'bg-gray-400'} ${isRunning ? 'animate-pulse' : ''}`} />
          <span className="font-medium text-sm">工作流状态</span>
        </div>
        <Badge variant={isRunning ? 'default' : 'secondary'}>{status.status}</Badge>
      </div>

      <div className="space-y-1.5 text-xs">
        {status.currentConfigFile && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">配置:</span>
            <span>{status.currentConfigFile}</span>
          </div>
        )}
        {status.currentPhase && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">阶段:</span>
            <span>{status.currentPhase}</span>
          </div>
        )}
        {status.currentStep && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">步骤:</span>
            <span>{status.currentStep}</span>
          </div>
        )}
      </div>

      {(isRunning || status.status === 'pending_approval') && (
        <div className="flex gap-2 mt-3 pt-2 border-t">
          {isRunning && (
            <Button size="sm" variant="destructive" className="text-xs h-7 gap-1" onClick={() => onAction?.('停止当前工作流')}>
              <span className="material-symbols-outlined text-xs">stop</span>
              停止
            </Button>
          )}
          {status.status === 'pending_approval' && (
            <Button size="sm" className="text-xs h-7 gap-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white" onClick={() => onAction?.('批准当前检查点')}>
              <span className="material-symbols-outlined text-xs">check</span>
              批准
            </Button>
          )}
        </div>
      )}

      <FollowUpSuggestions
        suggestions={[
          ...(isRunning ? [{ label: '查看运行日志', prompt: `查看运行 ${status.runId || ''} 的详细日志`, icon: 'article' }] : []),
          ...(status.status === 'idle' ? [{ label: '启动工作流', prompt: '帮我启动一个工作流', icon: 'play_arrow' }] : []),
          ...(status.status === 'completed' || status.status === 'failed' ? [{ label: '查看运行记录', prompt: `查看 ${status.currentConfigFile || ''} 的运行记录`, icon: 'history' }] : []),
          { label: '查看配置列表', prompt: '列出所有工作流配置', icon: 'list' },
        ]}
        onAction={onAction}
      />
    </motion.div>
  );
}
