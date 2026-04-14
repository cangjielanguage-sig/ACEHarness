'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Markdown from '@/components/Markdown';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ComboboxPortalProvider } from '@/components/ui/combobox';
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  insertContent?: string;
}

interface NotebookAskAISheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: string;
  autoTask?: {
    id: string;
    displayText: string;
    prompt: string;
  } | null;
  onInsertResult?: (content: string) => void;
  insertButtonLabel?: string;
}

export function NotebookAskAISheet({ open, onOpenChange, context, autoTask, onInsertResult, insertButtonLabel = '插入回原文' }: NotebookAskAISheetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState(() => {
    if (typeof window === 'undefined') return 'claude-sonnet-4-6';
    return window.localStorage.getItem('notebook-ai-model') || 'claude-sonnet-4-6';
  });
  const [engine, setEngine] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('notebook-ai-engine') || '';
  });
  const [inputCache, setInputCache] = useState('');
  const editorRef = useRef<RichTextEditorHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastAutoTaskIdRef = useRef<string | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<{ userText: string; prompt: string } | null>(null);

  const hasContext = useMemo(() => context.trim().length > 0, [context]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('notebook-ai-model', model);
  }, [model]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('notebook-ai-engine', engine);
  }, [engine]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => editorRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  const clearChat = () => {
    setMessages([]);
    setSessionId(null);
  };

  const normalizeAiResult = (raw: string) => {
    const withoutSdkLogs = raw
      .replace(/\[SDK\][^\n]*(\n|$)/g, '\n')
      .replace(/^\s*\[SDK\].*$/gm, '')
      .trim();

    const tagMatch = withoutSdkLogs.match(/<result>([\s\S]*?)<\/result>/i);
    if (tagMatch?.[1]) {
      return tagMatch[1].trim();
    }
    return withoutSdkLogs;
  };

  const send = async (textToSend?: string, overridePrompt?: string, options?: { regenerate?: boolean }) => {
    const userText = (textToSend?.trim() || editorRef.current?.getMarkdown().trim() || inputCache.trim());
    if (!userText || loading) return;

    if (!options?.regenerate) {
      setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    }
    setLoading(true);
    editorRef.current?.clear();
    setInputCache('');

    const prompt = overridePrompt || (hasContext
      ? [
          '你正在协助 Cangjie Notebook 编辑。',
          '',
          '以下是用户当前选中块的内容（仅作上下文参考）：',
          '```',
          context,
          '```',
          '',
          '用户问题：',
          userText,
        ].join('\n')
      : userText);

    lastRequestRef.current = { userText, prompt };
    const controller = new AbortController();
    requestAbortRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: prompt,
          model,
          engine,
          sessionId,
          mode: 'dashboard',
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessages((prev) => [...prev, { role: 'error', content: data.error || `HTTP ${res.status}` }]);
      } else {
        if (data.sessionId) setSessionId(data.sessionId);
        const normalized = normalizeAiResult(String(data.result || ''));
        setMessages((prev) => [...prev, { role: 'assistant', content: normalized || '', insertContent: normalized || '' }]);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setMessages((prev) => [...prev, { role: 'error', content: '已停止生成' }]);
        return;
      }
      setMessages((prev) => [...prev, { role: 'error', content: error?.message || '请求失败' }]);
    } finally {
      requestAbortRef.current = null;
      setLoading(false);
      setTimeout(() => editorRef.current?.focus(), 80);
    }
  };

  const stopGenerating = () => {
    requestAbortRef.current?.abort();
  };

  const regenerate = () => {
    const last = lastRequestRef.current;
    if (!last || loading) return;
    void send(last.userText, last.prompt, { regenerate: true });
  };

  useEffect(() => {
    if (!open || !autoTask || loading) return;
    if (lastAutoTaskIdRef.current === autoTask.id) return;
    lastAutoTaskIdRef.current = autoTask.id;
    void send(autoTask.displayText, autoTask.prompt);
  }, [autoTask, loading, open]);

  useEffect(() => {
    if (!open || !autoTask || loading) return;
    if (lastAutoTaskIdRef.current !== autoTask.id) return;
    void send(autoTask.displayText, autoTask.prompt, { regenerate: true });
  }, [engine, model]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      lastAutoTaskIdRef.current = null;
      requestAbortRef.current?.abort();
    }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="z-[90] w-[94vw] sm:max-w-[720px] h-[100dvh] max-h-[100dvh] p-0 overflow-hidden gap-0 flex flex-col">
        <ComboboxPortalProvider>
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base">Notebook AI 助手</SheetTitle>
              </div>
              <div className="w-[260px]">
                <EngineModelSelect
                  engine={engine}
                  model={model}
                  onEngineChange={setEngine}
                  onModelChange={setModel}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20">
            {hasContext && (
              <div className="mx-4 mt-4 rounded-md border bg-background p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">当前块上下文</div>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/90">{context}</pre>
              </div>
            )}

            <div className="mx-4 mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  输入问题开始对话
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground whitespace-pre-wrap'
                      : msg.role === 'error'
                        ? 'bg-destructive/10 text-destructive whitespace-pre-wrap'
                        : 'bg-muted'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div>
                      <div className="prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                      {onInsertResult && (
                        <div className="mt-2 flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => onInsertResult((msg.insertContent || msg.content).trim())}
                          >
                            {insertButtonLabel}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              ))}
              {loading && (
                <div className="text-sm text-muted-foreground">AI 思考中...</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="mx-4 my-4 rounded-md border bg-background p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <RichTextEditor
                    ref={editorRef}
                    onEnter={(text) => { void send(text); }}
                    onChange={setInputCache}
                    placeholder="问点具体的，例如：这段代码如何优化？"
                    minHeight={44}
                    maxHeight={140}
                    disabled={loading}
                    showToolbar={false}
                  />
                </div>
                <Button size="sm" variant="outline" onClick={clearChat} disabled={loading}>
                  清空
                </Button>
                {loading ? (
                  <Button size="sm" variant="destructive" onClick={stopGenerating}>
                    停止
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={regenerate} disabled={!lastRequestRef.current}>
                      重新生成
                    </Button>
                    <Button size="sm" onClick={() => { void send(); }}>
                      发送
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </ComboboxPortalProvider>
      </SheetContent>
    </Sheet>
  );
}
