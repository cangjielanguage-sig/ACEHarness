'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ConfigCardProps {
  config: { filename: string; name: string; description?: string; stepCount?: number; agentCount?: number; phaseCount?: number };
  onAction?: (prompt: string) => void;
}

export default function ConfigCard({ config, onAction }: ConfigCardProps) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="group relative p-3 rounded-lg border bg-background hover:border-primary/50 transition-colors cursor-pointer overflow-hidden"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-blue-500 text-base">description</span>
            <span className="font-medium text-sm truncate">{config.name}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {config.stepCount !== undefined && <Badge variant="outline" className="text-[10px]">{config.stepCount} 步骤</Badge>}
            {config.agentCount !== undefined && <Badge variant="secondary" className="text-[10px]">{config.agentCount} Agent</Badge>}
          </div>
        </div>
        {config.description && <div className="text-xs text-muted-foreground mt-1 truncate">{config.description}</div>}
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">{config.filename}</div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 mt-3 pt-2 border-t">
                <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={(e) => { e.stopPropagation(); router.push(`/workbench/${encodeURIComponent(config.filename)}`); }}>
                  <span className="material-symbols-outlined text-xs">open_in_new</span>
                  打开
                </Button>
                <Button size="sm" className="text-xs h-7 gap-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white" onClick={(e) => { e.stopPropagation(); onAction?.(`启动工作流 ${config.filename}`); }}>
                  <span className="material-symbols-outlined text-xs">play_arrow</span>
                  启动
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" onClick={(e) => { e.stopPropagation(); onAction?.(`查看工作流配置 ${config.filename} 的详细内容`); }}>
                  <span className="material-symbols-outlined text-xs">info</span>
                  详情
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
