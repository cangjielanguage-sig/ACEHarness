'use client';

import { ActionState } from '@/lib/chat-actions';
import Markdown from '@/components/Markdown';
import ActionCard from './ActionCard';

interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    actions?: ActionState[];
    costUsd?: number;
    durationMs?: number;
    usage?: { input_tokens: number; output_tokens: number };
  };
  onConfirmAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onUndoAction: (actionId: string) => void;
  onRetryAction: (actionId: string) => void;
  onAction?: (prompt: string) => void;
}

export default function ChatMessage({ message, onConfirmAction, onRejectAction, onUndoAction, onRetryAction, onAction }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="flex mb-4">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-destructive/10 text-destructive text-sm">
          <span className="material-symbols-outlined text-sm mr-1 align-middle">error</span>
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex mb-4">
      <div className="max-w-[85%] space-y-1">
        {message.content && (
          <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 bg-muted text-sm prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
        {message.actions?.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onConfirm={() => onConfirmAction(action.id)}
            onReject={() => onRejectAction(action.id)}
            onUndo={() => onUndoAction(action.id)}
            onRetry={() => onRetryAction(action.id)}
            onAction={onAction}
          />
        ))}
        {(message.usage || message.costUsd !== undefined || message.durationMs !== undefined) && (
          <div className="text-xs text-muted-foreground px-1 opacity-60">
            {message.usage && `${message.usage.input_tokens}↓ ${message.usage.output_tokens}↑`}
            {message.costUsd !== undefined && ` · $${message.costUsd.toFixed(4)}`}
            {message.durationMs !== undefined && ` · ${(message.durationMs / 1000).toFixed(1)}s`}
          </div>
        )}
      </div>
    </div>
  );
}
