/**
 * OpenCode Engine Wrapper
 *
 * Wraps OpenCodeEngine to implement the Engine interface
 */

import { EventEmitter } from 'events';
import { OpenCodeEngine } from './opencode';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';

export class OpenCodeEngineWrapper extends EventEmitter implements Engine {
  private engine: OpenCodeEngine | null = null;
  private currentSessionId: string | null = null;

  getName(): string {
    return 'opencode';
  }

  private setupEngineEvents(): void {
    if (!this.engine) return;
    this.engine.on('agent-message', (content) => {
      if (content.type === 'text') {
        this.emit('stream', { type: 'text', content: content.text } as EngineStreamEvent);
      }
    });
    this.engine.on('agent-thought', (content) => {
      if (content.type === 'text') {
        this.emit('stream', { type: 'thought', content: content.text } as EngineStreamEvent);
      }
    });
    this.engine.on('tool-call', (toolCall) => {
      this.emit('stream', { type: 'tool', content: `🔧 ${toolCall.title}`, metadata: toolCall } as EngineStreamEvent);
    });
    this.engine.on('log', (log) => {
      this.emit('stream', { type: 'log', content: log } as EngineStreamEvent);
    });
    this.engine.on('error', (error) => {
      this.emit('stream', { type: 'error', content: error.message || String(error) } as EngineStreamEvent);
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
      if (!this.engine) {
        this.engine = new OpenCodeEngine({
          workingDirectory: options.workingDirectory,
        });
        this.setupEngineEvents();
        await this.engine.start();
      }

      if (!this.currentSessionId || !options.sessionId) {
        this.currentSessionId = await this.engine.createSession();
      }

      let fullPrompt = '';
      if (options.systemPrompt) {
        fullPrompt += `# System Instructions\n\n${options.systemPrompt}\n\n`;
      }
      fullPrompt += `# Task\n\n${options.prompt}`;

      const outputChunks: string[] = [];
      const textHandler = (content: any) => {
        if (content.type === 'text') {
          outputChunks.push(content.text);
        }
      };
      this.engine.on('agent-message', textHandler);

      let stopReason: string | undefined;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          stopReason = await this.engine.sendPrompt(fullPrompt);
          break;
        } catch (promptError: any) {
          const msg = promptError.message || String(promptError);
          const isThrottled = msg.includes('throttled') || msg.includes('rate') || msg.includes('Retry');
          if (isThrottled && attempt < maxRetries) {
            const delay = attempt * 30;
            this.emit('stream', { type: 'log', content: `⚠️ 服务限流，${delay}s 后重试...` });
            this.engine.stop();
            this.engine = new OpenCodeEngine({
              workingDirectory: options.workingDirectory,
            });
            this.setupEngineEvents();
            await this.engine.start();
            this.currentSessionId = await this.engine.createSession();
            this.engine.on('agent-message', textHandler);
            await new Promise(r => setTimeout(r, delay * 1000));
            continue;
          }
          throw promptError;
        }
      }

      this.engine.off('agent-message', textHandler);

      return {
        success: stopReason === 'end_turn',
        output: outputChunks.join(''),
        sessionId: this.currentSessionId,
        stopReason,
      };
    } catch (error: any) {
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