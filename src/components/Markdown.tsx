'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './Markdown.module.css';

const verdictConfig: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  pass: { icon: 'check_circle', label: '通过', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  conditional_pass: { icon: 'warning', label: '有条件通过', color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  fail: { icon: 'cancel', label: '未通过', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

function VerdictCard({ data }: { data: { verdict: string; remaining_issues?: number; summary?: string } }) {
  const cfg = verdictConfig[data.verdict] || verdictConfig.fail;
  return (
    <div className={`${cfg.bg} ${cfg.border} border rounded-lg p-3 my-2`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`material-symbols-outlined text-lg ${cfg.color}`}>{cfg.icon}</span>
        <span className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</span>
        {data.remaining_issues !== undefined && (
          <span className="text-xs text-muted-foreground ml-auto">
            剩余问题: <span className="font-mono font-semibold">{data.remaining_issues}</span>
          </span>
        )}
      </div>
      {data.summary && (
        <p className="text-xs leading-relaxed text-muted-foreground mt-1">{data.summary}</p>
      )}
    </div>
  );
}

function tryParseVerdict(code: string): { verdict: string; remaining_issues?: number; summary?: string } | null {
  try {
    const obj = JSON.parse(code.trim());
    if (obj && typeof obj.verdict === 'string' && (obj.verdict === 'pass' || obj.verdict === 'fail' || obj.verdict === 'conditional_pass')) {
      return obj;
    }
  } catch { /* not verdict json */ }
  return null;
}

const components = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const code = String(children).replace(/\n$/, '');
    const isMultiLine = code.includes('\n');

    // Detect verdict JSON and render as card
    if (match?.[1] === 'json') {
      const verdict = tryParseVerdict(code);
      if (verdict) return <VerdictCard data={verdict} />;
    }

    if (match || isMultiLine) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={match?.[1] || 'text'}
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: '6px', fontSize: '13px' }}
        >
          {code}
        </SyntaxHighlighter>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  details({ children, ...props }: any) {
    return (
      <details className="my-2 border border-border/50 rounded-md" {...props}>
        {children}
      </details>
    );
  },
  summary({ children, ...props }: any) {
    return (
      <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground select-none" {...props}>
        {children}
      </summary>
    );
  },
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
