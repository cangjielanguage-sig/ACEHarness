/**
 * Chat Dashboard 模式的系统提示词
 * 精简协议规则 + Skills 文档注入（PROMPT.md + SKILL.md）
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { parse } from 'yaml';
import { generateActionTypesDocs } from './chat-actions';

const CODE = '```';
const SEP = '\n\n---\n\n';
const CORE_PROMPT = '你是 AceFlow 工作流助手。\n\n## Action Block 协议\n当需要操作时，在回复末尾嵌入（不要在同一条回复中同时输出 action 和其他内容）：\n\n' + CODE + 'action\n{"type":"操作类型","params":{参数},"description":"说明"}\n' + CODE + '\n\n只读操作（list/get/status）系统自动执行，无需等待确认。\n\n## 最高优先级规则\n\n**当用户发送 PR 或 Issue，必须第一步调用对应 Skill 的 Python 脚本获取详情，禁止先回答后查证，获取详情后可继续分析，无需立即返回结果。**\n\n**禁止用 curl 调用 GitCode API，必须用 python 脚本（python3 .../power-gitcode.py）调用所有 GitCode 接口。**\n\n**每个子步骤完成后应立即输出结果，不要等全部完成后再输出。**\n\n**展示结构化内容（PR/Issue 分析、统计数据、状态、列表等）时，必须使用 ' + CODE + 'card 代码块输出，禁止用 ' + CODE + 'json 或纯文本。详见 aceflow-chat-card Skill（支持图标/徽章/进度条/折叠区/标签页等丰富的可视化元素）。card 与普通文字内容必须独立输出，不要混在同一条消息里。action 代码块也必须独立输出，不要和普通文字混在一起。**\n\n**变更类 action（create/update/delete）输出时不能说"已完成"。**\n\n## 常用 Action（详细参数见各 Skill SKILL.md）\n\n' + generateActionTypesDocs();

const SKILLS_YAML_PATH = resolve(process.cwd(), 'skills', 'skills.yaml');
const SKILLS_DIR = join(process.cwd(), 'skills', '.claude', 'skills');

const MAX_SKILL_CHARS = 8000; // 每个 skill 最多注入这么多字符

/** 加载单个 skill 的 PROMPT.md（完整，不截断） */
async function loadSkillDocs(skillName: string): Promise<string> {
  const skillDir = join(SKILLS_DIR, skillName);

  try {
    const prompt = await readFile(resolve(skillDir, 'PROMPT.md'), 'utf-8');
    const trimmed = prompt.trim();
    if (!trimmed) return '';
    return `## ${skillName}\n${trimmed}`;
  } catch {
    return '';
  }
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
