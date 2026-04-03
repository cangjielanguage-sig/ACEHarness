/**
 * Claude Agent SDK — plan 模式引擎（进程内 query，非 CLI spawn）
 * 用于 useSdkPlan 步骤：permissionMode plan + AskUserQuestion 桥接到前端。
 */

import { EventEmitter } from 'events';
import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { loadEnvVars, buildEnvObject } from '../env-manager';

export type SdkPlanCapturedVia =
  | 'canUseTool_write'
  | 'stop_hook'
  | 'output_parse'
  | 'filesystem';

const CAPTURE_PRIORITY: Record<SdkPlanCapturedVia, number> = {
  canUseTool_write: 0,
  stop_hook: 1,
  output_parse: 2,
  filesystem: 3,
};

function priorityOf(via: SdkPlanCapturedVia | ''): number {
  return via ? CAPTURE_PRIORITY[via] : 999;
}

function extractTextFromStreamEvent(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const e = event as { type?: string; delta?: unknown };
  if (e.type !== 'content_block_delta' || !e.delta || typeof e.delta !== 'object') return '';
  const d = e.delta as { type?: string; text?: string };
  if (d.type === 'text_delta' && typeof d.text === 'string') return d.text;
  return '';
}

function extractAssistantText(msg: { message?: { content?: unknown } }): string {
  const content = msg.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: { type?: string; text?: string }) => {
      if (block?.type === 'text' && typeof block.text === 'string') return block.text;
      return '';
    })
    .join('');
}

/** 供 SSE / 工作台横幅展示 */
export type SdkPlanSubtaskTelemetry = {
  phase: 'start' | 'progress' | 'tool' | 'end';
  taskId: string;
  description: string;
  elapsedSec: number;
  detail?: string;
  toolName?: string;
  terminalStatus?: 'completed' | 'failed' | 'stopped';
  summary?: string;
  outputFile?: string;
};

function shortTaskId(id: string): string {
  if (!id) return '?';
  return id.length <= 12 ? id : `${id.slice(0, 10)}…`;
}

function clip(s: string, max = 200): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function formatElapsedSec(usageMs?: number, wallMs?: number): { text: string; sec: number } {
  const ms = usageMs ?? wallMs;
  if (ms == null || ms < 0) return { text: '?', sec: 0 };
  const sec = ms / 1000;
  const text = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));
  return { text, sec };
}

