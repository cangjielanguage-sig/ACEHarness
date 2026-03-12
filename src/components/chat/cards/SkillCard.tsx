'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import FollowUpSuggestions from './FollowUpSuggestions';

interface SkillCardProps {
  skill: { name: string; description?: string; tags?: string[]; version?: string; platforms?: string[]; detailedDescription?: string };
  onAction?: (prompt: string) => void;
}

export default function SkillCard({ skill, onAction }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="group relative p-3 rounded-lg border bg-background hover:border-pink-500/50 transition-colors cursor-pointer overflow-hidden"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-pink-500/5 to-rose-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-pink-500 text-base">extension</span>
            <span className="font-medium text-sm truncate">{skill.name}</span>
          </div>
          {skill.version && <Badge variant="outline" className="text-[10px] shrink-0">v{skill.version}</Badge>}
        </div>
        {skill.description && <div className="text-xs text-muted-foreground mt-1">{skill.description}</div>}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {skill.tags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
            ))}
          </div>
        )}

        <AnimatePresence>
          {expanded && skill.detailedDescription && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 p-2 rounded bg-muted/50 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                {skill.detailedDescription.slice(0, 500)}{skill.detailedDescription.length > 500 ? '...' : ''}
              </div>
              {skill.platforms && skill.platforms.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {skill.platforms.map(p => (
                    <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <FollowUpSuggestions
          suggestions={[
            { label: '创建新 Skill', prompt: '帮我创建一个新的 Skill', icon: 'add' },
            { label: '介绍此 Skill', prompt: `帮我介绍一下 Skill ${skill.name} 的用途和使用方法`, icon: 'info' },
          ]}
          onAction={onAction}
        />
      </div>
    </motion.div>
  );
}
