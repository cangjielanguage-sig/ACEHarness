import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';
import { existsSync } from 'fs';
import { getRuntimeSkillsDirPath, getSkillsTempPath } from '@/lib/runtime-skills';

/** Parse YAML frontmatter from SKILL.md content */
function parseFrontmatter(content: string): Record<string, any> | null {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('---', 3);
  if (endIdx < 0) return null;
  try {
    return parse(content.substring(3, endIdx)) || null;
  } catch {
    return null;
  }
}

/** Scan skills/ directory, find xxx/SKILL.md with valid frontmatter */
async function discoverSkills() {
  const skills: any[] = [];
  try {
    const skillsDir = await getRuntimeSkillsDirPath();
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm || !fm.name) continue; // Must have frontmatter with name

        // Check for PROMPT.md
        const promptMdPath = path.join(skillsDir, entry.name, 'PROMPT.md');
        const hasPromptMd = existsSync(promptMdPath);

        skills.push({
          name: fm.name,
          path: entry.name,
          description: fm.description || '',
          descriptionZh: fm.descriptionZH || '',
          tags: fm.tags || [],
          source: fm.source || 'cangjie',
          hasPromptMd,
          detailedDescription: content,
        });
      } catch { /* no SKILL.md */ }
    }
  } catch { /* skills dir doesn't exist */ }
  return skills;
}

// GET: List all skills
export async function GET() {
  try {
    const skillsDir = await getRuntimeSkillsDirPath();
    const dirExists = existsSync(skillsDir);
    if (!dirExists) {
      return NextResponse.json({ skills: [], isCloned: true, message: 'Skills 目录不存在' });
    }
    const skills = await discoverSkills();
    return NextResponse.json({ skills, isCloned: true });
  } catch (error) {
    console.error('Failed to read skills:', error);
    return NextResponse.json({ error: 'Failed to read skills' }, { status: 500 });
  }
}

// POST: Upload zip to import skills
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '请上传 ZIP 文件' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未找到上传文件' }, { status: 400 });
    }

    // Save zip to temp
    const skillsDir = await getRuntimeSkillsDirPath();
    const tmpDir = getSkillsTempPath('upload');
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, 'upload.zip');
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(zipPath, buffer);

    // Unzip
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(`unzip -o "${zipPath}" -d "${extractDir}"`, { maxBuffer: 50 * 1024 * 1024 });

    // Find valid skills (directories containing SKILL.md)
    const imported: string[] = [];
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(extractDir, entry.name, 'SKILL.md');
      const hasSkillMd = existsSync(skillMd);
      if (!hasSkillMd) continue;

      // Copy to skills/
      const dest = path.join(skillsDir, entry.name);
      await fs.cp(path.join(extractDir, entry.name), dest, { recursive: true });
      imported.push(entry.name);
    }

    // Also check if the zip itself is a single skill (SKILL.md at root of extracted)
    if (imported.length === 0) {
      const rootSkillMd = path.join(extractDir, 'SKILL.md');
      if (existsSync(rootSkillMd)) {
        // Use the zip filename (without .zip) as skill name
        const skillName = file.name.replace(/\.zip$/i, '');
        const dest = path.join(skillsDir, skillName);
        await fs.cp(extractDir, dest, { recursive: true });
        imported.push(skillName);
      }
    }

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    if (imported.length === 0) {
      return NextResponse.json({ error: '未找到有效的 Skill（需包含 SKILL.md）' }, { status: 400 });
    }

    return NextResponse.json({ success: true, imported, message: `导入了 ${imported.length} 个 Skill` });
  } catch (error) {
    console.error('Failed to import skills:', error);
    return NextResponse.json({ error: '导入失败: ' + (error as Error).message }, { status: 500 });
  }
}

// PUT: Export selected skills as zip
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const skillNames: string[] = body.skills || [];
    if (skillNames.length === 0) {
      return NextResponse.json({ error: '请选择要导出的 Skill' }, { status: 400 });
    }

    const skillsDir = await getRuntimeSkillsDirPath();
    // Verify all skills exist
    const missing: string[] = [];
    for (const name of skillNames) {
      if (!existsSync(path.join(skillsDir, name, 'SKILL.md'))) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      return NextResponse.json({ error: `找不到 Skill: ${missing.join(', ')}` }, { status: 404 });
    }

    // Create zip
    const tmpDir = getSkillsTempPath('export');
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tmpDir, { recursive: true });

    // Copy skills to tmp
    for (const name of skillNames) {
      await fs.cp(path.join(skillsDir, name), path.join(tmpDir, name), { recursive: true });
    }

    const zipPath = getSkillsTempPath('skills-export.zip');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { maxBuffer: 50 * 1024 * 1024 });

    const zipBuffer = await fs.readFile(zipPath);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(zipPath, { force: true }).catch(() => {});

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="skills-export.zip"`,
      },
    });
  } catch (error) {
    console.error('Failed to export skills:', error);
    return NextResponse.json({ error: '导出失败: ' + (error as Error).message }, { status: 500 });
  }
}
