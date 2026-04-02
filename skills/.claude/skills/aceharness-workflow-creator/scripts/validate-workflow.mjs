#!/usr/bin/env node
/**
 * AceFlow 工作流配置验证脚本
 * 用法: node validate-workflow.mjs <config.yaml>
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

// --- Schemas (mirror of src/lib/schemas.ts) ---

const iterationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxIterations: z.number().min(1).max(20).default(5),
  exitCondition: z.enum(['no_new_bugs_3_rounds', 'all_resolved', 'manual']).default('no_new_bugs_3_rounds'),
  consecutiveCleanRounds: z.number().min(1).max(10).default(3),
  escalateToHuman: z.boolean().default(true),
});

const workflowStepSchema = z.object({
  name: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().min(1),
  type: z.string().optional(),
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
});

const checkpointSchema = z.object({
  name: z.string().min(1),
  message: z.string().min(1),
});

const workflowPhaseSchema = z.object({
  name: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
  checkpoint: checkpointSchema.optional(),
  iteration: iterationConfigSchema.optional(),
});

const contextConfigSchema = z.object({
  projectRoot: z.string().optional(),
  requirements: z.string().optional(),
  codebase: z.string().optional(),
  timeoutMinutes: z.number().min(1).optional(),
  skills: z.array(z.string()).optional(),
});

const transitionConditionSchema = z.object({
  verdict: z.enum(['pass', 'conditional_pass', 'fail']).optional(),
  issueTypes: z.array(z.string()).optional(),
  severities: z.array(z.string()).optional(),
  minIssueCount: z.number().optional(),
  maxIssueCount: z.number().optional(),
  custom: z.string().optional(),
});

const stateTransitionSchema = z.object({
  to: z.string().min(1),
  condition: transitionConditionSchema,
  priority: z.number().default(100),
  label: z.string().optional(),
});

const stateMachineStateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['normal', 'human-checkpoint']).default('normal').optional(),
  requireHumanApproval: z.boolean().default(false).optional(),
  steps: z.array(workflowStepSchema).min(1),
  transitions: z.array(stateTransitionSchema),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  isInitial: z.boolean().default(false),
  isFinal: z.boolean().default(false),
});

const issueRoutingRuleSchema = z.object({
  pattern: z.string().min(1),
  targetState: z.string().min(1),
  issueType: z.enum(['design', 'implementation', 'test', 'performance', 'security']),
  priority: z.number().default(100),
});

const roleConfigSchema = z.object({
  name: z.string().min(1),
  team: z.enum(['blue', 'red', 'judge']),
  model: z.string().min(1),
  temperature: z.number().optional(),
  capabilities: z.array(z.string()).min(1),
  systemPrompt: z.string().min(1),
  iterationPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reviewPanel: z.object({
    enabled: z.boolean(),
    description: z.string().optional(),
    subAgents: z.record(z.object({
      description: z.string(),
      prompt: z.string(),
      tools: z.array(z.string()),
      model: z.string(),
    })),
  }).optional(),
});

// PLACEHOLDER_CONTINUE

const phaseBasedSchema = z.object({
  workflow: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    mode: z.literal('phase-based').optional().default('phase-based'),
    phases: z.array(workflowPhaseSchema).min(1),
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

const stateMachineSchema = z.object({
  workflow: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    mode: z.literal('state-machine'),
    states: z.array(stateMachineStateSchema).min(1),
    issueRouting: z.array(issueRoutingRuleSchema).optional(),
    maxTransitions: z.number().min(1).max(100).default(50),
  }),
  roles: z.array(roleConfigSchema).optional(),
  context: contextConfigSchema,
});

const unifiedSchema = z.union([phaseBasedSchema, stateMachineSchema]);

// --- Validation Logic ---

function getAvailableAgents() {
  const agentsDir = resolve(PROJECT_ROOT, 'configs', 'agents');
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace(/\.yaml$/, ''));
}

function validate(configPath) {
  const errors = [];
  const warnings = [];

  // 1. Read and parse YAML
  let raw, config;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (e) {
    console.error(`❌ 无法读取文件: ${configPath}`);
    process.exit(1);
  }
  try {
    config = parse(raw);
  } catch (e) {
    console.error(`❌ YAML 语法错误: ${e.message}`);
    process.exit(1);
  }

  // 2. Zod schema validation
  const result = unifiedSchema.safeParse(config);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`Schema: ${issue.path.join('.')} - ${issue.message}`);
    }
  }

  // 3. Agent reference check
  const availableAgents = getAvailableAgents();
  const referencedAgents = new Set();
  const mode = config?.workflow?.mode;

  if (mode === 'state-machine' && config?.workflow?.states) {
    for (const state of config.workflow.states) {
      for (const step of state.steps || []) {
        referencedAgents.add(step.agent);
      }
    }
  } else if (config?.workflow?.phases) {
    for (const phase of config.workflow.phases) {
      for (const step of phase.steps || []) {
        referencedAgents.add(step.agent);
      }
    }
  }

  for (const agent of referencedAgents) {
    if (!availableAgents.includes(agent)) {
      errors.push(`Agent "${agent}" 不存在于 configs/agents/，可用: ${availableAgents.join(', ')}`);
    }
  }

  // 4. State-machine specific checks
  if (mode === 'state-machine' && config?.workflow?.states) {
    const states = config.workflow.states;
    const stateNames = new Set(states.map(s => s.name));

    // Check initial/final states
    const initials = states.filter(s => s.isInitial);
    const finals = states.filter(s => s.isFinal);
    if (initials.length === 0) errors.push('缺少初始状态（isInitial: true）');
    if (initials.length > 1) errors.push(`有 ${initials.length} 个初始状态，应该只有 1 个`);
    if (finals.length === 0) errors.push('缺少终止状态（isFinal: true）');

    // Check transition targets
    for (const state of states) {
      for (const t of state.transitions || []) {
        if (!stateNames.has(t.to)) {
          errors.push(`状态 "${state.name}" 的转移目标 "${t.to}" 不存在`);
        }
      }
    }

    // Check final states have no transitions
    for (const state of finals) {
      if (state.transitions && state.transitions.length > 0) {
        warnings.push(`终止状态 "${state.name}" 有 ${state.transitions.length} 个转移规则，通常应为空`);
      }
    }
  }

  // 5. Output results
  console.log(`\n📋 验证: ${configPath}\n`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 配置验证通过！');
    const stateCount = config?.workflow?.states?.length || config?.workflow?.phases?.length || 0;
    let stepCount = 0;
    for (const s of config?.workflow?.states || config?.workflow?.phases || []) {
      stepCount += (s.steps || []).length;
    }
    console.log(`   模式: ${mode || 'phase-based'}`);
    console.log(`   ${mode === 'state-machine' ? '状态' : '阶段'}: ${stateCount}`);
    console.log(`   步骤: ${stepCount}`);
    console.log(`   Agent: ${referencedAgents.size}`);
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`❌ 发现 ${errors.length} 个错误:\n`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} 个警告:\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

// --- Main ---
const configPath = process.argv[2];
if (!configPath) {
  console.error('用法: node validate-workflow.mjs <config.yaml>');
  process.exit(1);
}
validate(resolve(process.cwd(), configPath));
