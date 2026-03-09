/**
 * Kiro CLI Engine Wrapper
 *
 * Wraps KiroCliEngine to implement the Engine interface
 */

import { EventEmitter } from 'events';
import { KiroCliEngine } from './kiro-cli';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';

export class KiroCliEngineWrapper extends EventEmitter implements Engine {
  private engine: KiroCliEngine | null = null;
  private currentSessionId: string | null = null;

  getName(): string {
    return 'kiro-cli';
  }

  async isAvailable(): Promise<boolean> {
    console.log('[KiroCliWrapper] isAvailable() called');
    try {
      const { execSync } = require('child_process');
      // Use 'command -v' instead of 'which' for better compatibility
      console.log('[KiroCliWrapper] Trying command -v kiro-cli...');
      execSync('command -v kiro-cli', { stdio: 'ignore', shell: '/bin/bash' });
      console.log('[KiroCliWrapper] command -v succeeded');
      return true;
    } catch (e) {
      console.log('[KiroCliWrapper] command -v failed:', (e as Error).message);
      // Fallback: check common installation paths
      const fs = require('fs');
      const commonPaths = [
        '/root/.local/bin/kiro-cli',
        '/usr/local/bin/kiro-cli',
        '/usr/bin/kiro-cli',
      ];
      for (const p of commonPaths) {
        console.log(`[KiroCliWrapper] Checking path: ${p}`);
        if (fs.existsSync(p)) {
          console.log(`[KiroCliWrapper] Found at: ${p}`);
          return true;
        }
      }
      console.log('[KiroCliWrapper] Not found in any path');
      return false;
    }
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    try {
      // Create engine instance if needed
      if (!this.engine) {
        this.engine = new KiroCliEngine({
          workingDirectory: options.workingDirectory,
          agentName: options.agent,
          model: options.model,
        });

        // Forward events
        this.engine.on('agent-message', (content) => {
          if (content.type === 'text') {
            this.emit('stream', {
              type: 'text',
              content: content.text,
            } as EngineStreamEvent);
          }
        });

        this.engine.on('agent-thought', (content) => {
          if (content.type === 'text') {
            this.emit('stream', {
              type: 'thought',
              content: content.text,
            } as EngineStreamEvent);
          }
        });

        this.engine.on('tool-call', (toolCall) => {
          this.emit('stream', {
            type: 'tool',
            content: `🔧 ${toolCall.title}`,
            metadata: toolCall,
          } as EngineStreamEvent);
        });

        this.engine.on('log', (log) => {
          this.emit('stream', {
            type: 'log',
            content: log,
          } as EngineStreamEvent);
        });

        this.engine.on('error', (error) => {
          this.emit('stream', {
            type: 'error',
            content: error.message || String(error),
          } as EngineStreamEvent);
        });

        // Start the engine
        await this.engine.start();
      }

      // Create or reuse session
      if (!this.currentSessionId || !options.sessionId) {
        this.currentSessionId = await this.engine.createSession();
      }

      // Build full prompt with system prompt
      let fullPrompt = '';
      if (options.systemPrompt) {
        fullPrompt += `# System Instructions\n\n${options.systemPrompt}\n\n`;
      }
      fullPrompt += `# Task\n\n${options.prompt}`;

      // Collect streamed text output
      const outputChunks: string[] = [];
      const textHandler = (content: any) => {
        if (content.type === 'text') {
          outputChunks.push(content.text);
        }
      };
      this.engine.on('agent-message', textHandler);

      // Send prompt
      const stopReason = await this.engine.sendPrompt(fullPrompt);

      this.engine.off('agent-message', textHandler);

      return {
        success: stopReason === 'end_turn',
        output: outputChunks.join(''),
        sessionId: this.currentSessionId,
        stopReason,
      };
    } catch (error: any) {
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
