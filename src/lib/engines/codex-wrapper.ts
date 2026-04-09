/**
 * Codex Engine Wrapper
 *
 * Wraps ACPEngine to implement the Engine interface for Codex
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions, EngineResult } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

export class CodexEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'codex';
  }

  /**
   * Get ACP engine configuration for Codex
   */
  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'codex',
      command: 'codex',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: ['acp']
    };
  }

  /**
   * Check if Codex is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('command -v codex', { stdio: 'ignore', shell: '/bin/bash' });
      return true;
    } catch (e) {
      const fs = require('fs');
      const commonPaths = [
        '/root/.local/bin/codex',
        '/usr/local/bin/codex',
        '/usr/bin/codex',
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          return true;
        }
      }
      return false;
    }
  }

  /**
   * Execute a task with Codex (override for any Codex-specific logic)
   */
  async execute(options: EngineOptions): Promise<EngineResult> {
    return super.execute(options);
  }
}