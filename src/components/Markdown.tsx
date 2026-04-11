'use client';

import { useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './Markdown.module.css';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded text-xs bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
      title="复制代码"
    >
      {copied ? (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>content_copy</span>
      )}
    </button>
  );
}

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
        <div className="relative group">
          <CopyButton text={code} />
          <SyntaxHighlighter
            style={oneDark}
            language={match?.[1] || 'text'}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '6px', fontSize: '13px' }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }: any) {
    // Handle autolink URLs - make them clickable links
    const isGitCode = href && href.includes('gitcode.com');
    const linkStyle = { color: 'white', textDecoration: 'underline' };

    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle} {...props}>
          {isGitCode && (
            <svg className="inline-block w-4 h-4 mr-1 align-text-bottom" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M685.679715 183.998617l-40.447039 22.783459-9.343778 5.418538a203.259173 203.259173 0 0 1-124.583708 30.463276 239.268984 239.268984 0 0 0-81.192739 5.20521c-46.71889 12.714365-89.171216 4.778553-132.348856-12.543702a316.749811 316.749811 0 0 0-33.791198-9.045119l1.023976 24.106094c0.597319 14.506322 1.151973 27.988669 2.133283 41.471015 2.389277 31.572583-6.058523 60.286568-21.418158 88.189906a387.190804 387.190804 0 0 0-50.601465 196.390002c2.389277 111.570684 69.630346 194.427382 182.438334 230.010538 99.069647 31.31659 198.736613 29.951289 298.232917 5.546534a279.502695 279.502695 0 0 0 141.649969-83.752677c9.258447-10.026429 17.492918-20.991501 24.575416-32.681891 28.841982-48.68151 9.557106-94.205763-46.505562-103.464209a312.184586 312.184586 0 0 0-44.798936-3.413252l-15.146307-0.255994c-14.079666-0.127997-28.116666-0.255994-42.068334-1.450632-48.169523-3.92524-96.424377-8.277137-144.124577-15.786292-23.679438-3.839909-43.561632-19.412872-46.3349-45.35359-2.986596-28.500656 4.693222-57.214641 31.401921-71.038312a202.917847 202.917847 0 0 1 76.968839-23.46611c81.022076-5.759863 162.470808-0.511988 242.127582 15.487632 139.431355 28.585988 212.261625 166.268051 145.27655 292.259726-94.504422 177.489118-242.468908 279.886686-447.98936 284.707905-160.422857 3.839909-301.731501-47.102881-413.003525-165.244076C-122.365094 582.410488 3.071927 132.074517 369.612555 23.917085c169.979963-49.918814 327.800215-21.332827 471.45547 82.302046 51.625441 37.247115 64.851793 99.112313 34.473848 149.628446-25.258067 42.111-72.104954 61.182547-121.853106 49.66282-31.99924-7.466489-55.124024-38.996407-61.395876-82.472707l-0.98131-8.277137a123.474401 123.474401 0 0 0-1.791957-11.434395l-3.839909-19.327541z" fill="#DA203E"></path>
            </svg>
          )}
          {children}
        </a>
      );
    }
    return (
      <a href={href} style={linkStyle} {...props}>
        {children}
      </a>
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

// Valid HTML5 tag names (lowercase). Used to filter out non-standard tags like <float64>.
const HTML_TAGS = new Set([
  'a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote',
  'body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist',
  'dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption',
  'figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr',
  'html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map',
  'mark','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output',
  'p','param','picture','pre','progress','q','rp','rt','ruby','s','samp','script','search',
  'section','select','slot','small','source','span','strong','style','sub','summary','sup',
  'table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track',
  'u','ul','var','video','wbr',
]);

/**
 * Close any unclosed code fence (common during streaming).
 * Supports both backtick and tilde fences.
 * Uses strict CommonMark rules: a closing fence must have >= opening width
 * and no info string.
 */
function closeUnterminatedFences(content: string): string {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let fenceWidth = 0;
  let fenceChar: '`' | '~' | null = null;

  for (const line of lines) {
    if (!inCodeBlock) {
      const m = line.match(/^(`{3,}|~{3,})/);
      if (m) {
        inCodeBlock = true;
        fenceWidth = m[1].length;
        fenceChar = m[1][0] as '`' | '~';
      }
    } else {
      const closeRe = fenceChar === '~' ? /^(~{3,})\s*$/ : /^(`{3,})\s*$/;
      const m = line.match(closeRe);
      if (m && m[1].length >= fenceWidth) {
        inCodeBlock = false;
        fenceChar = null;
      }
    }
  }

  if (inCodeBlock && fenceChar) {
    return content + '\n' + fenceChar.repeat(fenceWidth);
  }
  return content;
}

// Preprocess: convert bare URLs to markdown links for GFM autolink,
// and escape non-standard HTML-like tags (e.g. <float64>) so rehypeRaw doesn't choke.
function preprocessMarkdown(content: string): string {
  // 0. Close any unterminated code fence (streaming)
  const closed = closeUnterminatedFences(content);
  // 1. Escape angle brackets around non-standard tag names
  const escaped = closed.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9._-]*)(\s[^>]*)?\/?>/g,
    (match, tagName) => {
      if (HTML_TAGS.has(tagName.toLowerCase())) return match;
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  );
  // 2. GFM autolink literals: wrap bare URLs in angle brackets
  return escaped.replace(
    /(?<![<"\[])(https?:\/\/[^\s<>\]")]+)/g,
    '<$1>'
  );
}

export default function Markdown({ children }: { children: string }) {
  const processedContent = useMemo(() => preprocessMarkdown(children), [children]);

  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
