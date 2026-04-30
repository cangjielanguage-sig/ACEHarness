import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { delimiter, isAbsolute, join } from 'path';

function getExecutableCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command];

  const hasExtension = /\.[^./\\]+$/.test(command);
  if (hasExtension) return [command];

  const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);

  return [command, ...pathext.map((ext) => `${command}${ext}`)];
}

export function getCommonCliSearchPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';

  if (process.platform === 'win32') {
    return [
      home ? join(home, 'AppData', 'Roaming', 'npm') : '',
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      home ? join(home, 'go', 'bin') : '',
      home ? join(home, '.cargo', 'bin') : '',
      home ? join(home, 'scoop', 'shims') : '',
      home ? join(home, '.local', 'bin') : '',
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links') : '',
    ].filter(Boolean);
  }

  return [
    home ? join(home, '.local', 'bin') : '',
    home ? join(home, 'go', 'bin') : '',
    home ? join(home, '.cargo', 'bin') : '',
    '/root/.local/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter(Boolean);
}

export function findCommand(command: string, extraPaths: string[] = []): string | null {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    for (const candidate of getExecutableCandidates(command)) {
      if (existsSync(candidate)) return candidate;
    }
    return existsSync(command) ? command : null;
  }

  const pathDirs = (process.env.PATH || '')
    .split(delimiter)
    .filter(Boolean);
  const candidates = getExecutableCandidates(command);

  for (const dir of [...extraPaths, ...pathDirs]) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  return null;
}

export function commandExists(command: string, extraPaths: string[] = []): boolean {
  if (findCommand(command, extraPaths) !== null) return true;

  // Fallback: try spawning the command directly.
  // On Windows, some tools are registered via doskey aliases, App Execution
  // Aliases, or shell-level shims that don't appear as files on disk.
  try {
    execFileSync(command, ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch (err: any) {
    // If the process spawned but returned a non-zero exit code, the command
    // still exists — only ENOENT / EACCES means "not found".
    if (err?.status != null) return true;
    return false;
  }
}
