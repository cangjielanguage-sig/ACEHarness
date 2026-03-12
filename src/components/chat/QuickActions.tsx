'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface QuickActionsProps {
  onAction: (text: string) => void;
}

const CATEGORIES = [
  {
    title: '查看',
    icon: 'visibility',
    actions: [
      { icon: 'account_tree', label: '工作流列表', prompt: '列出所有工作流配置', color: 'from-blue-500 to-blue-600' },
      { icon: 'smart_toy', label: 'Agent 列表', prompt: '列出所有 Agent', color: 'from-purple-500 to-purple-600' },
      { icon: 'model_training', label: '模型列表', prompt: '列出所有可用模型', color: 'from-cyan-500 to-cyan-600' },
      { icon: 'extension', label: 'Skill 列表', prompt: '列出所有可用 Skills', color: 'from-pink-500 to-pink-600' },
      { icon: 'monitoring', label: '运行状态', prompt: '查看当前工作流运行状态', color: 'from-green-500 to-green-600' },
      { icon: 'history', label: '运行历史', prompt: '列出最近的运行记录', color: 'from-teal-500 to-teal-600' },
    ],
  },
  {
    title: '创建',
    icon: 'add_circle',
    actions: [
      { icon: 'add_circle', label: '创建工作流', prompt: '帮我创建一个新的工作流配置', color: 'from-orange-500 to-orange-600' },
      { icon: 'person_add', label: '创建 Agent', prompt: '帮我创建一个新的 Agent', color: 'from-indigo-500 to-indigo-600' },
      { icon: 'play_arrow', label: '启动运行', prompt: '我想启动一个工作流运行', color: 'from-emerald-500 to-emerald-600' },
    ],
  },
  {
    title: '优化',
    icon: 'auto_fix_high',
    actions: [
      { icon: 'auto_fix_high', label: '优化提示词', prompt: '帮我优化一个 Agent 的提示词', color: 'from-amber-500 to-amber-600' },
      { icon: 'analytics', label: '分析运行', prompt: '分析最近一次运行的提示词效果', color: 'from-rose-500 to-rose-600' },
    ],
  },
];

const ALL_ACTIONS = CATEGORIES.flatMap(c => c.actions);

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1 },
};

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <motion.div
      className="w-full max-w-2xl space-y-5"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {CATEGORIES.map(cat => (
        <div key={cat.title}>
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <span className="material-symbols-outlined text-sm text-muted-foreground">{cat.icon}</span>
            <span className="text-xs font-medium text-muted-foreground">{cat.title}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {cat.actions.map(a => (
              <motion.button
                key={a.label}
                variants={itemVariants}
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onAction(a.prompt)}
                className={`relative bg-gradient-to-br ${a.color} p-3.5 rounded-xl border border-white/10 overflow-hidden group text-left`}
              >
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-white/10 rounded-full blur-xl" />
                <div className="relative z-10 flex flex-col gap-1.5">
                  <span className="material-symbols-outlined text-white/90 text-lg">{a.icon}</span>
                  <span className="text-xs font-medium text-white">{a.label}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

/** Compact horizontal bar version — shown above input when messages exist */
export function QuickActionsBar({ onAction }: QuickActionsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="max-w-4xl mx-auto">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mb-2"
          >
            <div className="flex flex-wrap gap-1.5 pb-1">
              {ALL_ACTIONS.map(a => (
                <motion.button
                  key={a.label}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { onAction(a.prompt); setExpanded(false); }}
                  className={`inline-flex items-center gap-1 bg-gradient-to-r ${a.color} text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-white/10`}
                >
                  <span className="material-symbols-outlined text-xs">{a.icon}</span>
                  {a.label}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-1.5"
      >
        <span className="material-symbols-outlined text-sm">{expanded ? 'expand_more' : 'expand_less'}</span>
        {expanded ? '收起快捷操作' : '快捷操作'}
      </button>
    </div>
  );
}
