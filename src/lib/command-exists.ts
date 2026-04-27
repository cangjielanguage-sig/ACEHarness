import { existsSync } from 'fs';
import { join } from 'path';

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

export function commandExists(command: string, extraPaths: string[] = []): boolean {
  const pathValue = process.env.PATH || '';
  const pathDirs = pathValue
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean);

  const candidates = getExecutableCandidates(command);

  for (const dir of [...extraPaths, ...pathDirs]) {
    for (const candidate of candidates) {
      if (existsSync(join(dir, candidate))) return true;
    }
  }

  return false;
}
