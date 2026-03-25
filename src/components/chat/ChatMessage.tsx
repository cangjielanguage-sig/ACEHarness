'use client';

import { ActionState } from '@/lib/chat-actions';
import Markdown from '@/components/Markdown';
import ActionCard from './ActionCard';
import UniversalCard from './cards/UniversalCard';
import { memo } from 'react';

interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    actions?: ActionState[];
    cards?: any[];
    costUsd?: number;
    durationMs?: number;
    usage?: { input_tokens: number; output_tokens: number };
  };
  isStreaming?: boolean;
  onConfirmAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onUndoAction: (actionId: string) => void;
  onRetryAction: (actionId: string) => void;
  onAction?: (prompt: string) => void;
  onDelete?: (messageId: string) => void;
  onRetryFromMessage?: (messageId: string) => void;
  onContinue?: (messageId: string) => void; // For timeout recovery
}

function ThinkingBot() {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <svg className="shrink-0 animate-[botBounce_1.2s_ease-in-out_infinite]" width="28" height="28" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cbBody" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6C8EF2" />
            <stop offset="100%" stopColor="#4A6CF7" />
          </linearGradient>
          <linearGradient id="cbFace" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E8F0FE" />
            <stop offset="100%" stopColor="#C5D8F9" />
          </linearGradient>
        </defs>
        <g transform="translate(0,800) scale(0.1,-0.1)" stroke="none">
          <path fill="url(#cbBody)" d="M4552 6155 c-67 -19 -85 -29 -136 -74 -30 -27 -60 -42 -111 -55 -332 -85 -548 -304 -619 -627 l-17 -75 -67 -12 c-140 -24 -291 -88 -355 -150 -42 -40 -87 -123 -87 -159 0 -14 -6 -23 -16 -23 -25 0 -186 -67 -325 -136 -137 -67 -286 -164 -381 -247 -94 -82 -217 -242 -279 -363 -30 -58 -58 -108 -64 -109 -92 -25 -102 -30 -155 -84 -67 -66 -128 -183 -161 -307 -32 -121 -38 -325 -11 -429 28 -112 67 -188 131 -258 61 -65 116 -96 172 -97 33 0 37 -3 48 -40 18 -60 103 -180 179 -251 200 -190 486 -332 852 -425 408 -104 751 -110 1225 -23 290 54 481 113 670 209 257 130 410 270 525 483 37 69 60 94 60 68 0 -16 86 -24 122 -12 159 52 236 422 168 803 -40 221 -177 406 -286 385 -22 -4 -28 2 -51 47 -96 190 -259 360 -505 527 -130 88 -335 191 -465 234 -54 17 -83 32 -83 41 0 20 -27 71 -59 112 -36 46 -143 115 -235 152 -74 30 -248 70 -302 70 -25 0 -26 2 -20 38 4 20 25 75 47 121 68 138 167 224 333 286 l66 25 15 -29 c21 -42 90 -98 143 -115 58 -20 157 -20 212 -1 58 20 115 68 148 123 22 39 27 58 26 112 -1 111 -54 199 -148 245 -66 32 -136 39 -204 20z" />
          <path fill="url(#cbFace)" d="M3640 4394 c-194 -14 -558 -57 -625 -74 -224 -57 -381 -189 -480 -403 -56 -121 -76 -219 -82 -402 -6 -197 14 -311 77 -443 108 -225 363 -358 801 -418 179 -25 751 -25 1014 0 331 31 463 65 601 158 133 89 235 248 291 453 26 93 27 113 27 295 0 185 -2 199 -28 280 -43 131 -82 196 -171 286 -68 68 -97 89 -185 133 -215 105 -383 132 -845 136 -187 1 -365 1 -395 -1z" />
          <path fill="#2D3748" d="M3163 3865 c-156 -43 -257 -181 -257 -350 0 -144 60 -254 171 -312 78 -40 140 -50 218 -34 103 22 178 79 226 174 87 171 73 314 -42 429 -90 90 -205 124 -316 93z">
            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
          </path>
          <path fill="#2D3748" d="M4373 3856 c-100 -32 -195 -114 -236 -204 -17 -37 -22 -66 -22 -137 0 -82 3 -97 33 -157 37 -77 90 -128 172 -167 47 -22 69 -26 145 -26 78 0 98 4 153 29 212 98 257 390 86 560 -92 92 -231 135 -331 102z">
            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
          </path>
        </g>
      </svg>
      <span className="text-[13px] text-muted-foreground">思考中</span>
      <span className="inline-flex gap-px text-lg font-bold text-muted-foreground">
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite_0.2s]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite_0.4s]">.</span>
      </span>
    </div>
  );
}

export default memo(function ChatMessage({ message, isStreaming, onConfirmAction, onRejectAction, onUndoAction, onRetryAction, onAction, onDelete, onRetryFromMessage, onContinue }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="group flex justify-end mb-4 items-start gap-1">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          {onRetryFromMessage && (
            <button onClick={() => onRetryFromMessage(message.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="重试">
              <span className="material-symbols-outlined text-sm">refresh</span>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
        <div className="max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    const isTimeout = message.content.includes('超时') || message.content.includes('timeout');
    return (
      <div className="group flex mb-4 items-start gap-1">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-destructive/10 text-destructive text-sm">
          <span className="material-symbols-outlined text-sm mr-1 align-middle">{isTimeout ? 'schedule' : 'error'}</span>
          {message.content}
          {isTimeout && onContinue && (
            <button
              onClick={() => onContinue(message.id)}
              className="ml-2 px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30 text-xs"
            >
              继续
            </button>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="group flex mb-4 items-start gap-1">
      <div className="max-w-[85%] space-y-1">
        {isStreaming && !message.content && <ThinkingBot />}
        {message.content && (
          <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 bg-muted text-sm prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <Markdown>{message.content}</Markdown>
            {isStreaming && <span className="inline-block w-0.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />}
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
        {message.cards?.map((card, i) => (
          <UniversalCard key={i} card={card} onAction={onAction} />
        ))}
        {(message.usage || message.costUsd !== undefined || message.durationMs !== undefined) && (
          <div className="text-xs text-muted-foreground px-1 opacity-60">
            {message.usage && `${message.usage.input_tokens}↓ ${message.usage.output_tokens}↑`}
            {message.costUsd !== undefined && ` · $${message.costUsd.toFixed(4)}`}
            {message.durationMs !== undefined && ` · ${(message.durationMs / 1000).toFixed(1)}s`}
          </div>
        )}
      </div>
      {!isStreaming && onDelete && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      )}
    </div>
  );
});
