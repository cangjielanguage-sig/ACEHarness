/**
 * Chat 技能设置持久化 - 存储到 data/chat-settings.yaml
 * 自动发现 skills/.claude/skills/ 下的所有技能目录，从 SKILL.md 提取元数据
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { parse, stringify } from 'yaml';

const SETTINGS_PATH = resolve(process.cwd(), 'data', 'chat-settings.yaml');
const SKILLS_DIR = join(process.cwd(), ['skills', '.claude', 'skills'].join('/'));
const SKILLS_YAML_PATH = resolve(process.cwd(), 'skills', 'skills.yaml');

export interface SkillInfo {
  name: string;        // 目录名，如 power-gitcode
  label: string;       // 显示名，从 SKILL.md # 标题提取
  description: string; // 简介，从 SKILL.md 第一段提取
  enabled: boolean;
  source?: string;     // 来源: 'cangjie' | 'anthropics'
  tags?: string[];     // 标签
}

export interface ChatSettings {
  skills: Record<string, boolean>;
}

/** 从 SKILL.md 提取标题和描述 */
function parseSkillMd(content: string): { label: string; description: string } {
  const lines = content.split('\n');
  let label = '';
  let description = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!label && trimmed.startsWith('# ')) {
      label = trimmed.slice(2).trim();
      continue;
    }
    if (label && !description && trimmed && !trimmed.startsWith('#')) {
      description = trimmed;
      break;
    }
  }
  return { label, description };
}

/** 从 skills.yaml 读取 skill 元数据（source, tags 等） */
async function loadSkillsYamlMeta(): Promise<Record<string, { source?: string; tags?: string[]; description?: string; descriptionZh?: string }>> {
  const meta: Record<string, { source?: string; tags?: string[]; description?: string; descriptionZh?: string }> = {};
  try {
    const content = await readFile(SKILLS_YAML_PATH, 'utf-8');
    const config = parse(content) as { skills?: Array<{ name: string; path: string; source?: string; tags?: string[]; description?: string; descriptionZh?: string }> };
    for (const s of config.skills || []) {
      meta[s.path || s.name] = { source: s.source, tags: s.tags, description: s.description, descriptionZh: s.descriptionZh };
    }
  } catch { /* no skills.yaml */ }
  return meta;
}

/** 扫描 skills/.claude/skills/ 目录，发现所有技能并提取元数据 */
export async function discoverSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const yamlMeta = await loadSkillsYamlMeta();
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      let label = name;
      let description = '';
      try {
        const skillMd = await readFile(resolve(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
        const parsed = parseSkillMd(skillMd);
        if (parsed.label) label = parsed.label;
        if (parsed.description) description = parsed.description;
      } catch { /* no SKILL.md */ }
      const meta = yamlMeta[name];
      // 优先使用中文描述
      if (!description && meta?.descriptionZh) description = meta.descriptionZh;
      else if (!description && meta?.description) description = meta.description;
      // 对于 anthropics 来源的 skill，优先使用中文描述
      if (meta?.source === 'anthropics' && meta?.descriptionZh) description = meta.descriptionZh;
      skills.push({
        name,
        label,
        description,
        enabled: true,
        source: meta?.source || 'cangjie',
        tags: meta?.tags || [],
      });
    }
  } catch { /* skills dir doesn't exist */ }
  return skills;
}

export async function loadChatSettings(): Promise<ChatSettings> {
  const discovered = await discoverSkills();
  const defaults: Record<string, boolean> = {};
  const DEFAULT_ENABLED = ['power-gitcode', 'aceflow-chat-card', 'aceflow-workflow-creator'];
  for (const s of discovered) defaults[s.name] = DEFAULT_ENABLED.includes(s.name);

  try {
    const content = await readFile(SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    return { skills: { ...defaults, ...parsed?.skills } };
  } catch {
    return { skills: defaults };
  }
}

export async function saveChatSettings(settings: ChatSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, stringify(settings), 'utf-8');
}
