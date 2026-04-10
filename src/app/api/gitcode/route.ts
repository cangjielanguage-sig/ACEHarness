import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { resolve } from 'path';

const SCRIPT_PATH = resolve(process.cwd(), 'skills/power-gitcode/scripts/power-gitcode.py');

const ALLOWED_COMMANDS = new Set([
  'create_pr', 'get_pr', 'get_pr_commits', 'get_pr_changed_files', 'get_pr_comments',
  'post_pr_comment', 'add_pr_labels', 'remove_pr_labels', 'assign_pr_testers',
  'check_pr_mergeable', 'merge_pr',
  'create_issue', 'get_issue', 'add_issue_labels', 'post_issue_comment',
  'update_issue', 'update_pr',
  'get_issues_by_pr', 'get_prs_by_issue',
  'list_issue_templates', 'get_issue_template', 'get_pr_template', 'parse_issue_template',
  'get_commit_title', 'create_commit',
  'fork_repo', 'create_release', 'create_label', 'check_repo_public',
]);

function buildArgs(command: string, args: Record<string, any>): string[] {
  const cliArgs: string[] = [command];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue;
    const flag = `--${key.replace(/_/g, '-')}`;
    if (typeof value === 'boolean') {
      if (value) cliArgs.push(flag);
    } else if (Array.isArray(value)) {
      cliArgs.push(flag, value.join(','));
    } else {
      cliArgs.push(flag, String(value));
    }
  }
  return cliArgs;
}

export async function POST(request: NextRequest) {
  try {
    const { command, args = {} } = await request.json();

    if (!command || !ALLOWED_COMMANDS.has(command)) {
      return NextResponse.json({ error: `不允许的命令: ${command}` }, { status: 400 });
    }

    const cliArgs = buildArgs(command, args);

    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile('python3', [SCRIPT_PATH, ...cliArgs], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });

    // Try to parse JSON output
    try {
      const data = JSON.parse(result.stdout);
      return NextResponse.json({ success: true, data });
    } catch {
      return NextResponse.json({ success: true, data: result.stdout.trim(), raw: true });
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || '执行失败' },
      { status: 500 }
    );
  }
}
