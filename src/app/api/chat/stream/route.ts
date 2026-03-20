import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';

const SESSIONS_DIR = resolve(process.cwd(), 'data', 'chat-sessions');
const MAX_HISTORY_CHARS = 6000;

/**
 * Load chat history from a frontend session file and format as context summary.
 * Returns empty string if session not found or no messages.
 */
async function loadChatHistory(frontendSessionId: string): Promise<string> {
  try {
    const filePath = resolve(SESSIONS_DIR, `${frontendSessionId}.json`);
    const content = await readFile(filePath, 'utf-8');
    const session = JSON.parse(content);
    const messages: { role: string; content: string }[] = session.messages || [];
    if (messages.length === 0) return '';

    // Build a condensed history: keep role + truncated content
    let history = '';
    for (const msg of messages) {
      if (!msg.content) continue;
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
      // Truncate long messages, remove action/card code blocks to save tokens
      let text = msg.content
        .replace(/```(?:action|card)\s*\n[\s\S]*?```/g, '[action/card block]')
        .trim();
      if (text.length > 500) text = text.slice(0, 500) + '...';
      history += `${role}: ${text}\n\n`;
      if (history.length > MAX_HISTORY_CHARS) break;
    }
    if (!history) return '';
    return `\n\n## 之前的对话记录（会话已过期重建，以下是历史上下文）\n${history.slice(0, MAX_HISTORY_CHARS)}`;
  } catch {
    return '';
  }
}

// Track active chat streams
const activeChats = new Map<string, { promise: Promise<any>; settled: boolean; chatId: string }>();

/**
 * Pre-check whether a claude session ID is still valid.
 * Spawns a lightweight `claude --output-format json` process without
 * --verbose/--include-partial-messages (which cause hangs on expired sessions).
 * Returns true if session is valid, false if expired/not found.
 */
function checkSessionValid(sessionId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION;
    delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    env.IS_SANDBOX = '1';

    const child = spawn('claude', [
      '--output-format', 'json',
      '-p', '.',
      '--resume', sessionId,
      '--dangerously-skip-permissions',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let resolved = false;
    let output = '';

    const done = (valid: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      console.log(`[checkSessionValid] sessionId=${sessionId}, valid=${valid}, output=${output.slice(0, 200)}`);
      resolve(valid);
    };

    const timer = setTimeout(() => {
      console.log(`[checkSessionValid] timeout for ${sessionId}`);
      done(false);
    }, 10_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      // JSON mode: error result contains "no conversation found" in errors array
      if (output.toLowerCase().includes('no conversation found')) {
        done(false);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.toLowerCase().includes('no conversation found')) {
        done(false);
      }
    });

    child.on('close', (code) => {
      // Process exited without triggering early detection.
      // code !== 0 or any error text = likely invalid
      const hasError = output.toLowerCase().includes('no conversation found')
        || output.toLowerCase().includes('is_error')
        || code !== 0;
      done(!hasError);
    });

    child.on('error', () => {
      done(false);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const { message, model, sessionId, frontendSessionId, mode } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const chatId = `chat-${Date.now()}`;
    const useModel = model || '';

    // On resume, skip full system prompt (session already has it).
    // Only send a lightweight skill-status reminder if skills changed.
    let systemPrompt = '';
    const isResume = !!sessionId;
    if (mode === 'dashboard') {
      const settings = await loadChatSettings();
      const enabledSkills = Object.entries(settings.skills)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (isResume) {
        // Lightweight reminder — just list enabled skill names
        systemPrompt = enabledSkills.length > 0
          ? `当前启用的 Skills: ${enabledSkills.join(', ')}。需要时查阅 skills/.claude/skills/{skill-name}/SKILL.md。`
          : '';
      } else {
        systemPrompt = await buildDashboardSystemPrompt(enabledSkills);
      }
    } else if (!isResume) {
      systemPrompt = DEFAULT_PROMPT;
    }

    // If resuming, pre-check whether the session is still valid.
    // The claude CLI hangs in pipe mode with --verbose on expired sessions,
    // so we do a lightweight probe first without those flags.
    let validResumeSid: string | undefined = undefined;
    if (isResume) {
      const valid = await checkSessionValid(sessionId);
      if (valid) {
        validResumeSid = sessionId;
      } else {
        // Rebuild full system prompt for new session
        if (mode === 'dashboard') {
          const settings = await loadChatSettings();
          const enabledSkills = Object.entries(settings.skills)
            .filter(([, v]) => v)
            .map(([k]) => k);
          systemPrompt = await buildDashboardSystemPrompt(enabledSkills);
        } else {
          systemPrompt = DEFAULT_PROMPT;
        }
        // Inject previous chat history so the new session has context
        if (frontendSessionId) {
          const history = await loadChatHistory(frontendSessionId);
          if (history) {
            systemPrompt += history;
          }
        }
      }
    }

    // Start execution — SSE will stream results
    const execPromise = processManager.executeClaudeCli(
      chatId, 'chat', 'chat', message, systemPrompt, useModel,
      {
        resumeSessionId: validResumeSid,
        appendSystemPrompt: !!validResumeSid && !!systemPrompt,
      }
    );
    const entry = { promise: execPromise, settled: false, chatId };
    activeChats.set(chatId, entry);
    execPromise
      .then(() => { entry.settled = true; })
      .catch(() => { entry.settled = true; })
      .finally(() => { setTimeout(() => activeChats.delete(chatId), 30000); });

    return NextResponse.json({ chatId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '启动失败' }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeChats.get(chatId);
  if (!entry) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        closed = true;
        processManager.off('stream', onStream);
        try { controller.close(); } catch {}
      };

      // Stream handler — forward text deltas
      const onStream = (evt: any) => {
        if (evt.id === chatId && evt.delta) {
          send('delta', { content: evt.delta });
        }
      };

      processManager.on('stream', onStream);
      send('connected', { chatId });

      // Wait for completion
      entry.promise
        .then((result: any) => {
          send('done', {
            result: result.result,
            sessionId: result.session_id,
            costUsd: result.cost_usd,
            durationMs: result.duration_ms,
            usage: result.usage,
            isError: result.is_error,
          });
        })
        .catch((err: any) => {
          send('error', { message: err.message || '执行失败' });
        })
        .finally(() => {
          cleanup();
        });

      // Cleanup on client disconnect (but don't kill the process — let it finish)
      request.signal.addEventListener('abort', () => {
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function DELETE(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const killed = processManager.killProcess(chatId);
  activeChats.delete(chatId);
  return NextResponse.json({ killed });
}
