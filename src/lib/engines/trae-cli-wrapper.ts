/**
 * Trae CLI Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for Trae CLI.
 * Trae CLI uses standard ACP protocol with `trae-cli acp serve` command.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

export class TraeCliEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'trae-cli';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'trae-cli',
      command: 'trae-cli',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('command -v trae-cli', { stdio: 'ignore', shell: '/bin/bash' });
      return true;
    } catch (e) {
      const fs = require('fs');
      const commonPaths = [
        '/root/.local/bin/trae-cli',
        '/usr/local/bin/trae-cli',
        '/usr/bin/trae-cli',
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return true;
      }
      return false;
    }
  }
}
