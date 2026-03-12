'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface WizardCardProps {
  result: { wizardType: string; step: number; totalSteps: number; data?: any };
  onAction?: (prompt: string) => void;
}

const WIZARD_LABELS: Record<string, string> = {
  workflow: '工作流创建向导',
  agent: 'Agent 创建向导',
  skill: 'Skill 创建向导',
};

const WIZARD_ICONS: Record<string, string> = {
  workflow: 'account_tree',
  agent: 'smart_toy',
  skill: 'extension',
};

const WIZARD_COLORS: Record<string, string> = {
  workflow: 'from-blue-500 to-cyan-500',
  agent: 'from-purple-500 to-pink-500',
  skill: 'from-orange-500 to-amber-500',
};

export default function WizardCard({ result, onAction }: WizardCardProps) {
  const { wizardType, step, totalSteps, data } = result;
  const label = WIZARD_LABELS[wizardType] || '创建向导';
  const icon = WIZARD_ICONS[wizardType] || 'magic_button';
  const color = WIZARD_COLORS[wizardType] || 'from-blue-500 to-cyan-500';
  const title = data?.title || `步骤 ${step}`;
  const hints = data?.hints || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border overflow-hidden"
    >
      {/* Header with gradient */}
      <div className={`bg-gradient-to-r ${color} px-4 py-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white">
          <span className="material-symbols-outlined text-base">{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-white/80 text-xs">{step}/{totalSteps}</span>
      </div>

      {/* Step progress */}
      <div className="px-4 pt-3">
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < step ? `bg-gradient-to-r ${color}` : 'bg-muted'
              }`}
            />
          ))}
        </div>
        <div className="text-sm font-medium mt-2">{title}</div>
      </div>

      {/* Hint buttons */}
      {hints.length > 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {hints.map((hint: string, i: number) => (
            <Button
              key={i}
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => onAction?.(hint)}
            >
              {hint}
            </Button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