export async function readLatestPlanFile(
  workDir: string
): Promise<{ path: string; content: string } | null> {
  const plansDir = join(workDir, '.claude', 'plans');
  if (!existsSync(plansDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  try {
    const files = await readdir(plansDir);
    for (const name of files) {
      const p = join(plansDir, name);
      const st = await stat(p).catch(() => null);
      if (st?.isFile()) {
        if (!best || st.mtimeMs > best.mtime) {
          best = { path: p, mtime: st.mtimeMs };
        }
      }
    }
  } catch {
    return null;
  }
  if (!best) return null;
  try {
    const content = await readFile(best.path, 'utf-8');
    return { path: best.path, content };
  } catch {
    return null;
  }
}

/** 扩展 EventEmitter 的自定义事件与 Engine 接口的 stream 并存；不显式 implements Engine 以免收窄 .on/.off */
export class ClaudeSdkPlanEngine extends EventEmitter {
  private _capturedDeliverable = '';
  private _planFilePath = '';
  private _capturedVia: SdkPlanCapturedVia | '' = '';
  private _abortController: AbortController | null = null;
  private _pendingQuestionResolver: ((answers: Record<string, string>) => void) | null = null;
  private _pendingQuestion: Record<string, unknown> | null = null;

  get capturedDeliverable(): string {
    return this._capturedDeliverable;
  }

  get planFilePath(): string {
    return this._planFilePath;
  }

  get capturedVia(): SdkPlanCapturedVia | '' {
    return this._capturedVia;
  }

  setCapturedDeliverable(content: string, filePath: string, via: SdkPlanCapturedVia): void {
    if (!content?.trim()) return;
    const incomingP = priorityOf(via);
    const currentP = priorityOf(this._capturedVia);
    // 高优先级（数值小）覆盖低优先级；同优先级取最新写入
    if (this._capturedVia && incomingP > currentP) return;
    this._capturedDeliverable = content;
    this._planFilePath = filePath;
    this._capturedVia = via;
    this.emit('plan-file-captured', { path: filePath, length: content.length, via });
  }

  getPendingQuestion(): Record<string, unknown> | null {
    return this._pendingQuestion;
  }

  submitAnswers(answers: Record<string, string>): void {
    if (this._pendingQuestionResolver) {
      this._pendingQuestionResolver(answers);
      this._pendingQuestionResolver = null;
      this._pendingQuestion = null;
    }
  }

  cancel(): void {
    try {
      this._abortController?.abort();
    } catch {
      /* ignore */
    }
  }

  getName(): string {
    return 'claude-sdk-plan';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await import('@anthropic-ai/claude-agent-sdk');
    } catch {
      return false;
    }
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }

  private maybeParsePlanFromOutput(text: string): void {
    if (!text?.trim()) return;
    const fence = /```(?:plan|markdown)?\s*([\s\S]*?)```/i.exec(text);
    if (fence?.[1]?.trim()) {
      this.setCapturedDeliverable(fence[1].trim(), '(parsed-from-output)', 'output_parse');
    }
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    this._abortController = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    const timer = setTimeout(() => {
      try {
        this._abortController?.abort();
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    let accumulated = '';
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const userFacingPrompt = options.systemPrompt?.trim()
        ? `# 系统指令\n${options.systemPrompt}\n\n---\n\n# 任务与上下文\n${options.prompt}`
        : options.prompt;

      const spawnEnv: Record<string, string | undefined> = { ...process.env };
      delete spawnEnv.CLAUDECODE;
      delete spawnEnv.CLAUDE_CODE_ENTRYPOINT;
      delete spawnEnv.CLAUDE_CODE_SESSION;
      delete spawnEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
      spawnEnv.IS_SANDBOX = '1';
      try {
        const userEnvVars = await loadEnvVars();
        const userEnv = buildEnvObject(userEnvVars);
        Object.assign(spawnEnv, userEnv);
      } catch { /* non-critical */ }

      const iter = query({
        prompt: userFacingPrompt,
        options: {
          env: spawnEnv,
          cwd: options.workingDirectory,
          model: options.model,
          permissionMode: 'plan',
          includePartialMessages: true,
          abortController: this._abortController,
          canUseTool: async (toolName, input) => {
            if (toolName === 'AskUserQuestion') {
              const questions = (input as { questions?: unknown }).questions ?? [];
              this._pendingQuestion = input as Record<string, unknown>;
              this.emit('ask-user-question', { questions });
              this.emit('stream', {
                type: 'text',
                content: '\n⏳ 等待用户回答问题…\n',
              } satisfies EngineStreamEvent);
              const answers = await new Promise<Record<string, string>>((resolve) => {
                this._pendingQuestionResolver = resolve;
              });
              const formatted = Object.entries(answers)
                .map(([k, v]) => `- ${k}: ${v}`)
                .join('\n');
              this.emit('stream', {
                type: 'text',
                content: `\n✅ 用户已回答:\n${formatted}\n`,
              } satisfies EngineStreamEvent);
              return {
                behavior: 'allow' as const,
                updatedInput: { ...(input as Record<string, unknown>), answers },
              };
            }
            if (toolName === 'Write') {
              const ti = input as Record<string, unknown>;
              const filePath = String(ti.file_path ?? ti.filePath ?? '');
              const content = String(ti.content ?? '');
              if (
                (filePath.includes('.claude/plans') || filePath.includes('.claude\\plans')) &&
                content.trim()
              ) {
                this.setCapturedDeliverable(content, filePath, 'canUseTool_write');
              }
              return { behavior: 'allow' as const, updatedInput: input };
            }
            return { behavior: 'allow' as const, updatedInput: input };
          },
          maxTurns: 80,
        },
      });

      const taskStartedAt = new Map<string, number>();

      for await (const msg of iter) {
        if (msg.type === 'assistant') {
          const t = extractAssistantText(msg as { message?: { content?: unknown } });
          if (t) {
            accumulated += t;
            this.emit('stream', { type: 'text', content: t } satisfies EngineStreamEvent);
          }
        } else if (msg.type === 'stream_event') {
          const ev = (msg as { event?: unknown }).event;
          const piece = extractTextFromStreamEvent(ev);
          if (piece) {
            accumulated += piece;
            this.emit('stream', { type: 'text', content: piece } satisfies EngineStreamEvent);
          }
        } else if (msg.type === 'tool_progress') {
          const tp = msg as {
            tool_use_id: string;
            tool_name: string;
            elapsed_time_seconds: number;
            task_id?: string;
          };
          const tid = tp.task_id || tp.tool_use_id;
          const desc = `工具「${tp.tool_name}」执行中`;
          const line = `\n[工具进行中] ${desc} · ⏱ ${tp.elapsed_time_seconds.toFixed(1)}s · 子任务 #${shortTaskId(tid)}\n`;
          accumulated += line;
          this.emit('stream', { type: 'text', content: line } satisfies EngineStreamEvent);
          this.emit('sdk-plan-subtask', {
            phase: 'tool',
            taskId: tid,
            description: desc,
            elapsedSec: tp.elapsed_time_seconds,
            toolName: tp.tool_name,
            detail: `tool_use_id=${tp.tool_use_id}`,
          } satisfies SdkPlanSubtaskTelemetry);
        } else if (msg.type === 'system') {
          const sys = msg as { subtype?: string; message?: string; tool_name?: string };

          if (sys.subtype === 'task_started') {
            const t = msg as {
              task_id: string;
              description?: string;
              task_type?: string;
              workflow_name?: string;
              prompt?: string;
            };
            taskStartedAt.set(t.task_id, Date.now());
            const doing = clip(t.description || t.prompt || '(无描述)');
            const meta = [
              t.task_type ? `类型 ${t.task_type}` : null,
              t.workflow_name ? `工作流 ${t.workflow_name}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const line = `\n[子任务·启动] #${shortTaskId(t.task_id)} · 在做什么：${doing}${meta ? ` · ${meta}` : ''} · ⏱ 0s\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } satisfies EngineStreamEvent);
            this.emit('sdk-plan-subtask', {
              phase: 'start',
              taskId: t.task_id,
              description: doing,
              elapsedSec: 0,
              detail: meta || undefined,
            } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }

          if (sys.subtype === 'task_progress') {
            const t = msg as {
              task_id: string;
              description?: string;
              last_tool_name?: string;
              summary?: string;
              usage?: { duration_ms?: number; tool_uses?: number; total_tokens?: number };
            };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            const { text: elapsedText, sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const doing = clip(t.description || t.summary || '(进行中)');
            const bits = [
              `在做什么：${doing}`,
              t.last_tool_name ? `最近工具：${t.last_tool_name}` : null,
              t.summary && t.summary !== t.description ? `进度摘要：${clip(t.summary, 120)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const detailExtra = [
              t.last_tool_name ? `最近工具：${t.last_tool_name}` : null,
              t.summary && t.summary !== t.description ? `进度摘要：${clip(t.summary, 120)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const line = `\n[子任务·进行中] #${shortTaskId(t.task_id)} · ${bits} · ⏱ ${elapsedText}s\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } satisfies EngineStreamEvent);
            this.emit('sdk-plan-subtask', {
              phase: 'progress',
              taskId: t.task_id,
              description: doing,
              elapsedSec,
              detail: detailExtra || undefined,
              toolName: t.last_tool_name,
            } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }

          if (sys.subtype === 'task_notification') {
            const t = msg as {
              task_id: string;
              status: 'completed' | 'failed' | 'stopped';
              summary?: string;
              output_file?: string;
              usage?: { duration_ms?: number };
            };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            taskStartedAt.delete(t.task_id);
            const { text: elapsedText, sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const statusCn: Record<string, string> = {
              completed: '已完成',
              failed: '失败',
              stopped: '已停止',
            };
            const sum = clip(t.summary || '(无摘要)', 240);
            const line = `\n[子任务·${statusCn[t.status] ?? t.status}] #${shortTaskId(t.task_id)} · ${sum} · ⏱ ${elapsedText}s${t.output_file ? ` · 输出 ${t.output_file}` : ''}\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } satisfies EngineStreamEvent);
            this.emit('sdk-plan-subtask', {
              phase: 'end',
              taskId: t.task_id,
              description: sum,
              elapsedSec,
              terminalStatus: t.status,
              summary: t.summary,
              outputFile: t.output_file,
            } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }

          let info = '';
          if (sys.subtype === 'api_retry') {
            const retry = msg as { attempt?: number; retry_delay_ms?: number };
            info = `[SDK] API 重试 #${retry.attempt ?? '?'}，等待 ${Math.round((retry.retry_delay_ms ?? 0) / 1000)}s…`;
          } else if (sys.message) {
            info = `[SDK] ${sys.subtype ?? 'system'}: ${sys.message}`;
          } else if (sys.subtype) {
            info = `[SDK] ${sys.subtype}`;
          }
          if (info) {
            accumulated += `\n${info}\n`;
            this.emit('stream', { type: 'text', content: `\n${info}\n` } satisfies EngineStreamEvent);
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            const r = msg as { result?: string; session_id?: string };
            const resultText = r.result ?? '';
            if (resultText) {
              this.maybeParsePlanFromOutput(resultText);
              if (!accumulated.includes(resultText.slice(0, Math.min(80, resultText.length)))) {
                accumulated += (accumulated ? '\n\n' : '') + resultText;
                this.emit('stream', { type: 'text', content: resultText } satisfies EngineStreamEvent);
              }
            }
            const fsHit = await readLatestPlanFile(options.workingDirectory);
            if (fsHit?.content?.trim()) {
              this.setCapturedDeliverable(fsHit.content, fsHit.path, 'filesystem');
            }
            return {
              success: true,
              output: this._capturedDeliverable || accumulated || resultText,
              sessionId: r.session_id,
            };
          }
          const err = msg as { errors?: string[] };
          return {
            success: false,
            output: accumulated,
            error: err.errors?.join('; ') || 'SDK plan execution failed',
          };
        }
      }

      const fsHit = await readLatestPlanFile(options.workingDirectory);
            if (fsHit?.content?.trim()) {
              this.setCapturedDeliverable(fsHit.content, fsHit.path, 'filesystem');
            }

            // Ensure plan file is persisted to .claude/plans/ even when SDK didn't write one
            const planText = this._capturedDeliverable || accumulated;
            if (planText?.trim()) {
              try {
                const plansDir = join(options.workingDirectory, '.claude', 'plans');
                await mkdir(plansDir, { recursive: true });
                const filename = `plan-${Date.now()}.md`;
                await writeFile(join(plansDir, filename), planText, 'utf-8');
              } catch { /* best-effort */ }
            }

            return {
              success: true,
              output: this._capturedDeliverable || accumulated,
            };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        output: accumulated,
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
