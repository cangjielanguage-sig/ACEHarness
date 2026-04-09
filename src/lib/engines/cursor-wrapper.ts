/**
 * Cursor CLI Engine Wrapper
 *
 * Wraps ACPEngine to implement the Engine interface for Cursor CLI
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions, EngineResult } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

export class CursorEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'cursor';
  }

  /**
   * Get ACP engine configuration for Cursor CLI
   */
  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'cursor',
      command: 'cursor',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: ['acp'], // Cursor CLI ACP subcommand
      env: {
        // Cursor CLI specific environment variables
        CURSOR_ACP_MODE: '1',
        CURSOR_AGENT_NAME: options.agent || 'default'
      }
    };
  }

  /**
   * Check if Cursor CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('command -v cursor', { stdio: 'ignore', shell: '/bin/bash' });
      return true;
    } catch (e) {
      // Check common installation paths
      const fs = require('fs');
      const commonPaths = [
        '/usr/local/bin/cursor',
        '/usr/bin/cursor',
        '/opt/cursor/bin/cursor',
        '/usr/local/cursor/bin/cursor',
        process.env.HOME + '/.cursor/bin/cursor',
        process.env.HOME + '/.local/bin/cursor'
      ];
      
      for (const path of commonPaths) {
        try {
          require('fs').accessSync(path, require('fs').constants.X_OK);
          return true;
        } catch (e) {
          // Continue checking other paths
        }
      }
      return false;
    }
  }

  /**
   * Execute a task with Cursor CLI
   */
  async execute(options: EngineOptions): Promise<EngineResult> {
    // Cursor CLI may have specific requirements
    const config = this.getACPConfig(options);
    
    // Cursor CLI might need additional setup
    if (options.agent) {
      // Cursor CLI might have agent-specific configuration
      config.env = {
        ...config.env,
        CURSOR_AGENT: options.agent
      };
    }
    
    return super.execute(options);
  }
}