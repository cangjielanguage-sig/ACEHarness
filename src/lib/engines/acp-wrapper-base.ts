/**
 * Base ACP Wrapper
 * 
 * Common wrapper implementation for all ACP-compatible engines.
 * Each engine (opencode, kiro-cli, codex, cursor) will extend this base class.
 */

import { EventEmitter } from 'events';
import { ACPEngine, ACPEngineConfig } from './acp-engine';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { fenced } from '../markdown-utils';

export abstract class ACPWrapperBase extends EventEmitter implements Engine {
  protected engine: ACPEngine | null = null;
  protected currentSessionId: string | null = null;
  protected lastBlockWasTool = false;
  protected seenToolIds = new Set<string>();
  protected streaming = false;

  /**
   * Get engine name (to be implemented by subclasses)
   */
  abstract getName(): string;

  /**
   * Get ACP engine configuration (to be implemented by subclasses)
   */
  protected abstract getACPConfig(options: EngineOptions): ACPEngineConfig;

  /**
   * Check if the engine is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Execute a task with the engine
   */
  async execute(options: EngineOptions): Promise<EngineResult> {
    try {
      const config = this.getACPConfig(options);
      this.engine = new ACPEngine(config);
      
      // Setup event forwarding
      this.setupEngineEvents();
      
      // Start the engine
      await this.engine.start();
      
      // Create or resume session
      if (options.sessionId) {
        this.currentSessionId = await this.engine.resumeSession(options.sessionId);
      } else {
        this.currentSessionId = await this.engine.createSession();
      }
      
      // Set model if specified
      if (options.model) {
        await this.engine.setModel(options.model);
      }
      
      // Send prompt
      const stopReason = await this.engine.sendPrompt(options.prompt);
      
      // Return result
      return {
        success: true,
        output: '', // Output is streamed via events
        sessionId: this.currentSessionId,
        stopReason
      };
      
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Cancel the current execution
   */
  cancel(): void {
    if (this.engine) {
      this.engine.cancelSession();
      this.engine.stop();
      this.engine = null;
    }
  }

  /**
   * Setup event forwarding from ACP engine to Engine interface
   */
  private setupEngineEvents(): void {
    if (!this.engine) return;

    this.engine.on('agent-message', (content) => {
      let text = '';
      
      if (typeof content === 'string') {
        text = content;
      } else if (content && typeof content === 'object') {
        // 尝试从对象中提取文本
        if (content.text) {
          text = content.text;
        } else if (content.content) {
          text = content.content;
        } else if (content.type === 'text' && content.text) {
          text = content.text;
        } else {
          // 尝试将对象转换为字符串
          text = JSON.stringify(content);
        }
      }
      
      if (text) {
        this.emit('stream', { type: 'text', content: text } as EngineStreamEvent);
      }
    });

    this.engine.on('agent-thought', (content) => {
      let text = '';
      
      if (typeof content === 'string') {
        text = content;
      } else if (content && typeof content === 'object') {
        // 尝试从对象中提取文本
        if (content.text) {
          text = content.text;
        } else if (content.content) {
          text = content.content;
        } else if (content.type === 'text' && content.text) {
          text = content.text;
        } else {
          // 尝试将对象转换为字符串
          text = JSON.stringify(content);
        }
      }
      
      if (text) {
        this.emit('stream', { type: 'thought', content: text } as EngineStreamEvent);
      }
    });

    this.engine.on('tool-call', (toolCall) => {
      this.emit('stream', { 
        type: 'tool', 
        content: `🔧 ${toolCall.title || 'Tool Call'}`, 
        metadata: toolCall 
      } as EngineStreamEvent);
    });

    this.engine.on('tool-call-update', (toolUpdate) => {
      this.handleToolCallUpdate(toolUpdate);
    });

    this.engine.on('log', (log) => {
      this.emit('stream', { type: 'log', content: log } as EngineStreamEvent);
    });

    this.engine.on('error', (error) => {
      this.emit('stream', { 
        type: 'error', 
        content: error instanceof Error ? error.message : String(error) 
      } as EngineStreamEvent);
    });
  }

  /**
   * Handle tool call updates
   */
  private handleToolCallUpdate(toolUpdate: any): void {
    const toolId = toolUpdate.id;
    const toolName = this.resolveToolName(toolUpdate);
    
    // If this is the first time we see this tool, emit the header
    if (toolId && !this.seenToolIds.has(toolId) && toolUpdate.status !== 'completed' && toolUpdate.status !== 'failed') {
      const hasInput = toolUpdate.rawInput && Object.keys(toolUpdate.rawInput).length > 0;
      if (hasInput) {
        const formatted = this.formatToolCall(toolUpdate);
        this.emit('stream', { 
          type: 'tool', 
          content: formatted,
          metadata: toolUpdate
        } as EngineStreamEvent);
        this.seenToolIds.add(toolId);
      }
    }
  }

  /**
   * Resolve the actual tool name from ACP event data
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
   * Format tool call into structured markdown
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
          header += `\n<details><summary>查看修改</summary>\n\n`;
          if (oldStr) header += `**原内容**\n\n${fenced(oldStr, 'diff')}\n\n`;
          if (newStr) header += `**新内容**\n\n${fenced(newStr, 'diff')}\n\n`;
          header += `</details>\n`;
        }
        break;
      }
      case 'read': {
        const rPath = rawInput.filePath || '';
        header += `\n📖 读取文件: \`${rPath}\`\n`;
        break;
      }
      case 'grep': {
        const pattern = rawInput.pattern || '';
        const include = rawInput.include || '';
        header += `\n🔍 搜索: \`${pattern}\` (包含: ${include})\n`;
        break;
      }
      case 'glob': {
        const pattern = rawInput.pattern || '';
        header += `\n📁 文件匹配: \`${pattern}\`\n`;
        break;
      }
      case 'task': {
        const desc = rawInput.description || '';
        header += `\n📋 任务: ${desc}\n`;
        break;
      }
      case 'todowrite': {
        const todos = rawInput.todos || [];
        header += `\n✅ 待办事项: ${todos.length} 项\n`;
        break;
      }
      case 'webfetch': {
        const url = rawInput.url || '';
        header += `\n🌐 获取网页: ${url}\n`;
        break;
      }
      case 'websearch': {
        const query = rawInput.query || '';
        header += `\n🔎 搜索网络: ${query}\n`;
        break;
      }
      default: {
        header += `\n🛠️ 工具调用: ${toolName}\n`;
        if (Object.keys(rawInput).length > 0) {
          header += `\n<details><summary>查看输入</summary>\n\n${fenced(JSON.stringify(rawInput, null, 2), 'json')}\n\n</details>\n`;
        }
      }
    }

    return header;
  }
}