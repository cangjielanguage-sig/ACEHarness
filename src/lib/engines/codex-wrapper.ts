/**
 * Codex Engine Wrapper
 *
 * Uses @openai/codex-sdk to run Codex CLI as an engine.
 * Streams JSONL events (agent_message, command_execution, etc.)
 */

import { EventEmitter } from 'events';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { fenced } from '../markdown-utils';

export class CodexEngineWrapper extends EventEmitter implements Engine {
  private currentThread: any = null;
  private codexInstance: any = null;
  private _abortController: AbortController | null = null;
  private lastBlockWasTool = false;

  private getThreadOptions(options: EngineOptions) {
    return {
      model: options.model || undefined,
      workingDirectory: options.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: 'never' as const,
      sandboxMode: 'danger-full-access' as const,
    };
  }

  getName(): string {
    return 'codex';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await import('@openai/codex-sdk');
    } catch { return false; }
    // Also verify we can locate the codex binary
    return this.findCodexPath() !== null;
  }

  /** Locate the codex CLI binary — check PATH first, then common locations. */
  private findCodexPath(): string | null {
    try {
      const { execSync } = require('child_process');
      return execSync('command -v codex', { encoding: 'utf-8', shell: '/bin/bash' }).trim();
    } catch {}
    const fs = require('fs');
    const commonPaths = [
      (process.env.HOME || '') + '/.local/bin/codex',
      '/usr/local/bin/codex',
      '/usr/bin/codex',
    ];
    for (const p of commonPaths) {
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    return null;
  }

  private emitText(content: string, appendToOutput = true): void {
    if (!content) return;
    if (appendToOutput) this.collectedOutput += content;
    this.emit('stream', {
      type: 'text',
      content,
    } as EngineStreamEvent);
  }

  private collectedOutput = '';

  private formatCommandExecution(command: string): string {
    const cmd = command || '';
    const cmdLines = cmd.split('\n');
    let content = `\n\n**🔧 bash**\n`;
    if (cmdLines.length <= 1 && cmd.length <= 120) {
      content += `\n💻 执行命令: \`${cmd}\`\n`;
    } else {
      content += `\n💻 执行命令 (${cmdLines.length} 行)\n`;
      content += `\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
    }
    return content;
  }

  private formatCommandResult(output: string, exitCode?: number): string {
    let resultText = (output || '').trim();
    if (exitCode !== 0 && exitCode != null) {
      resultText += resultText ? `\n(exit code: ${exitCode})` : `(exit code: ${exitCode})`;
    }
    if (!resultText) return '';
    const lines = resultText.split('\n');
    if (lines.length <= 15) {
      return `\n${fenced(resultText)}\n`;
    }
    return `\n<details><summary>查看输出 (${lines.length} 行)</summary>\n\n${fenced(resultText)}\n\n</details>\n`;
  }

  private formatFileChanges(changes: any[]): string {
    const summary = (changes || []).map((c: any) => `  ${c.kind}: ${c.path}`).join('\n');
    if (!summary) return '';
    return `\n\n**📝 文件变更**\n\n${fenced(summary)}\n`;
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    this._abortController = new AbortController();
    this.collectedOutput = '';
    this.lastBlockWasTool = false;
    try {
      const { Codex } = await import('@openai/codex-sdk');

      if (!this.codexInstance) {
        const codexPath = this.findCodexPath();
        this.codexInstance = new Codex(codexPath ? { codexPathOverride: codexPath } : {});
      }

      // Create or reuse thread
      if (options.sessionId) {
        this.currentThread = this.codexInstance.resumeThread(
          options.sessionId,
          this.getThreadOptions(options),
        );
      } else if (!this.currentThread) {
        this.currentThread = this.codexInstance.startThread(this.getThreadOptions(options));
      }

      // Build prompt
      let fullPrompt = '';
      if (options.systemPrompt) {
        fullPrompt += `# System Instructions\n\n${options.systemPrompt}\n\n`;
      }
      fullPrompt += `# Task\n\n${options.prompt}`;

      // Stream events
      const { events } = await this.currentThread.runStreamed(fullPrompt, {
        signal: this._abortController!.signal,
      });

      for await (const event of events) {
        switch (event.type) {
          case 'item.started': {
            const item = event.item;
            if (item.type === 'command_execution') {
              this.emitText(this.formatCommandExecution(item.command || ''));
              this.lastBlockWasTool = true;
            } else if (item.type === 'file_change') {
              const formatted = this.formatFileChanges((item as any).changes || []);
              if (formatted) {
                this.emitText(formatted);
                this.lastBlockWasTool = true;
              }
            }
            break;
          }
          case 'item.completed': {
            const item = event.item;
            if (item.type === 'agent_message') {
              const text = item.text || '';
              const prefix = this.lastBlockWasTool && !text.startsWith('\n')
                ? '\n\n<!-- chunk-boundary -->\n\n'
                : '';
              this.emitText(prefix + text);
              this.lastBlockWasTool = false;
            } else if (item.type === 'reasoning') {
              this.emit('stream', {
                type: 'thought',
                content: (item as any).text || '',
              } as EngineStreamEvent);
            } else if (item.type === 'command_execution') {
              const formatted = this.formatCommandResult((item as any).aggregated_output || '', (item as any).exit_code);
              if (formatted) this.emitText(formatted);
            } else if (item.type === 'file_change') {
              const formatted = this.formatFileChanges((item as any).changes || []);
              if (formatted) this.emitText(formatted);
            } else if (item.type === 'todo_list') {
              const items = (item as any).items || [];
              if (items.length > 0) {
                const done = items.filter((t: any) => t.completed).length;
                const todoHeader = `📋 任务列表 (${done}/${items.length} 完成)`;
                let content = `\n<!-- todo-list-marker -->\n<div class="ace-todo-list">\n<div class="ace-todo-header">${todoHeader}</div>\n`;
                content += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${Math.round((done / items.length) * 100)}%"></div></div>\n`;
                for (const t of items) {
                  const icon = t.completed ? '✅' : '⬜';
                  const cls = t.completed ? 'ace-todo-done' : 'ace-todo-pending';
                  content += `<div class="ace-todo-item ${cls}">${icon} ${t.text}</div>\n`;
                }
                content += `</div>\n`;
                this.emitText(content);
              }
            }
            break;
          }
          case 'error': {
            this.emit('stream', {
              type: 'error',
              content: event.message,
            } as EngineStreamEvent);
            break;
          }
          case 'turn.completed': {
            break;
          }
          case 'turn.failed': {
            const errMsg = (event as any).error?.message || 'Unknown error';
            this.emit('stream', {
              type: 'error',
              content: errMsg,
            } as EngineStreamEvent);
            return {
              success: false,
              output: this.collectedOutput,
              error: errMsg,
            };
          }
        }
      }

      return {
        success: true,
        output: this.collectedOutput,
        sessionId: this.currentThread?.id,
      };
    } catch (error: any) {
      // Abort is expected when cancel() is called
      if (error?.name === 'AbortError' || this._abortController?.signal.aborted) {
        return {
          success: true,
          output: this.collectedOutput || '',
          stopReason: 'cancelled',
        };
      }
      const errMsg = error.message || String(error);
      this.emit('stream', {
        type: 'text',
        content: `\n\n❌ Codex 错误: ${errMsg}\n`,
      } as EngineStreamEvent);
      return {
        success: false,
        output: '',
        error: errMsg,
      };
    }
  }

  cancel(): void {
    try { this._abortController?.abort(); } catch {}
    this.currentThread = null;
  }

  cleanup(): void {
    this.cancel();
    this.codexInstance = null;
    this.removeAllListeners();
  }
}
