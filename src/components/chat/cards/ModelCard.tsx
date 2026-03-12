'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import FollowUpSuggestions from './FollowUpSuggestions';

interface ModelCardProps {
  model: { value: string; label: string; costMultiplier?: number; endpoints?: string[] };
  onAction?: (prompt: string) => void;
}

export default function ModelCard({ model, onAction }: ModelCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(model.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="group relative p-3 rounded-lg border bg-background hover:border-cyan-500/50 transition-colors cursor-pointer overflow-hidden"
      onClick={handleCopy}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-teal-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-cyan-500 text-base">model_training</span>
          <div className="min-w-0">
            <div className="font-medium text-sm">{model.label}</div>
            <div className="text-[10px] text-muted-foreground">{model.value}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {model.costMultiplier !== undefined && (
            <Badge variant="outline" className="text-[10px]">{model.costMultiplier}x</Badge>
          )}
          {model.endpoints?.map(ep => (
            <Badge key={ep} variant="secondary" className="text-[10px]">{ep}</Badge>
          ))}
          {copied && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[10px] text-green-500">
              已复制
            </motion.span>
          )}
        </div>
      </div>
      <div className="relative z-10" onClick={(e) => e.stopPropagation()}>
        <FollowUpSuggestions
          suggestions={[
            { label: '使用此模型', prompt: `帮我把所有 Agent 的模型切换为 ${model.value}`, icon: 'swap_horiz' },
            { label: '对比模型', prompt: `帮我对比 ${model.label} 和其他模型的区别`, icon: 'compare' },
          ]}
          onAction={onAction}
        />
      </div>
    </motion.div>
  );
}
