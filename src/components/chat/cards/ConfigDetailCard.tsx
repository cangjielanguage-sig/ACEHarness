'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import FollowUpSuggestions from './FollowUpSuggestions';

interface ConfigDetailCardProps {
  config: any;
  raw: string;
  agents?: any[];
  filename?: string;
  onAction?: (prompt: string) => void;
}

function PhaseVisualizer({ phases }: { phases: any[] }) {
  return (
    <div className="space-y-2">
      {phases.map((phase: any, pi: number) => {
        const steps = phase.steps || [];
        const hasIteration = phase.iteration?.enabled;
        return (
          <div key={pi} className="rounded-lg border bg-background/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
              <span className="material-symbols-outlined text-sm text-blue-500">folder</span>
              <span className="text-xs font-medium">{phase.name}</span>
              <div className="flex gap-1 ml-auto">
                <Badge variant="outline" className="text-[10px]">{steps.length} 步骤</Badge>
                {hasIteration && (
                  <Badge variant="secondary" className="text-[10px]">
                    迭代 x{phase.iteration.maxIterations}
                  </Badge>
                )}
              </div>
            </div>
            <div className="p-2 space-y-1">
              {steps.map((step: any, si: number) => (
                <div key={si} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/20 hover:bg-muted/40 transition-colors">
                  <StepIcon role={step.role} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{step.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{step.task}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{step.agent}</Badge>
                </div>
              ))}
            </div>
            {phase.checkpoint && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/5 border-t text-[10px] text-amber-600">
                <span className="material-symbols-outlined text-xs">flag</span>
                检查点: {phase.checkpoint.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateVisualizer({ states }: { states: any[] }) {
  return (
    <div className="space-y-2">
      {states.map((state: any, si: number) => {
        const steps = state.steps || [];
        return (
          <div key={si} className="rounded-lg border bg-background/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
              <span className="material-symbols-outlined text-sm text-purple-500">circle</span>
              <span className="text-xs font-medium">{state.name}</span>
              <Badge variant="outline" className="text-[10px] ml-auto">{steps.length} 步骤</Badge>
            </div>
            <div className="p-2 space-y-1">
              {steps.map((step: any, sti: number) => (
                <div key={sti} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/20">
                  <StepIcon role={step.role} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{step.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{step.task}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{step.agent}</Badge>
                </div>
              ))}
            </div>
            {state.transitions && state.transitions.length > 0 && (
              <div className="px-3 py-1.5 border-t bg-muted/10">
                <div className="text-[10px] text-muted-foreground mb-1">转换:</div>
                {state.transitions.map((t: any, ti: number) => (
                  <div key={ti} className="flex items-center gap-1 text-[10px]">
                    <span className="material-symbols-outlined text-[10px] text-green-500">arrow_forward</span>
                    <span className="text-muted-foreground">{t.condition || 'default'}</span>
                    <span className="mx-1">→</span>
                    <span className="font-medium">{t.target}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepIcon({ role }: { role?: string }) {
  if (role === 'attacker') return <span className="material-symbols-outlined text-xs text-red-500">swords</span>;
  if (role === 'defender') return <span className="material-symbols-outlined text-xs text-blue-500">shield</span>;
  if (role === 'judge') return <span className="material-symbols-outlined text-xs text-amber-500">gavel</span>;
  return <span className="material-symbols-outlined text-xs text-muted-foreground">play_arrow</span>;
}

export default function ConfigDetailCard({ config, raw, agents, filename, onAction }: ConfigDetailCardProps) {
  const [copied, setCopied] = useState(false);
  const workflow = config?.workflow || config;
  const mode = workflow?.mode || 'phase-based';
  const phases = workflow?.phases || [];
  const states = workflow?.states || [];
  const name = workflow?.name || filename || '未命名工作流';
  const description = workflow?.description || '';

  const handleCopy = () => {
    navigator.clipboard.writeText(raw || JSON.stringify(config, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalSteps = mode === 'state-machine'
    ? states.reduce((s: number, st: any) => s + (st.steps?.length || 0), 0)
    : phases.reduce((s: number, p: any) => s + (p.steps?.length || 0), 0);

  const usedAgents = new Set<string>();
  const allSteps = mode === 'state-machine'
    ? states.flatMap((s: any) => s.steps || [])
    : phases.flatMap((p: any) => p.steps || []);
  allSteps.forEach((s: any) => s.agent && usedAgents.add(s.agent));

  const suggestions = [
    { label: '分析此工作流', prompt: `帮我分析一下工作流 ${filename} 的设计是否合理`, icon: 'analytics' },
    { label: '启动运行', prompt: `启动工作流 ${filename}`, icon: 'play_arrow' },
    { label: '打开工作台', prompt: `打开工作流 ${filename} 的工作台`, icon: 'open_in_new' },
    { label: '优化建议', prompt: `帮我优化工作流 ${filename} 的配置`, icon: 'auto_fix_high' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-lg border bg-background overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-500/5 to-cyan-500/5 border-b">
        <span className="material-symbols-outlined text-blue-500">description</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{name}</div>
          {description && <div className="text-xs text-muted-foreground truncate">{description}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[10px]">{mode === 'state-machine' ? '状态机' : '阶段式'}</Badge>
          <Badge variant="secondary" className="text-[10px]">{totalSteps} 步骤</Badge>
          <Badge variant="secondary" className="text-[10px]">{usedAgents.size} Agent</Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="visual" className="w-full">
        <div className="px-4 pt-2">
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs h-6 gap-1 px-3">
              <span className="material-symbols-outlined text-xs">account_tree</span>
              可视化
            </TabsTrigger>
            <TabsTrigger value="source" className="text-xs h-6 gap-1 px-3">
              <span className="material-symbols-outlined text-xs">code</span>
              源码
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visual" className="px-4 pb-3 mt-0">
          <div className="max-h-80 overflow-y-auto pr-1">
            {mode === 'state-machine'
              ? <StateVisualizer states={states} />
              : <PhaseVisualizer phases={phases} />
            }
          </div>
        </TabsContent>

        <TabsContent value="source" className="px-4 pb-3 mt-0">
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1 h-6 text-[10px] gap-1 z-10"
              onClick={handleCopy}
            >
              <span className="material-symbols-outlined text-xs">{copied ? 'check' : 'content_copy'}</span>
              {copied ? '已复制' : '复制'}
            </Button>
            <pre className="p-3 rounded border bg-muted/30 text-xs overflow-x-auto max-h-80 overflow-y-auto">
              {raw || JSON.stringify(config, null, 2)}
            </pre>
          </div>
        </TabsContent>
      </Tabs>

      {/* Follow-up suggestions */}
      <div className="px-4 pb-3">
        <FollowUpSuggestions suggestions={suggestions} onAction={onAction} />
      </div>
    </motion.div>
  );
}
