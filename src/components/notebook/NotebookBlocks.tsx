'use client';

import { useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Check, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isRunnableNotebookLanguage, normalizeNotebookLanguage } from '@/lib/notebook-markdown';

interface NotebookCodeBlockProps extends ReactNodeViewProps {
  onRunCell: (payload: { pos: number; cellId: string; language: string; code: string }) => Promise<string | null>;
}

const CODE_LANG_OPTIONS = [
  'cangjie',
  'typescript',
  'javascript',
  'python',
  'java',
  'cpp',
  'sql',
  'json',
  'yaml',
  'markdown',
  'bash',
  'text',
];

export function NotebookCodeBlock({ node, selected, getPos, updateAttributes, onRunCell }: NotebookCodeBlockProps) {
  const [copying, setCopying] = useState(false);
  const [running, setRunning] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const language = normalizeNotebookLanguage(node.attrs.language);
  const code = node.textContent;
  const cellId = String(node.attrs.cellId || '');
  const canRun = isRunnableNotebookLanguage(language);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopying(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopying(false), 1200);
    } catch {
      setCopying(false);
    }
  };

  const handleRun = async () => {
    if (!canRun || running) return;
    setRunning(true);
    try {
      await onRunCell({
        pos: typeof getPos === 'function' ? (getPos() ?? 0) : 0,
        cellId,
        language,
        code,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleLanguageChange = (nextLanguage: string) => {
    const normalized = normalizeNotebookLanguage(nextLanguage);
    updateAttributes({ language: normalized });
  };

  return (
    <NodeViewWrapper className={`my-4 overflow-hidden rounded-lg border bg-[#1f2430] text-slate-100 ${selected ? 'ring-1 ring-primary' : ''}`}>
      <div contentEditable={false} className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <label className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5">
            <span className="material-symbols-outlined text-[13px] text-slate-300">code</span>
            <select
              value={language}
              onChange={(event) => handleLanguageChange(event.target.value)}
              className="bg-transparent text-xs font-mono uppercase tracking-wide text-slate-100 outline-none"
              title="切换代码语言"
            >
              {CODE_LANG_OPTIONS.map((lang) => (
                <option key={lang} value={lang} className="bg-[#1f2430] text-slate-100">
                  {lang}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/20" onClick={handleCopy} title="复制代码">
            {copying ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>content_copy</span>}
            <span>{copying ? '已复制' : '复制'}</span>
          </button>
          {canRun && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200" onClick={handleRun} disabled={running}>
              {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {running ? '运行中' : '运行'}
            </Button>
          )}
        </div>
      </div>
      <pre className="m-0 overflow-x-auto px-4 py-4 text-[13px] leading-6 text-slate-100">
        <code className={`hljs language-${language}`}>
          <NodeViewContent as="div" className="whitespace-pre font-mono outline-none caret-white" />
        </code>
      </pre>
    </NodeViewWrapper>
  );
}

interface NotebookOutputBlockProps extends ReactNodeViewProps {}

export function NotebookOutputBlock({ node }: NotebookOutputBlockProps) {
  const summary = String(node.attrs.summary || 'Output');
  const output = String(node.attrs.output || '');

  return (
    <NodeViewWrapper className="my-3 rounded-lg border bg-muted/30">
      <div contentEditable={false} className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {summary}
      </div>
      <div contentEditable={false} className="px-3 py-3">
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-[13px] leading-6 text-foreground">
          {output || '无输出'}
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
