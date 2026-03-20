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
const SKILLS_REPO_URL = 'https://gitcode.com/cjc-compiler-frontend/cangjie_ace_skills.git';
const ANTHROPICS_SKILLS_REPO_URL = 'https://github.com/anthropics/skills.git';

// 检查 skills 目录是否有内容（skills.yaml 存在即视为已初始化）
async function isSkillsInitialized(): Promise<boolean> {
  return fs.access(SKILLS_CONFIG_FILE).then(() => true).catch(() => false);
}

async function forcePullSkillsRepo(): Promise<boolean> {
  try {
    const dirExists = await fs.access(SKILLS_REPO_DIR).then(() => true).catch(() => false);

    if (!dirExists) {
      // 目录不存在，直接克隆
      await execAsync(`git clone ${SKILLS_REPO_URL} ${SKILLS_REPO_DIR}`);
    } else {
      // 目录存在，检查是否是 git 仓库
      const isGitRepo = await fs.access(path.join(SKILLS_REPO_DIR, '.git')).then(() => true).catch(() => false);
      if (isGitRepo) {
        // 已有仓库，拉取最新
        await execAsync('git fetch origin', { cwd: SKILLS_REPO_DIR });
        try {
          await execAsync('git reset --hard origin/main', { cwd: SKILLS_REPO_DIR });
        } catch {
          await execAsync('git reset --hard origin/master', { cwd: SKILLS_REPO_DIR });
        }
        await execAsync('git clean -fd', { cwd: SKILLS_REPO_DIR });
      } else {
        // 目录存在但不是 git 仓库，先克隆到临时目录再替换
        const tmpDir = SKILLS_REPO_DIR + '_tmp';
        // 清理可能残留的临时目录
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        await execAsync(`git clone ${SKILLS_REPO_URL} ${tmpDir}`);
        await fs.rm(SKILLS_REPO_DIR, { recursive: true, force: true });
        await fs.rename(tmpDir, SKILLS_REPO_DIR);
      }
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

    // 检查是否已初始化（有 skills.yaml）
    const initialized = await isSkillsInitialized();
    if (!initialized) {
      return NextResponse.json({
        skills: [],
        isCloned: false,
        message: 'Skills 目录为空，需要拉取仓库'
      });
    }

    // 读取 skills.yaml
    const content = await fs.readFile(SKILLS_CONFIG_FILE, 'utf-8');
    const config = parse(content) as { skills: Array<{
      name: string;
      path: string;
      description: string;
      descriptionZh?: string;
      tags: string[];
      platforms?: string[];
      version?: string;
      updatedAt?: string;
      contributors?: string[];
      source?: string;
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

// 从 Anthropics 官方仓库更新 skills
export async function PUT() {
  try {
    const tmpDir = path.join(process.cwd(), '.tmp_anthropics_skills');
    const targetDir = path.join(SKILLS_REPO_DIR, '.claude', 'skills');

    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    // 克隆 Anthropics 仓库
    await execAsync(`git clone --depth 1 ${ANTHROPICS_SKILLS_REPO_URL} ${tmpDir}`);

    // 复制 skills 到本地
    const skillsSourceDir = path.join(tmpDir, 'skills');
    const entries = await fs.readdir(skillsSourceDir, { withFileTypes: true });
    let updated = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const src = path.join(skillsSourceDir, entry.name);
      const dest = path.join(targetDir, entry.name);
      await fs.cp(src, dest, { recursive: true });
      updated++;
    }

    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `已从 Anthropics 官方更新 ${updated} 个 skills`,
      updated
    });
  } catch (error) {
    console.error('Failed to update Anthropics skills:', error);
    return NextResponse.json({ success: false, error: '从 Anthropics 官方更新失败' }, { status: 500 });
  }
}