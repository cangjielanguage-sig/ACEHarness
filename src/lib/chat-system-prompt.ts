/**
 * Chat Dashboard 模式的系统提示词
 * 精简协议规则 + Skills 文档注入（PROMPT.md + SKILL.md）
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { parse } from 'yaml';
import { generateActionTypesDocs } from './chat-actions';

const CORE_PROMPT = `你是 AceFlow 工作流助手。

## Action Block 协议
当需要操作时，在回复末尾嵌入（不要在同一条回复中同时输出 action 和其他内容）：

\`\`\`action
{"type":"操作类型","params":{参数},"description":"说明"}
\`\`\`

只读操作（list/get/status）系统自动执行，无需等待确认。

## 最高优先级规则

**当用户发送 PR 或 Issue，必须第一步调用 gitcode action 获取详情，禁止先回答后查证。**

**禁止用 curl/Bash 调用 GitCode API，必须用 gitcode.* action block。**

**展示结构化内容时必须用 \`\`\`card 代码块，禁止用 \`\`\`json。**

**变更类 action（create/update/delete）输出时不能说"已完成"。**

## 常用 Action（详细参数见各 Skill SKILL.md）

${generateActionTypesDocs()}`;;

const SKILLS_YAML_PATH = resolve(process.cwd(), 'skills', 'skills.yaml');
const SKILLS_DIR = join(process.cwd(), 'skills', '.claude', 'skills');

const MAX_SKILL_CHARS = 4000; // 每个 skill 最多注入这么多字符

/** 加载单个 skill 的精简文档（PROMPT.md + SKILL.md 头部） */
async function loadSkillDocs(skillName: string): Promise<string> {
  const parts: string[] = [];
  const skillDir = join(SKILLS_DIR, skillName);

  // PROMPT.md — 触发场景和核心能力
  try {
    const prompt = await readFile(resolve(skillDir, 'PROMPT.md'), 'utf-8');
    const trimmed = prompt.trim();
    if (trimmed) {
      parts.push(`## ${skillName} (PROMPT.md)\n${trimmed.slice(0, 2000)}`);
    }
  } catch { /* skip */ }

  // SKILL.md — 头部（含执行规则和重要说明）
  try {
    const skill = await readFile(resolve(skillDir, 'SKILL.md'), 'utf-8');
    const trimmed = skill.trim();
    if (trimmed) {
      // 只取 SKILL.md 前半部分（包含规则、触发场景、警告）
      // 跳过目录结构、脚本参数等后半段细节
      const mid = Math.floor(trimmed.length * 0.6);
      const cutoff = trimmed.slice(0, mid);
      parts.push(`## ${skillName} (SKILL.md)\n${cutoff}`);
    }
  } catch { /* skip */ }

  const combined = parts.join('\n\n');
  if (combined.length > MAX_SKILL_CHARS) {
    return combined.slice(0, MAX_SKILL_CHARS) + '\n\n...(内容已截断，详见 SKILL.md)...';
  }
  return combined;
}

/** 构建完整的 dashboard 模式系统提示词 */
export async function buildDashboardSystemPrompt(enabledSkills?: string[]): Promise<string> {
  let skillDocs = '';

  if (enabledSkills && enabledSkills.length > 0) {
    const docs: string[] = [];
    for (const skill of enabledSkills) {
      const doc = await loadSkillDocs(skill);
      if (doc) docs.push(doc);
    }
    if (docs.length > 0) {
      skillDocs = `\n\n## 当前启用的 Skills 文档\n\n${docs.join('\n\n---\n\n')}`;
    }
  }

  return CORE_PROMPT + skillDocs;
}
