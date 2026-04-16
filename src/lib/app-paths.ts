import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export type AppDirectoryKind = 'config' | 'data' | 'cache' | 'logs' | 'workspace';

const APP_NAME = 'ace';
const ENV_HOME = process.env.ACE_HOME?.trim();
const MODULE_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

function getUserHome(): string {
  return homedir();
}

function getWindowsBase(): string {
  return process.env.APPDATA?.trim()
    || process.env.LOCALAPPDATA?.trim()
    || join(getUserHome(), 'AppData', 'Roaming');
}

function getMacBase(): string {
  return join(getUserHome(), 'Library', 'Application Support');
}

function getLinuxConfigBase(): string {
  return process.env.XDG_CONFIG_HOME?.trim() || join(getUserHome(), '.config');
}

function getLinuxDataBase(): string {
  return process.env.XDG_DATA_HOME?.trim() || join(getUserHome(), '.local', 'share');
}

function getLinuxCacheBase(): string {
  return process.env.XDG_CACHE_HOME?.trim() || join(getUserHome(), '.cache');
}

export function getAceHome(): string {
  if (ENV_HOME) return resolve(ENV_HOME);

  if (process.platform === 'win32') {
    return resolve(join(getWindowsBase(), APP_NAME));
  }

  if (process.platform === 'darwin') {
    return resolve(join(getMacBase(), APP_NAME));
  }

  return resolve(join(getLinuxDataBase(), APP_NAME));
}

export function getRepoRoot(): string {
  return resolve(MODULE_DIR, '..', '..');
}

export function getAceDirectory(kind: AppDirectoryKind): string {
  if (ENV_HOME) {
    return kind === 'workspace' ? getAceHome() : join(getAceHome(), kind);
  }

  if (process.platform === 'win32' || process.platform === 'darwin') {
    return kind === 'workspace' ? getAceHome() : join(getAceHome(), kind);
  }

  switch (kind) {
    case 'config':
      return resolve(join(getLinuxConfigBase(), APP_NAME));
    case 'cache':
      return resolve(join(getLinuxCacheBase(), APP_NAME));
    case 'workspace':
      return getAceHome();
    case 'data':
    case 'logs':
    default:
      return join(getAceHome(), kind);
  }
}

export function getAceConfigFile(name: string): string {
  return join(getAceDirectory('config'), name);
}

export function getAceDataFile(...segments: string[]): string {
  return join(getAceDirectory('data'), ...segments);
}

export function getAceLogFile(...segments: string[]): string {
  return join(getAceDirectory('logs'), ...segments);
}

export function getAceCacheFile(...segments: string[]): string {
  return join(getAceDirectory('cache'), ...segments);
}

export function getAceWorkspacePath(...segments: string[]): string {
  return join(getAceDirectory('workspace'), ...segments);
}

export function getEngineConfigPath(): string {
  return getAceConfigFile('engine.json');
}

export function getAppConfigPath(): string {
  return getAceConfigFile('app.json');
}

export function getDataDir(): string {
  return getAceDirectory('data');
}

export function getNotebookDataRoot(): string {
  return getAceDataFile('notebook');
}

export function getRuntimeDirForFile(filePath: string): string {
  return dirname(filePath);
}
