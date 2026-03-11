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
  private currentAgent: string | null = null;

  getName(): string {
    return 'kiro-cli';
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
      console.log(`[KiroCliWrapper] execute() called for step: ${options.step}, agent: ${options.agent}`);
      // Create engine instance if needed, or recreate if agent changed
      if (!this.engine || this.currentAgent !== options.agent) {
        if (this.engine) {
          console.log(`[KiroCliWrapper] Agent changed from ${this.currentAgent} to ${options.agent}, recreating engine`);
          this.engine.stop();
        }
        console.log(`[KiroCliWrapper] Creating new KiroCliEngine instance, cwd: ${options.workingDirectory}, agent: ${options.agent}, model: ${options.model}`);
        this.currentAgent = options.agent;
        this.engine = new KiroCliEngine({
          workingDirectory: options.workingDirectory,
          agentName: options.agent,
          model: options.model,
        });
        this.setupEngineEvents();

        // Start the engine
        console.log('[KiroCliWrapper] Starting engine...');
        await this.engine.start();
        console.log('[KiroCliWrapper] Engine started successfully');
      }

      // Create or reuse session
      if (!this.currentSessionId || !options.sessionId) {
        console.log('[KiroCliWrapper] Creating new session...');
        this.currentSessionId = await this.engine.createSession();
        console.log(`[KiroCliWrapper] Session created: ${this.currentSessionId}`);
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

      // Send prompt with retry for throttling
      console.log(`[KiroCliWrapper] Sending prompt (${fullPrompt.length} chars)...`);
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
            console.log(`[KiroCliWrapper] 限流，${delay}s 后重试 (${attempt}/${maxRetries})...`);
            this.emit('stream', { type: 'log', content: `⚠️ 服务限流，${delay}s 后重试...` });
            // Recreate engine for fresh connection
            this.engine.stop();
            this.engine = new KiroCliEngine({
              workingDirectory: options.workingDirectory,
              agentName: options.agent,
              model: options.model,
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
      console.log(`[KiroCliWrapper] Prompt completed, stopReason: ${stopReason}, output chunks: ${outputChunks.length}`);

      this.engine.off('agent-message', textHandler);

      return {
        success: stopReason === 'end_turn',
        output: outputChunks.join(''),
        sessionId: this.currentSessionId,
        stopReason,
      };
    } catch (error: any) {
      console.error(`[KiroCliWrapper] execute() error:`, error.message || error);
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
      this.currentAgent = null;
    }
  }
}
