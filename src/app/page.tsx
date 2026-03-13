'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { ModelSelect } from '@/components/ModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatMessage from '@/components/chat/ChatMessage';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';

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

export default function ChatPage() {
  const router = useRouter();
  const {
    activeSession, sessions, createSession, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage,
    loading, streamingMessageId,
    model, setModel, confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings,
  } = useChat();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  // --- Resizable sidebar state ---
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // --- Swipe gesture for mobile ---
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    if (dy > 80) return; // ignore vertical swipes
    if (dx > 60 && !sidebarOpen) setSidebarOpen(true);
    if (dx < -60 && sidebarOpen) setSidebarOpen(false);
  }, [sidebarOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSession?.id]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    await sendMessage(text);
    inputRef.current?.focus();
  }, [input, loading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleQuickAction = (prompt: string) => {
    if (prompt && !prompt.includes('\n')) {
      setInput('');
      sendMessage(prompt);
    } else {
      setInput(prompt);
      inputRef.current?.focus();
    }
  };

  const messages = activeSession?.messages || [];

  return (
    <div ref={containerRef} className="h-screen flex overflow-hidden bg-background" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
            <span className="font-semibold text-sm">AceFlow 对话</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-48 hidden sm:block">
              <ModelSelect value={model} onChange={setModel} className="h-8 text-xs" />
            </div>
            <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
              <span className="material-symbols-outlined text-sm">add</span>
            </Button>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台" className="hidden sm:inline-flex">
              <span className="material-symbols-outlined text-sm mr-1">dashboard</span>
              控制台
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
                  AceFlow 对话助手
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="text-sm text-muted-foreground"
                >
                  通过对话管理工作流、Agent、模型和 Skills
                </motion.p>
              </div>
              <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} />
            </div>
          )}
          {messages.map(msg => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isStreaming={msg.id === streamingMessageId}
              onConfirmAction={(id) => confirmAction(msg.id, id)}
              onRejectAction={(id) => rejectAction(msg.id, id)}
              onUndoAction={(id) => undoActionById(msg.id, id)}
              onRetryAction={(id) => retryAction(msg.id, id)}
              onAction={handleQuickAction}
              onDelete={deleteMessage}
              onRetryFromMessage={msg.role === 'user' ? retryFromMessage : undefined}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3 md:px-8 lg:px-16">
          {messages.length > 0 && (
            <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
          )}
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[42px] max-h-32"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              disabled={loading}
            />
            {loading ? (
              <Button className="rounded-xl h-[42px] px-4" variant="destructive" onClick={stopStreaming} title="停止生成">
                <span className="material-symbols-outlined text-lg">stop</span>
              </Button>
            ) : (
              <Button className="rounded-xl h-[42px] px-4" onClick={handleSend} disabled={!input.trim()}>
                <span className="material-symbols-outlined text-lg">send</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
