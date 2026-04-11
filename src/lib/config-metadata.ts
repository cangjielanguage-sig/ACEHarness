/**
 * 配置文件元数据管理
 * 管理 configs/.metadata.json 和 configs/agents/.metadata.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

export interface ConfigMeta {
  createdBy?: string;
  visibility: 'public' | 'private';
  createdAt: number;
}

type MetadataMap = Record<string, ConfigMeta>;

async function loadMetadata(metaPath: string): Promise<MetadataMap> {
  if (!existsSync(metaPath)) return {};
  try {
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMetadata(metaPath: string, data: MetadataMap): Promise<void> {
  const dir = resolve(metaPath, '..');
  await mkdir(dir, { recursive: true });
  await writeFile(metaPath, JSON.stringify(data, null, 2), 'utf-8');
}

const CONFIGS_META = resolve(process.cwd(), 'configs', '.metadata.json');
const AGENTS_META = resolve(process.cwd(), 'configs', 'agents', '.metadata.json');

export async function getConfigMeta(configFile: string, type: 'workflow' | 'agent' = 'workflow'): Promise<ConfigMeta | undefined> {
  const metaPath = type === 'agent' ? AGENTS_META : CONFIGS_META;
  const data = await loadMetadata(metaPath);
  return data[configFile];
}

export async function setConfigMeta(configFile: string, meta: Partial<ConfigMeta>, type: 'workflow' | 'agent' = 'workflow'): Promise<void> {
  const metaPath = type === 'agent' ? AGENTS_META : CONFIGS_META;
  const data = await loadMetadata(metaPath);
  data[configFile] = { ...data[configFile], ...meta } as ConfigMeta;
  await saveMetadata(metaPath, data);
}

export async function deleteConfigMeta(configFile: string, type: 'workflow' | 'agent' = 'workflow'): Promise<void> {
  const metaPath = type === 'agent' ? AGENTS_META : CONFIGS_META;
  const data = await loadMetadata(metaPath);
  delete data[configFile];
  await saveMetadata(metaPath, data);
}

export async function listConfigsWithMeta(type: 'workflow' | 'agent' = 'workflow'): Promise<MetadataMap> {
  const metaPath = type === 'agent' ? AGENTS_META : CONFIGS_META;
  return loadMetadata(metaPath);
}
