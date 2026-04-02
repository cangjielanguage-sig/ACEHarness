/**
 * OpenCode Engine Wrapper
 *
 * Wraps OpenCodeEngine to implement the Engine interface
 */

import { EventEmitter } from 'events';
import { OpenCodeEngine } from './opencode';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { fenced } from '../markdown-utils';

export class OpenCodeEngineWrapper extends EventEmitter implements Engine {
  private engine: OpenCodeEngine | null = null;
  private currentSessionId: string | null = null;

  getName(): string {
    return 'opencode';
  }

  private lastBlockWasTool = false;
  /** Track tool IDs that have already emitted their header. */
  private seenToolIds = new Set<string>();
  /** Gate: only emit stream events when actively processing a new prompt. */
  private streaming = false;

  /**
   * Resolve the actual tool name from ACP event data.
   * ACP `kind` is lossy (write→edit, bash→execute), so we infer from rawInput fields.
   */
  private resolveToolName(toolCall: any): string {
    const title = (toolCall.title || '').toLowerCase();
    const rawInput = toolCall.rawInput || {};

    // Direct match on known tool names in title
    const knownTools = ['bash', 'write', 'edit', 'read', 'glob', 'grep', 'task', 'todowrite', 'todo', 'webfetch', 'websearch', 'ls', 'multiedit', 'patch'];
    if (knownTools.includes(title)) return title;

    // Infer from rawInput fields
    if ('command' in rawInput) return 'bash';
    if ('content' in rawInput && 'filePath' in rawInput && !('oldString' in rawInput)) return 'write';
    if ('oldString' in rawInput || 'newString' in rawInput) return 'edit';
    if ('todos' in rawInput) return 'todowrite';
    if ('pattern' in rawInput && 'include' in rawInput) return 'grep';
    if ('pattern' in rawInput) return 'glob';
    if ('description' in rawInput && 'prompt' in rawInput) return 'task';
    if ('url' in rawInput) return 'webfetch';
    if ('query' in rawInput) return 'websearch';
    if ('filePath' in rawInput) return 'read';

    return title || 'tool';
  }

