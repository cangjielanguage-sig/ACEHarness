/**
 * OpenCode Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for OpenCode.
 * OpenCode uses standard ACP protocol, so the base class handles most of the work.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

export class OpenCodeEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'opencode';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'opencode',
      command: 'opencode',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
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
}
