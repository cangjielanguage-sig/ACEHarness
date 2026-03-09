import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Skills 仓库路径
const SKILLS_REPO_DIR = path.join(process.cwd(), 'skills');
const SKILLS_CONFIG_FILE = path.join(SKILLS_REPO_DIR, 'skills.yaml');
const SKILLS_REPO_URL = 'https://github.com/anthropics/claude-code-skills.git';

async function forcePullSkillsRepo(): Promise<boolean> {
  try {
    if (!await fs.access(SKILLS_REPO_DIR).then(() => true).catch(() => false)) {
      await fs.mkdir(SKILLS_REPO_DIR, { recursive: true });
      await execAsync(`git clone ${SKILLS_REPO_URL} .`, { cwd: SKILLS_REPO_DIR });
    } else {
      await execAsync('git fetch origin main', { cwd: SKILLS_REPO_DIR });
      await execAsync('git reset --hard origin/main', { cwd: SKILLS_REPO_DIR });
      await execAsync('git clean -fd', { cwd: SKILLS_REPO_DIR });
    }
    return true;
  } catch (error) {
    console.error('Failed to pull skills repo:', error);
    return false;
  }
}

export async function GET() {
  try {
    // 检查 skills 目录是否存在
    const skillsDirExists = await fs.access(SKILLS_REPO_DIR).then(() => true).catch(() => false);

    if (!skillsDirExists) {
      return NextResponse.json({
        skills: [],
        isCloned: false,
        message: 'Skills 仓库未初始化'
      });
    }

    // 读取 skills.yaml
    const content = await fs.readFile(SKILLS_CONFIG_FILE, 'utf-8');
    const config = parse(content) as { skills: Array<{
      name: string;
      path: string;
      description: string;
      tags: string[];
      platforms?: string[];
      version?: string;
      updatedAt?: string;
      contributors?: string[];
    }> };

    // 读取每个 skill 的详细描述
    const skillsWithDetails = await Promise.all(
      (config.skills || []).map(async (skill) => {
        const skillPath = path.join(SKILLS_REPO_DIR, '.claude', 'skills', skill.path, 'SKILL.md');
        let detailedDescription = '';
        try {
          detailedDescription = await fs.readFile(skillPath, 'utf-8');
        } catch {
          // 文件不存在
        }
        return {
          ...skill,
          detailedDescription
        };
      })
    );

    return NextResponse.json({
      skills: skillsWithDetails,
      isCloned: true
    });
  } catch (error) {
    console.error('Failed to read skills:', error);
    return NextResponse.json({ error: 'Failed to read skills' }, { status: 500 });
  }
}

// 强制更新 skills 仓库
export async function POST() {
  try {
    const success = await forcePullSkillsRepo();
    if (success) {
      return NextResponse.json({ success: true, message: 'Skills 仓库已强制更新' });
    } else {
      return NextResponse.json({ success: false, error: '强制更新失败' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to sync skills:', error);
    return NextResponse.json({ success: false, error: '强制更新失败' }, { status: 500 });
  }
}