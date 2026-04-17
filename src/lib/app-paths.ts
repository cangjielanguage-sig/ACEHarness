import { dirname, join, resolve } from 'path';

export type AppDirectoryKind = 'config' | 'data' | 'cache' | 'logs' | 'workspace';

const MODULE_DIR = __dirname;

export function getWorkspaceRoot(): string {
  return resolve(process.cwd());
}

export function getRepoRoot(): string {
  return resolve(MODULE_DIR, '..', '..');
}

export function getWorkspaceDirectory(kind: AppDirectoryKind): string {
  switch (kind) {
    case 'workspace':
      return getWorkspaceRoot();
    case 'config':
      return join(getWorkspaceRoot(), 'config');
    case 'data':
      return join(getWorkspaceRoot(), 'data');
    case 'cache':
      return join(getWorkspaceRoot(), 'cache');
    case 'logs':
    default:
      return join(getWorkspaceRoot(), 'logs');
  }
}

export function getWorkspaceConfigFile(name: string): string {
  return join(getWorkspaceDirectory('config'), name);
}

export function getWorkspaceDataFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('data'), ...segments);
}

export function getWorkspaceLogFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('logs'), ...segments);
}

export function getWorkspaceCacheFile(...segments: string[]): string {
  return join(getWorkspaceDirectory('cache'), ...segments);
}

export function getWorkspacePath(...segments: string[]): string {
  return join(getWorkspaceDirectory('workspace'), ...segments);
}

export function getEngineConfigPath(): string {
  return join(getWorkspaceRoot(), '.engine.json');
}

export function getWorkspaceDataDir(): string {
  return getWorkspaceDirectory('data');
}

export function getWorkspaceNotebookRoot(): string {
  return getWorkspaceDataFile('notebook');
}

export function getRuntimeDirForFile(filePath: string): string {
  return dirname(filePath);
}
