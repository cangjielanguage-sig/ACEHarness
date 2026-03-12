'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const TEAM_COLORS: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  red: 'bg-red-500/10 text-red-500 border-red-500/30',
  judge: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
};

interface AgentCardProps {
  agent: { name: string; role?: string; model?: string; team?: string; category?: string; systemPrompt?: string };
  onAction?: (prompt: string) => void;
}

export default function AgentCard({ agent, onAction }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const teamClass = TEAM_COLORS[agent.team || ''] || 'bg-muted text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="group relative p-3 rounded-lg border bg-background hover:border-purple-500/50 transition-colors cursor-pointer overflow-hidden"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-purple-500 text-base">smart_toy</span>
            <span className="font-medium text-sm truncate">{agent.name}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {agent.team && <Badge variant="outline" className={`text-[10px] ${teamClass}`}>{agent.team}</Badge>}
            <Badge variant="secondary" className="text-[10px]">{agent.model || 'default'}</Badge>
          </div>
        </div>
        {agent.role && <div className="text-xs text-muted-foreground mt-1">{agent.role}</div>}

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {agent.systemPrompt && (
                <div className="mt-2 p-2 rounded bg-muted/50 text-xs text-muted-foreground max-h-24 overflow-y-auto">
                  {agent.systemPrompt.slice(0, 300)}{agent.systemPrompt.length > 300 ? '...' : ''}
                </div>
              )}
              <div className="flex gap-2 mt-3 pt-2 border-t">
                <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={(e) => { e.stopPropagation(); onAction?.(`查看 Agent ${agent.name} 的详细配置`); }}>
                  <span className="material-symbols-outlined text-xs">info</span>
                  详情
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" onClick={(e) => { e.stopPropagation(); onAction?.(`帮我优化 Agent ${agent.name} 的提示词`); }}>
                  <span className="material-symbols-outlined text-xs">auto_fix_high</span>
                  优化提示词
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
