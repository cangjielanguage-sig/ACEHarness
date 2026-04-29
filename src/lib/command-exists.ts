import { existsSync } from 'fs';
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
    ].filter(Boolean);
  }

  return [
    home ? join(home, '.local', 'bin') : '',
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
  return findCommand(command, extraPaths) !== null;
}
