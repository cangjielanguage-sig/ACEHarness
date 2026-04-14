import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';

const SYSTEM_SETTINGS_PATH = resolve(process.cwd(), 'data', 'system-settings.yaml');

export interface SystemSettings {
  gitcodeToken?: string;
}

async function readSystemSettings(): Promise<SystemSettings> {
  try {
    const content = await readFile(SYSTEM_SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    return parsed && typeof parsed === 'object' ? parsed as SystemSettings : {};
  } catch {
    return {};
  }
}

export async function loadSystemSettings(): Promise<SystemSettings> {
  return readSystemSettings();
}

export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  await mkdir(dirname(SYSTEM_SETTINGS_PATH), { recursive: true });
  await writeFile(SYSTEM_SETTINGS_PATH, stringify(settings), 'utf-8');
}
