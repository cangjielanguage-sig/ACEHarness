import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access, readFile } from 'fs/promises';
import { resolve } from 'path';
import { stringify, parse } from 'yaml';
import { spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(spawn);

interface WorkflowTemplate {
  workflow: {
    name: string;
    description?: string;
    type?: string;
    phases?: Array<{
      name: string;
      steps: Array<{
        name: string;
        agent: string;
        task: string;
      }>;
    }>;
    states?: Record<string, any>;
    initialState?: string;
  };
  context: {
    projectRoot?: string;
    requirements?: string;
  };
}

/**
 * 使用 AI 生成工作流配置
 * 目前使用模板生成，后续可扩展为调用 AI API
 */
async function generateWorkflowWithAI(requirements: string, workflowName: string): Promise<WorkflowTemplate> {
  const req = requirements.toLowerCase();

  // 简单的关键词匹配生成模板
  // 后续可以调用 AI API 来生成更智能的配置
  const isCodeReview = req.includes('审查') || req.includes('review') || req.includes('pr');
  const isTesting = req.includes('测试') || req.includes('test');
  const isDesign = req.includes('设计') || req.includes('design');
  const isSecurity = req.includes('安全') || req.includes('security');

  // 默认生成阶段模式
  const phases = [];

  if (isCodeReview) {
    phases.push({
      name: '代码审查',
      steps: [
        { name: '获取代码变更', agent: 'agent-1', task: '获取 PR 的代码变更内容' },
        { name: '执行代码审查', agent: 'agent-1', task: '分析代码变更，进行安全性和质量审查' },
        { name: '生成审查报告', agent: 'agent-1', task: '汇总审查结果，生成审查报告' },
      ],
    });
  }

  if (isTesting) {
    phases.push({
      name: '测试验证',
      steps: [
        { name: '准备测试环境', agent: 'agent-1', task: '搭建测试环境' },
        { name: '执行测试', agent: 'agent-1', task: '运行测试用例' },
        { name: '分析测试结果', agent: 'agent-1', task: '分析测试结果，生成报告' },
      ],
    });
  }

  if (isDesign) {
    phases.push({
      name: '设计评审',
      steps: [
        { name: '需求分析', agent: 'agent-1', task: '分析需求文档' },
        { name: '方案设计', agent: 'agent-1', task: '设计技术方案' },
        { name: '评审确认', agent: 'agent-1', task: '评审并确认设计方案' },
      ],
    });
  }

  if (isSecurity) {
    phases.push({
      name: '安全检测',
      steps: [
        { name: '安全扫描', agent: 'agent-1', task: '执行安全扫描' },
        { name: '漏洞分析', agent: 'agent-1', task: '分析发现的漏洞' },
        { name: '修复建议', agent: 'agent-1', task: '提供漏洞修复建议' },
      ],
    });
  }

  // 如果没有匹配到关键词，生成通用工作流
  if (phases.length === 0) {
    phases.push({
      name: '需求分析',
      steps: [
        { name: '收集需求', agent: 'agent-1', task: requirements },
      ],
    });
    phases.push({
      name: '方案设计',
      steps: [
        { name: '设计解决方案', agent: 'agent-1', task: '根据需求设计解决方案' },
      ],
    });
    phases.push({
      name: '实施执行',
      steps: [
        { name: '执行任务', agent: 'agent-1', task: '实施方案' },
      ],
    });
    phases.push({
      name: '验证确认',
      steps: [
        { name: '验证结果', agent: 'agent-1', task: '验证实施结果' },
      ],
    });
  }

  return {
    workflow: {
      name: workflowName,
      description: requirements,
      type: 'phase-based',
      phases,
    },
    context: {
      projectRoot: '',
      requirements: requirements,
    },
  };
}

/**
 * 验证工作流配置
 */
async function validateWorkflowConfig(config: any): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // 基本验证
  if (!config.workflow) {
    errors.push('缺少 workflow 配置');
    return { valid: false, errors };
  }

  if (!config.workflow.name) {
    errors.push('缺少 workflow.name');
  }

  if (!config.workflow.phases && !config.workflow.states) {
    errors.push('工作流必须包含 phases 或 states');
  }

  if (config.workflow.phases) {
    if (!Array.isArray(config.workflow.phases)) {
      errors.push('workflow.phases 必须是数组');
    } else {
      config.workflow.phases.forEach((phase: any, index: number) => {
        if (!phase.name) {
          errors.push(`阶段 ${index + 1} 缺少名称`);
        }
        if (!phase.steps || !Array.isArray(phase.steps)) {
          errors.push(`阶段 ${index + 1} 缺少 steps 数组`);
        } else {
          phase.steps.forEach((step: any, stepIndex: number) => {
            if (!step.name) {
              errors.push(`阶段 ${index + 1} 的步骤 ${stepIndex + 1} 缺少名称`);
            }
            if (!step.agent) {
              errors.push(`阶段 ${index + 1} 的步骤 ${stepIndex + 1} 缺少 agent`);
            }
            if (!step.task) {
              errors.push(`阶段 ${index + 1} 的步骤 ${stepIndex + 1} 缺少 task`);
            }
          });
        }
      });
    }
  }

  if (config.workflow.states) {
    if (typeof config.workflow.states !== 'object') {
      errors.push('workflow.states 必须是对象');
    } else if (!config.workflow.initialState) {
      errors.push('状态机模式需要指定 initialState');
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requirements, workflowName, filename, description } = body;

    if (!requirements || requirements.trim().length < 10) {
      return NextResponse.json(
        { error: '需求描述太短', message: '请提供更详细的需求描述（至少10个字符）' },
        { status: 400 }
      );
    }

    // 生成工作流配置
    const config = await generateWorkflowWithAI(requirements, workflowName || 'AI生成工作流');

    // 验证配置
    const validation = await validateWorkflowConfig(config);

    return NextResponse.json({
      success: true,
      config: config,
      validation: validation,
      message: validation.valid
        ? '工作流配置已生成并验证通过'
        : '工作流配置已生成，但存在验证问题',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '生成失败', message: error.message },
      { status: 500 }
    );
  }
}
