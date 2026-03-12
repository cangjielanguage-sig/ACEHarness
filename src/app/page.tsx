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

export default function ChatPage() {
  const router = useRouter();
  const {
    activeSession, sessions, createSession, sendMessage, loading,
    model, setModel, confirmAction, rejectAction, undoActionById, retryAction,
  } = useChat();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    setInput(prompt);
    inputRef.current?.focus();
    // Auto-send if it looks like a direct command
    if (prompt && !prompt.includes('\n')) {
      setTimeout(() => sendMessage(prompt), 100);
    }
  };

  const messages = activeSession?.messages || [];

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {sidebarOpen && <ChatSidebar />}

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
            <div className="w-48">
              <ModelSelect value={model} onChange={setModel} className="h-8 text-xs" />
            </div>
            <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
              <span className="material-symbols-outlined text-sm">add</span>
            </Button>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台">
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
              <QuickActions onAction={handleQuickAction} />
            </div>
          )}
          {messages.map(msg => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onConfirmAction={(actionId) => confirmAction(msg.id, actionId)}
              onRejectAction={(actionId) => rejectAction(msg.id, actionId)}
              onUndoAction={(actionId) => undoActionById(msg.id, actionId)}
              onRetryAction={(actionId) => retryAction(msg.id, actionId)}
              onAction={handleQuickAction}
            />
          ))}
          {loading && (
            <div className="flex mb-4">
              <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-muted">
                <div className="flex gap-1 text-muted-foreground">
                  <span className="animate-bounce">●</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3 md:px-8 lg:px-16">
          {messages.length > 0 && (
            <QuickActionsBar onAction={handleQuickAction} />
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
            <Button className="rounded-xl h-[42px] px-4" onClick={handleSend} disabled={loading || !input.trim()}>
              <span className="material-symbols-outlined text-lg">send</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
