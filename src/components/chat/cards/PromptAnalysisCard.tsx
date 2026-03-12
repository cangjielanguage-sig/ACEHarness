'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface PromptAnalysisCardProps {
  result: {
    analysis?: {
      score: number;
      strengths: string[];
      weaknesses: string[];
      suggestions: string[];
      optimizedPrompt?: string;
    };
    agentName?: string;
  };
  onAction?: (prompt: string) => void;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-amber-500' : 'text-red-500';
  const bgColor = score >= 80 ? 'stroke-green-500' : score >= 60 ? 'stroke-amber-500' : 'stroke-red-500';
  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
        <motion.circle
          cx="24" cy="24" r="20" fill="none" strokeWidth="3" strokeLinecap="round"
          className={bgColor}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          strokeDasharray={circumference}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${color}`}>
        {score}
      </div>
    </div>
  );
}

export default function PromptAnalysisCard({ result, onAction }: PromptAnalysisCardProps) {
  const analysis = result.analysis;
  if (!analysis) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border overflow-hidden"
    >
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <span className="material-symbols-outlined text-base">analytics</span>
          <span className="text-sm font-medium">提示词分析{result.agentName ? ` · ${result.agentName}` : ''}</span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-4">
          <ScoreRing score={analysis.score} />
          <div className="flex-1 min-w-0 space-y-2">
            {analysis.strengths.length > 0 && (
              <div>
                <div className="text-xs font-medium text-green-500 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">check_circle</span>
                  优点
                </div>
                {analysis.strengths.map((s, i) => (
                  <div key={i} className="text-xs text-muted-foreground">· {s}</div>
                ))}
              </div>
            )}
            {analysis.weaknesses.length > 0 && (
              <div>
                <div className="text-xs font-medium text-red-500 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">warning</span>
                  不足
                </div>
                {analysis.weaknesses.map((w, i) => (
                  <div key={i} className="text-xs text-muted-foreground">· {w}</div>
                ))}
              </div>
            )}
            {analysis.suggestions.length > 0 && (
              <div>
                <div className="text-xs font-medium text-blue-500 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">lightbulb</span>
                  建议
                </div>
                {analysis.suggestions.map((s, i) => (
                  <div key={i} className="text-xs text-muted-foreground">· {s}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {analysis.optimizedPrompt && (
          <div className="mt-3 pt-3 border-t">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 gap-1"
              onClick={() => onAction?.(`应用优化后的提示词:\n${analysis.optimizedPrompt}`)}
            >
              <span className="material-symbols-outlined text-xs">auto_fix_high</span>
              应用优化建议
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
