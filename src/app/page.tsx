'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@/contexts/ChatContext';
import { configApi, runsApi } from '@/lib/api';
import NewConfigModal from '@/components/NewConfigModal';
import CopyConfigModal from '@/components/CopyConfigModal';
import DeleteConfirmModal from '@/components/DeleteConfirmModal';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ConfigSummary {
  filename: string;
  name: string;
  description: string;
  phaseCount: number;
  stepCount: number;
  agentCount: number;
}

interface RunRecord {
  id: string;
  configFile: string;
  startTime: string;
  endTime: string | null;
  status: string;
  phaseReached: string;
  totalSteps: number;
  completedSteps: number;
}

export default function HomePage() {
  const router = useRouter();
  const { openChat } = useChat();
  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [copySource, setCopySource] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => { loadConfigs(); }, []);
  useEffect(() => {
    if (selectedConfig) loadRuns(selectedConfig);
  }, [selectedConfig]);

  const loadConfigs = async () => {
    try {
      const { configs: list } = await configApi.listConfigs();
      setConfigs(list);
    } catch (error) {
      console.error('加载配置列表失败:', error);
    }
  };

  const loadRuns = async (configFile: string) => {
    try {
      const { runs: list } = await runsApi.listByConfig(configFile);
      setRuns(list);
    } catch (error) {
      console.error('加载运行记录失败:', error);
      setRuns([]);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await configApi.deleteConfig(deleteTarget);
      setDeleteTarget(null);
      if (selectedConfig === deleteTarget) {
        setSelectedConfig(null);
        setRuns([]);
      }
      loadConfigs();
    } catch (error: any) {
      alert('删除失败: ' + error.message);
    }
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return '进行中';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  const statusVariant = (status: string) => {
    if (status === 'completed') return 'default' as const;
    if (status === 'failed') return 'destructive' as const;
    return 'secondary' as const;
  };
  const statusLabel: Record<string, string> = {
    running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止',
  };
  /* PLACEHOLDER_RETURN */

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex items-center justify-between px-8 py-6 border-b">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-primary">bolt</span>
          <div>
            <h1 className="text-2xl font-bold">AceFlow</h1>
            <p className="text-sm text-muted-foreground">AI 协同工作调度系统</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button variant="outline" onClick={openChat}>
            <span className="material-symbols-outlined text-sm mr-1">chat</span>
            Claude 聊天
          </Button>
          <Button onClick={() => setShowNewModal(true)}>
            <span className="material-symbols-outlined text-sm mr-1">add</span>
            新建配置
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        <h2 className="text-lg font-semibold mb-4">工作流配置</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {configs.map((cfg) => (
            <div
              key={cfg.filename}
              className={`rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent/50 ${
                selectedConfig === cfg.filename ? 'border-primary bg-accent/30' : ''
              }`}
              onClick={() => setSelectedConfig(cfg.filename)}
            >
              <div className="text-xs text-muted-foreground font-mono mb-1">{cfg.filename}</div>
              <div className="font-medium mb-1">{cfg.name}</div>
              {cfg.description && <p className="text-sm text-muted-foreground mb-3">{cfg.description}</p>}
              <div className="flex gap-4 text-sm text-muted-foreground mb-3">
                <span><span className="font-semibold text-foreground">{cfg.phaseCount}</span> 阶段</span>
                <span><span className="font-semibold text-foreground">{cfg.stepCount}</span> 步骤</span>
                <span><span className="font-semibold text-foreground">{cfg.agentCount}</span> Agent</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/workbench/${encodeURIComponent(cfg.filename)}?mode=run`); }}>
                  <span className="material-symbols-outlined text-sm mr-1">play_arrow</span>运行
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/workbench/${encodeURIComponent(cfg.filename)}?mode=design`); }}>
                  <span className="material-symbols-outlined text-sm mr-1">edit</span>设计
                </Button>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCopySource(cfg.filename); }}>
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(cfg.filename); }}>
                  <span className="material-symbols-outlined text-sm">delete</span>
                </Button>
              </div>
            </div>
          ))}
          <div
            className="rounded-lg border border-dashed p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[160px]"
            onClick={() => setShowNewModal(true)}
          >
            <span className="material-symbols-outlined text-3xl text-muted-foreground mb-2">add_circle</span>
            <span className="text-sm text-muted-foreground">新建配置</span>
          </div>
        </div>
        {selectedConfig && (
          <div className="mt-8">
            <h3 className="text-base font-semibold mb-3">运行历史 — {selectedConfig}</h3>
            {runs.length > 0 ? (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted text-muted-foreground text-left">
                      <th className="px-4 py-2 font-medium">运行 ID</th>
                      <th className="px-4 py-2 font-medium">状态</th>
                      <th className="px-4 py-2 font-medium">开始时间</th>
                      <th className="px-4 py-2 font-medium">耗时</th>
                      <th className="px-4 py-2 font-medium">到达阶段</th>
                      <th className="px-4 py-2 font-medium">进度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="border-t hover:bg-accent/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{run.id}</td>
                        <td className="px-4 py-2">
                          <Badge variant={statusVariant(run.status)}>{statusLabel[run.status] || run.status}</Badge>
                        </td>
                        <td className="px-4 py-2">{new Date(run.startTime).toLocaleString('zh-CN')}</td>
                        <td className="px-4 py-2">{formatDuration(run.startTime, run.endTime)}</td>
                        <td className="px-4 py-2">{run.phaseReached || '-'}</td>
                        <td className="px-4 py-2">{run.completedSteps}/{run.totalSteps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">暂无运行记录</div>
            )}
          </div>
        )}
      </div>
      <NewConfigModal isOpen={showNewModal} onClose={() => setShowNewModal(false)}
        onSuccess={(filename) => { loadConfigs(); setShowNewModal(false); }} />
      {copySource && (
        <CopyConfigModal isOpen={true} sourceFilename={copySource}
          onClose={() => setCopySource(null)}
          onSuccess={() => { setCopySource(null); loadConfigs(); }} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal isOpen={true} filename={deleteTarget}
          onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}
    </div>
  );
}
