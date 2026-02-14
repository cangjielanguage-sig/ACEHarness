'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';

interface ProcessInfo {
  id: string;
  agent: string;
  step: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  startTime: string;
  endTime?: string;
  output: string;
  error: string;
}

interface ProcessStats {
  total: number;
  running: number;
  queued: number;
  maxConcurrent: number;
  completed: number;
  failed: number;
}

export default function ProcessPanel({ onClose }: { onClose?: () => void }) {
  const { toast } = useToast();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<ProcessInfo | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadProcesses = async () => {
    try {
      const response = await fetch('/api/processes');
      const data = await response.json();
      setProcesses(data.processes);
      setStats(data.stats);
    } catch (error) {
      console.error('加载进程列表失败:', error);
    }
  };

  const killProcess = async (id: string) => {
    const ok = await confirm({
      title: '确认终止',
      description: '确定要终止这个进程吗？',
      confirmLabel: '终止',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      const response = await fetch(`/api/processes/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast('success', '进程已终止');
        loadProcesses();
      } else {
        const data = await response.json();
        toast('error', data.error || '终止失败');
      }
    } catch (error: any) {
      toast('error', '终止失败: ' + error.message);
    }
  };

  const killAll = async () => {
    const ok = await confirm({
      title: '确认终止全部',
      description: '确定要终止所有进程吗？',
      confirmLabel: '终止全部',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      const response = await fetch('/api/processes', {
        method: 'DELETE',
      });

      if (response.ok) {
        toast('success', '所有进程已终止');
        loadProcesses();
      } else {
        const data = await response.json();
        toast('error', data.error || '终止失败');
      }
    } catch (error: any) {
      toast('error', '终止失败: ' + error.message);
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'killed':
        return 'bg-orange-500';
      default:
        return '';
    }
  };
  const getStatusText = (status: string) => {
    const texts: Record<string, string> = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      killed: '已终止',
    };
    return texts[status] || status;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 p-4 border-b">
        <h3>进程管理</h3>
        {stats && (
          <div className="flex gap-4 text-sm">
            <span className="text-muted-foreground">
              运行: <strong>{stats.running}</strong>
            </span>
            <span className="text-muted-foreground">
              队列: <strong>{stats.queued}</strong>
            </span>
            <span className="text-muted-foreground">
              完成: <strong>{stats.completed}</strong>
            </span>
            <span className="text-muted-foreground">
              失败: <strong>{stats.failed}</strong>
            </span>
          </div>
        )}
        <Button variant="destructive" size="sm" onClick={killAll}>
          终止全部
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} title="关闭">
            <span className="material-symbols-outlined">close</span>
          </Button>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <div className="text-[32px] mb-2">
                <span className="material-symbols-outlined" style={{ fontSize: 32 }}>settings</span>
              </div>
              <div>暂无进程</div>
              <div className="text-[11px] mt-1">启动工作流后，进程将显示在此处</div>
            </div>
          ) : (
            processes.map((process) => (
              <div
                key={process.id}
                className={`p-3 rounded-md border cursor-pointer hover:bg-accent transition-colors ${
                  selectedProcess?.id === process.id ? 'bg-accent border-primary' : ''
                }`}
                onClick={() => setSelectedProcess(process)}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${getStatusDotColor(process.status)}`} />
                  <span className="font-medium text-sm">{process.agent}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{getStatusText(process.status)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{process.step}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(process.startTime).toLocaleTimeString()}
                </div>
                {process.status === 'running' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      killProcess(process.id);
                    }}
                  >
                    终止
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
        {selectedProcess && (
          <div className="w-80 border-l overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h4>进程详情</h4>
              <Button variant="ghost" size="icon" onClick={() => setSelectedProcess(null)}>
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>
            <div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground uppercase">ID</label>
                <div className="text-sm">{selectedProcess.id}</div>
              </div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground uppercase">Agent</label>
                <div className="text-sm">{selectedProcess.agent}</div>
              </div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground uppercase">步骤</label>
                <div className="text-sm">{selectedProcess.step}</div>
              </div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground uppercase">状态</label>
                <div className="text-sm">
                  {getStatusText(selectedProcess.status)}
                </div>
              </div>
              <div className="mb-3">
                <label className="text-xs text-muted-foreground uppercase">开始时间</label>
                <div className="text-sm">
                  {new Date(selectedProcess.startTime).toLocaleString()}
                </div>
              </div>
              {selectedProcess.endTime && (
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground uppercase">结束时间</label>
                  <div className="text-sm">
                    {new Date(selectedProcess.endTime).toLocaleString()}
                  </div>
                </div>
              )}
              {selectedProcess.output && (
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground uppercase">输出</label>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap font-mono">{selectedProcess.output}</pre>
                </div>
              )}
              {selectedProcess.error && (
                <div className="mb-3">
                  <label className="text-xs text-muted-foreground uppercase">错误</label>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap font-mono text-destructive">{selectedProcess.error}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}