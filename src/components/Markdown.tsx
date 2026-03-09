'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './Markdown.module.css';

const components = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const code = String(children).replace(/\n$/, '');
    const isMultiLine = code.includes('\n');
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
