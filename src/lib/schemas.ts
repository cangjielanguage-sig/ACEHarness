import { z } from 'zod';

// 迭代配置 Schema
export const iterationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxIterations: z.number().min(1).max(20).default(5),
  exitCondition: z.enum(['no_new_bugs_3_rounds', 'all_resolved', 'manual']).default('no_new_bugs_3_rounds'),
  consecutiveCleanRounds: z.number().min(1).max(10).default(3),
  escalateToHuman: z.boolean().default(true),
});

// 工作流步骤 Schema
export const workflowStepSchema = z.object({
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().min(1, 'Agent 名称不能为空'),
  task: z.string().min(1, '任务描述不能为空'),
  type: z.string().optional(),
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
});

// 检查点 Schema
export const checkpointSchema = z.object({
  name: z.string().min(1, '检查点名称不能为空'),
  message: z.string().min(1, '检查点消息不能为空'),
});

// 工作流阶段 Schema
export const workflowPhaseSchema = z.object({
  name: z.string().min(1, '阶段名称不能为空'),
  steps: z.array(workflowStepSchema).min(1, '至少需要一个步骤'),
  checkpoint: checkpointSchema.optional(),
  iteration: iterationConfigSchema.optional(),
});

// 角色配置 Schema
export const roleConfigSchema = z.object({
  name: z.string().min(1, '角色名称不能为空'),
  team: z.enum(['blue', 'red', 'judge'], {
    errorMap: () => ({ message: '团队必须是 blue、red 或 judge' }),
  }),
  model: z.string().min(1, '模型名称不能为空'),
  temperature: z.number().optional(),
  capabilities: z.array(z.string()).min(1, '至少需要一个能力'),
  systemPrompt: z.string().min(1, '系统提示不能为空'),
  constraints: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
});

// 上下文配置 Schema
export const contextConfigSchema = z.object({
  projectRoot: z.string().optional(),
  requirements: z.string().optional(),
  codebase: z.string().optional(),
  timeoutMinutes: z.number().min(1).optional(),
});

// 完整工作流配置 Schema
export const workflowConfigSchema = z.object({
  workflow: z.object({
    name: z.string().min(1, '工作流名称不能为空'),
    description: z.string().optional(),
    phases: z.array(workflowPhaseSchema).min(1, '至少需要一个阶段'),
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

// TypeScript 类型导出
export type IterationConfig = z.infer<typeof iterationConfigSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type WorkflowPhase = z.infer<typeof workflowPhaseSchema>;
export type RoleConfig = z.infer<typeof roleConfigSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

// 新建配置表单 Schema
export const newConfigFormSchema = z.object({
  filename: z
    .string()
    .min(1, '文件名不能为空')
    .regex(/^[a-zA-Z0-9_-]+\.yaml$/, '文件名必须以 .yaml 结尾且只包含字母、数字、下划线和连字符'),
  workflowName: z.string().min(1, '工作流名称不能为空'),
  description: z.string().optional(),
});

export type NewConfigForm = z.infer<typeof newConfigFormSchema>;

// 复制配置表单 Schema
export const copyConfigFormSchema = z.object({
  newFilename: z
    .string()
    .min(1, '文件名不能为空')
    .regex(/^[a-zA-Z0-9_-]+\.yaml$/, '文件名必须以 .yaml 结尾且只包含字母、数字、下划线和连字符'),
});

export type CopyConfigForm = z.infer<typeof copyConfigFormSchema>;

// 运行记录 Schema
export const runRecordSchema = z.object({
  id: z.string(),
  configFile: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'stopped', 'crashed']),
  phaseReached: z.string(),
  totalSteps: z.number(),
  completedSteps: z.number(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;

// 配置摘要（首页卡片用）
export interface ConfigSummary {
  filename: string;
  name: string;
  description: string;
  phaseCount: number;
  stepCount: number;
  agentCount: number;
}