  /**
   * Format tool call into structured markdown, matching Claude Code's process-manager output.
   */
  private formatToolCall(toolCall: any): string {
    const toolName = this.resolveToolName(toolCall);
    const rawInput = toolCall.rawInput || {};
    let header = `\n\n**🔧 ${toolCall.title || toolName}**\n`;

    switch (toolName) {
      case 'bash': {
        const cmd = rawInput.command || '';
        if (cmd) {
          const cmdLines = cmd.split('\n');
          if (cmdLines.length <= 1 && cmd.length <= 120) {
            header += `\n💻 执行命令: \`${cmd}\`\n`;
          } else {
            header += `\n💻 执行命令 (${cmdLines.length} 行)\n`;
            header += `\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
          }
        }
        break;
      }
      case 'write': {
        const wPath = rawInput.filePath || '';
        const wContent = rawInput.content || '';
        const wLines = wContent ? wContent.split('\n').length : 0;
        header += `\n📝 写入文件: \`${wPath}\` (${wLines} 行)\n`;
        if (wContent) {
          const ext = wPath.split('.').pop() || '';
          header += `\n<details><summary>查看内容 (${wLines} 行)</summary>\n\n${fenced(wContent, ext)}\n\n</details>\n`;
        }
        break;
      }
      case 'edit':
      case 'multiedit':
      case 'patch': {
        const filePath = rawInput.filePath || '';
        const oldStr = rawInput.oldString || '';
        const newStr = rawInput.newString || '';
        const oldLines = oldStr ? oldStr.split('\n').length : 0;
        const newLines = newStr ? newStr.split('\n').length : 0;
        const added = Math.max(0, newLines - oldLines);
        const removed = Math.max(0, oldLines - newLines);
        let stats = `${Math.min(oldLines, newLines)} 行修改`;
        if (added > 0) stats += `, +${added} 行`;
        if (removed > 0) stats += `, -${removed} 行`;
        header += `\n✏️ 编辑文件: \`${filePath}\` (${stats})\n`;
        if (oldStr || newStr) {
          const diffContent = (oldStr ? oldStr.split('\n').map((l: string) => '- ' + l).join('\n') + '\n' : '')
            + (newStr ? newStr.split('\n').map((l: string) => '+ ' + l).join('\n') + '\n' : '');
          header += `\n<details><summary>查看变更 (${stats})</summary>\n\n${fenced(diffContent.trimEnd(), 'diff')}\n\n</details>\n`;
        }
        break;
      }
      case 'read':
        header += `\n📖 读取文件: \`${rawInput.filePath || ''}\`\n`;
        break;
      case 'glob':
        header += `\n🔍 搜索文件: \`${rawInput.pattern || ''}\`\n`;
        break;
      case 'grep':
        header += `\n🔍 搜索内容: \`${rawInput.pattern || ''}\`\n`;
        break;
      case 'ls':
        header += `\n📂 列出目录: \`${rawInput.path || '.'}\`\n`;
        break;
      case 'task':
        header += `\n🤖 启动子任务: ${rawInput.description || ''}\n`;
        break;
      case 'todowrite':
      case 'todo': {
        const todos = rawInput.todos || rawInput.items || [];
        if (Array.isArray(todos) && todos.length > 0) {
          const done = todos.filter((t: any) => t.status === 'completed' || t.status === 'done').length;
          const inProg = todos.filter((t: any) => t.status === 'in_progress' || t.status === 'in-progress').length;
          const todoHeader = `📋 任务列表 (${done}/${todos.length} 完成${inProg ? `, ${inProg} 进行中` : ''})`;
          header = `\n<!-- todo-list-marker -->\n<div class="ace-todo-list">\n<div class="ace-todo-header">${todoHeader}</div>\n`;
          header += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${Math.round(((done + inProg * 0.5) / todos.length) * 100)}%"></div></div>\n`;
          for (const t of todos) {
            const st = t.status || 'pending';
            const icon = st === 'completed' || st === 'done' ? '✅' : st === 'in_progress' || st === 'in-progress' ? '🔄' : '⬜';
            const cls = st === 'completed' || st === 'done' ? 'ace-todo-done' : st === 'in_progress' || st === 'in-progress' ? 'ace-todo-active' : 'ace-todo-pending';
            header += `<div class="ace-todo-item ${cls}">${icon} ${t.content || ''}</div>\n`;
          }
          header += `</div>\n`;
        } else {
          header = `\n<!-- todo-list-marker -->\n📋 任务列表更新中...\n`;
        }
        break;
      }
      case 'webfetch':
        header += `\n🌐 获取网页: \`${rawInput.url || ''}\`\n`;
        break;
      case 'websearch':
        header += `\n🔎 搜索: \`${rawInput.query || ''}\`\n`;
        break;
    }
    return header;
  }

  /**
   * Format tool result into structured markdown.
   */
  private formatToolResult(output: string, metadata: any): string {
    if (!output) return '';

    // Parse <path>...<content>... blocks from Read/Glob tool results
    const parsed = this.parseToolXmlOutput(output);
    if (parsed) return parsed;

    const lines = output.split('\n');
    if (lines.length <= 15) {
      return `\n${fenced(output)}\n`;
    }
    return `\n<details><summary>查看输出 (${lines.length} 行)</summary>\n\n${fenced(output)}\n\n</details>\n`;
  }

  /**
   * Parse XML-style tool output (<path>, <content>, <task_result>) into markdown.
   */
  private parseToolXmlOutput(output: string): string | null {
    // Handle <task_result> blocks
    const taskMatch = output.match(/<task_result>([\s\S]*?)<\/task_result>/);
    if (taskMatch) {
      const inner = taskMatch[1].trim();
      const lines = inner.split('\n');
      return `\n<details><summary>🤖 子任务结果 (${lines.length} 行)</summary>\n\n${fenced(inner)}\n\n</details>\n`;
    }

    // Handle <path>...<content>... file read results (may have multiple)
    const pathRegex = /<path>(.*?)<\/path>\s*(?:<type>.*?<\/type>\s*)?<content>([\s\S]*?)<\/content>/g;
    let match;
    const blocks: string[] = [];
    while ((match = pathRegex.exec(output)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      const ext = filePath.split('.').pop() || '';
      const lines = content.split('\n');
      if (lines.length <= 15) {
        blocks.push(`\n${fenced(content, ext)}\n`);
      } else {
        blocks.push(`\n<details><summary>📄 ${filePath} (${lines.length} 行)</summary>\n\n${fenced(content, ext)}\n\n</details>\n`);
      }
    }
    if (blocks.length > 0) return blocks.join('');

    return null;
  }

  private setupEngineEvents(): void {
    if (!this.engine) return;

    this.engine.on('agent-message', (content) => {
      if (!this.streaming) return;
      if (content.type === 'text') {
        let prefix = '';
        if (this.lastBlockWasTool) {
          prefix = '\n\n<!-- chunk-boundary -->\n\n';
          this.lastBlockWasTool = false;
        }
        this.emit('stream', { type: 'text', content: prefix + content.text } as EngineStreamEvent);
      }
    });

    this.engine.on('agent-thought', (content) => {
      if (!this.streaming) return;
      if (content.type === 'text') {
        this.emit('stream', { type: 'thought', content: content.text } as EngineStreamEvent);
      }
    });

    this.engine.on('tool-call', (toolCall) => {
      if (!this.streaming) return;
      const toolId = toolCall.id || '';
      const hasInput = toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0;
      if (toolId && !this.seenToolIds.has(toolId) && hasInput) {
        this.seenToolIds.add(toolId);
        const formatted = this.formatToolCall(toolCall);
        this.lastBlockWasTool = true;
        this.emit('stream', { type: 'text', content: formatted, metadata: toolCall } as EngineStreamEvent);
      }
    });

    this.engine.on('tool-call-update', (toolUpdate) => {
      if (!this.streaming) return;
      const toolId = toolUpdate.id || '';

      // If this is the first time we see this tool, emit the header — but only if rawInput
      // is populated (ACP may send early updates with empty rawInput).
      const hasInput = toolUpdate.rawInput && Object.keys(toolUpdate.rawInput).length > 0;
      if (toolId && !this.seenToolIds.has(toolId) && toolUpdate.status !== 'completed' && toolUpdate.status !== 'failed' && hasInput) {
        this.seenToolIds.add(toolId);
        const formatted = this.formatToolCall(toolUpdate);
        this.lastBlockWasTool = true;
        this.emit('stream', { type: 'text', content: formatted, metadata: toolUpdate } as EngineStreamEvent);
      }

      if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
        // If we never emitted a header for this tool, do it now
        if (toolId && !this.seenToolIds.has(toolId)) {
          this.seenToolIds.add(toolId);
          const header = this.formatToolCall(toolUpdate);
          this.lastBlockWasTool = true;
          this.emit('stream', { type: 'text', content: header, metadata: toolUpdate } as EngineStreamEvent);
        }

        // Emit tool result
        let resultText = '';
        if (toolUpdate.rawOutput?.output) {
          resultText = toolUpdate.rawOutput.output;
        } else if (Array.isArray(toolUpdate.content)) {
          resultText = toolUpdate.content
            .filter((c: any) => c.type === 'content' && c.content?.type === 'text')
            .map((c: any) => c.content.text)
            .join('\n');
        } else if (typeof toolUpdate.content === 'string') {
          resultText = toolUpdate.content;
        }
        const formatted = this.formatToolResult(resultText, toolUpdate);
        if (formatted) {
          this.emit('stream', { type: 'text', content: formatted, metadata: toolUpdate } as EngineStreamEvent);
        }
      }
    });

    this.engine.on('log', (log) => {
      // Skip log events — not displayed in stream
    });

    this.engine.on('error', (error) => {
      this.emit('stream', { type: 'text', content: `\n\n❌ 错误: ${error.message || String(error)}\n` } as EngineStreamEvent);
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('command -v opencode', { stdio: 'ignore', shell: '/bin/bash' });
      return true;
    } catch (e) {
      const fs = require('fs');
      const commonPaths = [
        '/root/.local/bin/opencode',
        '/usr/local/bin/opencode',
        '/usr/bin/opencode',
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true;
      }
      return false;
    }
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    try {
      // Reset per-execution state
      this.seenToolIds.clear();
      this.lastBlockWasTool = false;

      if (!this.engine) {
        this.engine = new OpenCodeEngine({
          workingDirectory: options.workingDirectory,
        });
        this.setupEngineEvents();
        await this.engine.start();
      }

      if (options.sessionId) {
        // Resume existing session for multi-turn context
        try {
          this.currentSessionId = await this.engine.resumeSession(options.sessionId);
        } catch (resumeErr: any) {
          console.warn(`[OpenCodeWrapper] resumeSession failed, creating new:`, resumeErr.message);
          this.currentSessionId = await this.engine.createSession();
          if (options.model) await this.engine.setModel(options.model);
        }
      } else {
        // Always create a fresh session for new executions (workflow steps)
        this.currentSessionId = await this.engine.createSession();
        if (options.model) await this.engine.setModel(options.model);
      }

      let fullPrompt = '';
      if (options.systemPrompt && !options.sessionId) {
        // Only prepend system prompt for new sessions; resume sessions already have it
        fullPrompt += `# System Instructions\n\n${options.systemPrompt}\n\n`;
      } else if (options.systemPrompt && options.appendSystemPrompt) {
        // Lightweight reminder for resumed sessions
        fullPrompt += `${options.systemPrompt}\n\n`;
      }
      fullPrompt += options.sessionId ? options.prompt : `# Task\n\n${options.prompt}`;

      const outputChunks: string[] = [];
      let collectOutput = false;
      const textHandler = (content: any) => {
        if (collectOutput && content.type === 'text') {
          outputChunks.push(content.text);
        }
      };
      this.engine.on('agent-message', textHandler);

      let stopReason: string | undefined;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Start collecting and streaming ONLY after sendPrompt is called,
          // so replayed history from session/load doesn't leak into the output.
          collectOutput = true;
          this.streaming = true;
          stopReason = await this.engine.sendPrompt(fullPrompt);
          break;
        } catch (promptError: any) {
          const msg = promptError.message || String(promptError);
          const isThrottled = msg.includes('throttled') || msg.includes('rate') || msg.includes('Retry');
          if (isThrottled && attempt < maxRetries) {
            const delay = attempt * 30;
            this.emit('stream', { type: 'log', content: `⚠️ 服务限流，${delay}s 后重试...` });
            // Reset streaming flags before retry
            this.streaming = false;
            collectOutput = false;
            this.engine.stop();
            this.engine = new OpenCodeEngine({
              workingDirectory: options.workingDirectory,
            });
            this.setupEngineEvents();
            await this.engine.start();
            this.currentSessionId = await this.engine.createSession();
            if (options.model) await this.engine.setModel(options.model);
            this.engine.on('agent-message', textHandler);
            await new Promise(r => setTimeout(r, delay * 1000));
            continue;
          }
          throw promptError;
        }
      }

      this.engine.off('agent-message', textHandler);
      this.streaming = false;

      return {
        success: stopReason === 'end_turn',
        output: outputChunks.join(''),
        sessionId: this.currentSessionId,
        stopReason,
      };
    } catch (error: any) {
      this.streaming = false;
      console.error(`[OpenCodeWrapper] execute() error:`, error.message || error);
      return {
        success: false,
        output: '',
        error: error.message || String(error),
      };
    }
  }

  cancel(): void {
    if (this.engine) {
      this.engine.cancelSession();
    }
  }

  cleanup(): void {
    if (this.engine) {
      this.engine.stop();
      this.engine = null;
      this.currentSessionId = null;
    }
  }
}