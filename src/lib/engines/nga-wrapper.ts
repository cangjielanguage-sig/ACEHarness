/**
 * NGA / ngagent Engine Wrapper
 *
 * OpenCode-compatible CLI (`nga`): ACP 启动参数与 opencode 一致，进程级默认附带 `--disable-update`（见 acp-engine buildCommandArgs）。
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';

const COMMON_BIN_DIRS = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function hasCommand(name: string): boolean {
  try {
    const { execSync } = require('child_process');
    execSync(`command -v ${name}`, { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    const fs = require('fs');
    for (const dir of COMMON_BIN_DIRS) {
      if (fs.existsSync(`${dir}/${name}`)) return true;
    }
    return false;
  }
}

export class NgaEngineWrapper extends ACPWrapperBase {
  private resolveCommand(): string {
    if (hasCommand('ngagent')) return 'ngagent';
    return 'nga';
  }

  getName(): string {
    return 'nga';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    const command = this.resolveCommand();
    return {
      engineType: 'nga',
      command,
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return hasCommand('ngagent') || hasCommand('nga');
  }
}
