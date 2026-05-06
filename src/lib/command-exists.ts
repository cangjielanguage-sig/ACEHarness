import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_SCAN_DIRS = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

/**
 * True if `name` is on PATH (with optional dirs prepended to PATH) or exists as `dir/name`.
 * `name` must be a single token (no slashes).
 */
export function commandExists(name: string, extraDirs: string[] = DEFAULT_SCAN_DIRS): boolean {
  if (!/^[\w.-]+$/.test(name)) return false;
  const dirs = extraDirs.length > 0 ? extraDirs : DEFAULT_SCAN_DIRS;
  const pathEnv = [...dirs, process.env.PATH || ''].filter(Boolean).join(':');
  try {
    execSync(`command -v ${name}`, {
      stdio: 'ignore',
      shell: '/bin/bash',
      env: { ...process.env, PATH: pathEnv },
    });
    return true;
  } catch {
    for (const dir of dirs) {
      if (existsSync(join(dir, name))) return true;
    }
    return false;
  }
}
