import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'yaml';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

interface PromptAnalysisResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  optimizedPrompt: string;
}

/**
 * Analyze prompt effectiveness based on input and output
 */
function analyzePrompt(
  prompt: string,
  output: string,
  context?: string
): PromptAnalysisResult {
  const result: PromptAnalysisResult = {
    score: 70,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    optimizedPrompt: prompt,
  };

  // Check prompt length
  if (prompt.length < 100) {
    result.weaknesses.push('提示词过于简短，可能缺少必要的上下文');
    result.suggestions.push('增加更详细的背景信息和约束条件');
  } else if (prompt.length > 2000) {
    result.weaknesses.push('提示词过长，可能导致 AI 忽略重要信息');
    result.suggestions.push('精简提示词，突出核心要求');
    result.score -= 5;
  } else {
    result.strengths.push('提示词长度适中');
  }

  // Check for structure indicators
  const hasStructure = /#{1,3}\s|\d+\.|\- |\* |\[/.test(prompt);
  if (hasStructure) {
    result.strengths.push('提示词有良好的结构');
  } else {
    result.weaknesses.push('提示词缺少清晰的结构');
    result.suggestions.push('使用标题、列表等格式组织内容');
    result.score -= 5;
  }

  // Check for constraints
  const hasConstraints = /必须|禁止|不要|只能/.test(prompt);
  if (hasConstraints) {
    result.strengths.push('包含明确的约束条件');
  } else {
    result.suggestions.push('添加明确的约束条件和边界说明');
  }

  // Check output quality
  if (output.length > 0) {
    result.strengths.push('成功生成输出');
    if (prompt.includes('json') && !output.includes('{') && !output.includes('[')) {
      result.weaknesses.push('请求 JSON 格式但输出不符合');
      result.suggestions.push('强调输出格式要求，提供示例');
      result.score -= 10;
    }
  } else {
    result.weaknesses.push('未生成有效输出');
    result.score -= 20;
  }

  result.score = Math.max(0, Math.min(100, result.score));

  // Generate optimized prompt
  if (result.weaknesses.length > 0) {
    result.optimizedPrompt = `# 任务要求\n\n${prompt}\n\n## 约束条件\n- 按要求输出格式\n- 确保内容准确完整\n\n## 输出要求\n请按以下格式输出...`;
  }

  return result;
}

/**
 * POST /api/prompt-analysis - Analyze a single prompt
 */
export async function POST(request: NextRequest) {
  try {
    const { prompt, output, context, agentName } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const result = analyzePrompt(prompt, output, context);

    return NextResponse.json({
      success: true,
      agentName,
      analysis: result,
    });
  } catch (error) {
    console.error('Failed to analyze prompt:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

/**
 * GET /api/prompt-analysis?runId=xxx - Analyze all prompts in a run
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    if (!runId) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const runsDir = path.join(process.cwd(), 'runs');
    const runDir = path.join(runsDir, runId);

    try {
      await stat(runDir);
    } catch {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Read run state
    const statePath = path.join(runDir, 'state.yaml');
    const stateContent = await readFile(statePath, 'utf-8');
    const state = parse(stateContent);

    const results = [];
    const logsDir = path.join(runDir, 'logs');

    try {
      const logFiles = await readdir(logsDir);

      for (const logFile of logFiles) {
        if (!logFile.endsWith('.log')) continue;

        const logPath = path.join(logsDir, logFile);
        const logContent = await readFile(logPath, 'utf-8');

        const match = logFile.match(/^(.+?)-(.+?)(?:-迭代\d+)?\.log$/);
        if (!match) continue;

        const [, agentName, stepName] = match;

        // Extract prompt and output from log (simplified)
        const promptMatch = logContent.match(/## 可用 Skills[\s\S]*?## /);
        const outputStart = logContent.indexOf('## ');
        const outputText = outputStart > 0 ? logContent.substring(outputStart, outputStart + 2000) : logContent;

        // For simplicity, analyze based on log content structure
        const analysis = analyzePrompt(
          logContent.substring(0, 3000),
          outputText,
          stepName
        );

        results.push({
          agentName,
          stepName,
          analysis,
        });
      }
    } catch {
      // Logs might not exist
    }

    return NextResponse.json({
      success: true,
      runId,
      steps: results,
      summary: {
        totalSteps: results.length,
        avgScore: results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.analysis.score, 0) / results.length)
          : 0,
      },
    });
  } catch (error) {
    console.error('Failed to analyze run:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}