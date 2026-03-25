'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { ModelSelect } from '@/components/ModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatMessage from '@/components/chat/ChatMessage';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import RichTextEditor, { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
import AuthGuard from '@/components/AuthGuard';

const SIDEBAR_STORAGE_KEY = 'chat-sidebar-width';
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function ChatPageContent() {
  const router = useRouter();
  const {
    activeSession, sessions, createSession, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, streamingMessageId,
    model, setModel, confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings,
  } = useChat();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setSidebarWidth(w);
    }
  }, []);

  // Hide sidebar by default on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Resize drag handler
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const x = e.clientX - containerRef.current.getBoundingClientRect().left;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, x));
      setSidebarWidth(clamped);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, clamped.toString());
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    editorRef.current?.focus();
  }, [activeSession?.id]);

  const handleSend = useCallback(async () => {
    const text = editorRef.current?.getText().trim() || input.trim();
    if (!text || loading) return;
    setInput('');
    editorRef.current?.clear();
    await sendMessage(text);
    editorRef.current?.focus();
  }, [input, loading, sendMessage]);

  const handleEditorEnter = useCallback(async (text: string) => {
    if (!text || loading) return;
    setInput('');
    editorRef.current?.clear();
    await sendMessage(text);
  }, [loading, sendMessage]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (prompt && !prompt.includes('\n')) {
      setInput('');
      editorRef.current?.clear();
      sendMessage(prompt);
    } else {
      setInput(prompt);
      editorRef.current?.focus();
    }
  }, [sendMessage]);

  const messages = activeSession?.messages || [];

  // Memoize message callbacks to prevent unnecessary re-renders
  const messageCallbacks = useMemo(() => {
    const callbacks: Record<string, {
      onConfirmAction: (id: string) => void;
      onRejectAction: (id: string) => void;
      onUndoAction: (id: string) => void;
      onRetryAction: (id: string) => void;
    }> = {};
    messages.forEach(msg => {
      callbacks[msg.id] = {
        onConfirmAction: (id) => confirmAction(msg.id, id),
        onRejectAction: (id) => rejectAction(msg.id, id),
        onUndoAction: (id) => undoActionById(msg.id, id),
        onRetryAction: (id) => retryAction(msg.id, id),
      };
    });
    return callbacks;
  }, [messages, confirmAction, rejectAction, undoActionById, retryAction]);

  const renderedMessages = useMemo(() => messages.map(msg => (
    <ChatMessage
      key={msg.id}
      message={msg}
      isStreaming={msg.id === streamingMessageId}
      onConfirmAction={messageCallbacks[msg.id].onConfirmAction}
      onRejectAction={messageCallbacks[msg.id].onRejectAction}
      onUndoAction={messageCallbacks[msg.id].onUndoAction}
      onRetryAction={messageCallbacks[msg.id].onRetryAction}
      onAction={handleQuickAction}
      onDelete={deleteMessage}
      onRetryFromMessage={msg.role === 'user' ? retryFromMessage : undefined}
      onContinue={msg.role === 'error' ? continueFromMessage : undefined}
    />
  )), [messages, streamingMessageId, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, continueFromMessage]);

  return (
    <div ref={containerRef} className="h-screen flex overflow-hidden bg-background">
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={
            isMobile
              ? 'fixed inset-y-0 left-0 z-40 bg-background shadow-xl'
              : 'relative shrink-0'
          }
          style={{ width: isMobile ? `${Math.min(sidebarWidth, 320)}px` : `${sidebarWidth}px` }}
        >
          <ChatSidebar />
          {/* Resize handle (desktop only) */}
          {!isMobile && (
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 transition-all ${
                isResizing ? 'bg-primary w-1.5' : 'bg-border hover:bg-primary/60'
              }`}
              onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
            />
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background/80 backdrop-blur shrink-0">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
              <span className="material-symbols-outlined text-lg">menu</span>
            </Button>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-gradient-to-br from-primary to-blue-600 rounded-md flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-white">bolt</span>
              </div>
              <span className="font-bold text-sm bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">AceFlow</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-48 hidden sm:block">
              <ModelSelect value={model} onChange={setModel} className="h-8 text-xs" />
            </div>
            <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
              <span className="material-symbols-outlined text-sm">add</span>
            </Button>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台">
              <span className="material-symbols-outlined text-sm sm:mr-1">dashboard</span>
              <span className="hidden sm:inline">控制台</span>
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-16">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-8">
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                  className="inline-flex p-3 bg-gradient-to-br from-primary to-blue-600 rounded-2xl mb-4"
                >
                  <span className="material-symbols-outlined text-3xl text-white">bolt</span>
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-500 to-purple-500 bg-clip-text text-transparent mb-2"
                >
                  AceFlow Multi-Agent 助手
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="text-sm text-muted-foreground"
                >
                  通过对话实现全流程 Multi-Agent 智能编排
                </motion.p>
              </div>
              <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} />
            </div>
          )}
          {renderedMessages}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3 md:px-8 lg:px-16">
          {messages.length > 0 && (
            <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
          )}
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <div className="flex-1">
              <RichTextEditor
                ref={editorRef}
                onEnter={handleEditorEnter}
                onChange={(html, text) => setInput(text)}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                minHeight={42}
                maxHeight={200}
                disabled={loading}
                autoFocus={false}
              />
            </div>
            {loading ? (
              <Button className="rounded-xl h-[42px] px-4" variant="destructive" onClick={stopStreaming} title="停止生成">
                <span className="material-symbols-outlined text-lg">stop</span>
              </Button>
            ) : (
              <Button className="rounded-xl h-[42px] px-4" onClick={handleSend} disabled={!input.trim() && !editorRef.current?.getText()?.trim()}>
                <span className="material-symbols-outlined text-lg">send</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatPageContent />
    </AuthGuard>
  );
}
