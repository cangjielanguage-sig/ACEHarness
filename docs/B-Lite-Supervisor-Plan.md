# ACEHarness B-Lite 方案：轻量 Supervisor 协调设计

> 版本：v1.1 | 日期：2026-02-26

## 一、方案定位

**B-Lite 是介于"纯规则路由"和"完整 Supervisor LLM"之间的折衷方案。**

核心思想：

- Agent 在执行前可以声明"我缺什么信息"（`[NEED_INFO]` 协议）
- **Agent 只负责标记"需要人类回答"还是"需要技术信息"**，不指定具体问哪个 Agent
- **"问哪个 Agent"由 Supervisor 决定**：优先用规则（零成本），规则搞不定时才调轻量 LLM
- Supervisor **只做路由**（判断"问谁"），不参与业务内容讨论
- 多轮信息收集有**轮次上限**，到了就强制进入执行

### 职责分离原则

| 角色 | 职责 | 不负责 |
|------|------|--------|
| **Agent** | 领域专业工作 + 判断自己缺什么信息 + 区分"问人"还是"问机器" | 不需要知道团队有哪些 Agent、也不判断该问谁 |
| **Supervisor（路由器）** | 根据问题内容决定转发给哪个 Agent | 不参与业务讨论、不产出内容 |
| **WorkflowManager** | 状态流转、持久化、HITL 暂停/恢复 | 不做路由决策 |

---

## 二、与当前系统的关系

### 当前系统已有的能力

| 能力 | 实现方式 |
|------|---------|
| Agent 输出 verdict（pass/fail/conditional_pass） | judge 角色输出 JSON，`parseVerdict` 解析 |
| Agent 指定 next_state | judge 输出 `next_state` 字段，`parseNextStateFromOutputs` 解析 |
| YAML transition 规则匹配 | `evaluateTransitions` → `matchCondition` 按 verdict/issues 匹配 |
| 人类强制跳转 | `forceTransition` API + `pendingForceTransition` |
| 人类审批（HITL） | `requireHumanApproval` → `waitForHumanApproval` |
| 实时反馈注入 | `inject-feedback` API → `liveFeedback` 数组 |
| 前序产出注入 | `buildStepContext` 自动注入最近 2 个状态的产出 |

### B-Lite 新增的能力

| 能力 | 说明 |
|------|------|
| Agent 声明信息需求 | `[NEED_INFO]` / `[NEED_INFO:human]` 协议，Agent 标记缺少的信息 |
| Supervisor 路由决策 | Agent 只说"要什么"，Supervisor 决定"问谁"（关键词匹配 → 轻量 LLM） |
| 按需 @ 其他 Agent | Supervisor 路由后，系统临时调用目标 Agent 回答问题 |
| 按需向用户提问 | Agent 标记 `[NEED_INFO:human]` 或 Supervisor 判定需要人类时，暂停执行并提问 |
| 多轮信息收集循环 | Agent 执行 → 发现缺信息 → 补充 → Agent 继续 → 直到 `[PLAN_DONE]` |
| 自动注入可选状态 | `buildStepContext` 自动注入当前状态的可转移目标及描述 |

---

## 三、整体架构

```
                          ┌──────────────────────┐
                          │   YAML 工作流配置      │
                          │  (状态 / 步骤 / 转移)   │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │ StateMachineWorkflow  │
                          │      Manager          │
                          │   (复用现有)           │
                          └──────────┬───────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │  executeStepWithInfoGathering()  │
                    │  (新增：包裹原有 executeStep)      │
                    └────────────────┬────────────────┘
                                     │
               ┌─────────────────────▼─────────────────────┐
               │              Agent 执行                     │
               │  输出中包含 [NEED_INFO] 标记？              │
               └─────┬──────────────────────┬──────────────┘
                     │ 是                    │ 否 / [PLAN_DONE]
                     ▼                       ▼
          ┌──────────────────────┐    ┌──────────────┐
          │ 解析 [NEED_INFO] 标记 │    │  正常完成      │
          │ (新增: parseNeedInfo) │    │  (现有流程)    │
          └──────┬───────────────┘    └──────────────┘
                 │
        ┌────────▼────────┐
        │  标记了 :human？ │
        ├─────────────────┤
        │ 是              │──→ 暂停，前端弹窗提问（复用 HITL 机制）
        │                 │
        │ 否（技术问题）   │──→ SupervisorRouter 决定问哪个 Agent
        └─────────────────┘          │
                              ┌──────▼──────────┐
                              │ 两层路由决策      │
                              │ (新增模块)        │
                              ├─────────────────┤
                              │ ①关键词匹配      │──→ 命中 → 调目标 Agent
                              │  (零成本)        │
                              │ ②轻量 LLM       │──→ 兜底 → 调目标 Agent
                              │  (haiku/flash)   │
                              └─────────────────┘
                                       │
                                       ▼
                          拿到回答，注入 Agent 上下文
                                       │
                                       ▼
                          Agent 继续执行（下一轮循环）
```

---

## 四、需要修改的文件清单

### 4.1 Schema 层（数据模型）

#### `src/lib/schemas.ts`

**改动 1：workflowStepSchema 新增 Plan 循环配置**

```typescript
export const workflowStepSchema = z.object({
  name: z.string().min(1),
  agent: z.string().min(1),
  task: z.string().min(1),
  type: z.string().optional(),
  role: z.enum(['attacker', 'defender', 'judge']).optional(),
  constraints: z.array(z.string()).optional(),
  parallelGroup: z.string().optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  // ---- 新增 ----
  enablePlanLoop: z.boolean().optional(),      // 是否启用 Plan 循环
  maxPlanRounds: z.number().min(1).max(10).default(3).optional(),  // 最大 Plan 轮次
});
```

**改动 2：roleConfigSchema 新增路由辅助字段**（给 Supervisor 路由器用，不注入 Agent prompt）

```typescript
export const roleConfigSchema = z.object({
  name: z.string().min(1),
  // ... 现有字段 ...
  // ---- 新增 ----
  keywords: z.array(z.string()).optional(),     // 路由关键词（Supervisor 用来匹配问题）
  description: z.string().optional(),           // Agent 能力描述（Supervisor 用来理解谁能回答什么）
});
```

这两个字段**只供 Supervisor 路由器使用**，不会注入到 Agent 自己的 prompt 中。

### 4.2 核心引擎层

#### 新增 `src/lib/supervisor-router.ts` 🆕

Supervisor 路由决策器，独立纯函数模块。

**新增 vs 复用对照：**

| 功能 | 新增/复用 | 说明 |
|------|----------|------|
| `parseNeedInfo()` | 🆕 新增 | 解析 Agent 输出中的 `[NEED_INFO]` / `[NEED_INFO:human]` 标记 |
| `isPlanDone()` | 🆕 新增 | 检查输出中是否包含 `[PLAN_DONE]` |
| `routeInfoRequest()` | 🆕 新增 | 两层路由决策（关键词 → 轻量 LLM） |
| 调用 LLM | ♻️ 复用 | 底层调用 `processManager.executeClaudeCli` 或 `executeWithEngine`（已有） |

```typescript
// ---- 数据结构 ----

export interface InfoRequest {
  fromAgent: string;           // 发出请求的 Agent
  question: string;            // 问题内容
  isHuman: boolean;            // Agent 是否标记为需要人类回答
}

export interface RouteDecision {
  route_to: string;            // 路由目标: "user" 或 agent 名
  question: string;            // 转发的问题
  reason: string;              // 决策理由（可追溯）
  method: 'human-tag' | 'keyword' | 'llm';  // 使用了哪层决策
}

export interface AgentSummary {
  name: string;
  description: string;
  keywords: string[];
}

// ---- 核心逻辑 ----

/**
 * 从 Agent 输出中解析 [NEED_INFO] 标记
 * 支持两种格式：
 *   [NEED_INFO] 问题描述          → 技术问题，交给 Supervisor 路由
 *   [NEED_INFO:human] 问题描述    → 需要人类回答
 */
export function parseNeedInfo(output: string): InfoRequest[];

/**
 * 检查输出中是否包含 [PLAN_DONE] 标记
 */
export function isPlanDone(output: string): boolean;

/**
 * 路由决策（仅处理技术问题，isHuman=true 的不经过这里）
 * 第①层：关键词匹配（问题内容包含某个 Agent 的 keywords）
 * 第②层：轻量 LLM（关键词不命中时，调用小模型做路由）
 */
export async function routeInfoRequest(
  req: InfoRequest,
  availableAgents: AgentSummary[],
  currentStep: string,
  llmCaller?: (prompt: string) => Promise<string>
): Promise<RouteDecision>;
```

#### 修改 `src/lib/state-machine-workflow-manager.ts`

**新增 vs 复用对照：**

| 方法 | 新增/复用 | 说明 |
|------|----------|------|
| `executeStep()` | ♻️ 不改 | 单步执行逻辑完全复用 |
| `executeStepWithInfoGathering()` | 🆕 新增 | 在 executeStep 外层套信息收集循环 |
| `buildStepContext()` | ♻️ 改动两处 | 追加可选状态注入 + 信息请求协议注入 |
| `executeState()` | ♻️ 改动一处 | 判断是否走 info gathering |
| `runAgentStep()` | ♻️ 不改 | 底层 CLI 调用完全复用 |
| `executeWithEngine()` | ♻️ 不改 | 引擎调用完全复用 |
| `waitForHumanApproval()` | ♻️ 复用 | 等待用户回答时复用此机制 |
| `liveFeedback` 机制 | ♻️ 复用 | 用户回答通过 injectLiveFeedback 注入 |
| `queryAgent()` | 🆕 新增 | 临时调用目标 Agent 做单次问答 |
| `buildAgentSummaries()` | 🆕 新增 | 构建 Agent 摘要列表供路由器使用 |
| `callLightweightLLM()` | 🆕 新增 | 调用小模型做路由决策 |

---

**改动 1：新增 `executeStepWithInfoGathering` 方法** 🆕

在 `executeState` 中，对标记了 `enablePlanLoop: true` 的步骤，用此方法包裹原有的 `executeStep`。

```typescript
private async executeStepWithInfoGathering(
  step: WorkflowStep,
  state: StateMachineState,
  config: StateMachineWorkflowConfig,
  requirements?: string
): Promise<string> {
  const maxRounds = step.maxPlanRounds || 3;
  let round = 0;
  let extraContext = '';

  while (round < maxRounds) {
    // ♻️ 复用现有 executeStep，只多传一个 extraContext
    const output = await this.executeStep(step, state, config, requirements, extraContext);

    // 🆕 解析信息请求
    const infoRequests = parseNeedInfo(output);
    if (infoRequests.length === 0 || isPlanDone(output)) {
      return output;  // 信息已够，返回最终输出
    }

    // 分发每条信息请求
    for (const req of infoRequests) {
      if (req.isHuman) {
        // ♻️ 复用现有 HITL 机制（类似 waitForHumanApproval 的等待模式）
        this.emit('plan-question', { question: req.question, fromAgent: step.agent, round });
        const answer = await this.waitForUserAnswer();  // 🆕 但等待模式复用 approval 轮询
        extraContext += `\n\n[用户回答] ${req.question}\n${answer}`;
      } else {
        // 🆕 Supervisor 路由：决定问哪个 Agent
        const agentSummaries = this.buildAgentSummaries();
        const decision = await routeInfoRequest(
          req, agentSummaries, step.name, this.callLightweightLLM.bind(this)
        );
        this.emit('route-decision', { ...decision, round });

        // 🆕 临时调用目标 Agent
        const answer = await this.queryAgent(decision.route_to, decision.question, config);
        extraContext += `\n\n[${decision.route_to} 回答] ${decision.question}\n${answer}`;
      }
    }

    this.emit('plan-round', { step: step.name, round: round + 1, maxRounds, infoRequests });
    round++;
  }

  // 超过轮次上限，强制进入执行
  extraContext += '\n\n[系统] 信息收集已达轮次上限，请基于现有信息执行任务。';
  return this.executeStep(step, state, config, requirements, extraContext);
}
```

**改动 2：`executeState` 中判断是否启用信息收集** ♻️ 改动一行

```typescript
// 原来：
const output = await this.executeStep(step, state, config, requirements);

// 改为：
const output = step.enablePlanLoop
  ? await this.executeStepWithInfoGathering(step, state, config, requirements)
  : await this.executeStep(step, state, config, requirements);
```

**改动 3：`buildStepContext` 自动注入可选状态** ♻️ 追加内容

在 `buildStepContext` 末尾新增一段，自动告诉 Agent 当前状态可以跳转到哪些目标状态：

```typescript
// 自动注入可选的下一状态及描述
if (state.transitions && state.transitions.length > 0) {
  parts.push(`\n# 可选的下一状态`);
  for (const t of state.transitions) {
    const targetState = config.workflow.states.find(s => s.name === t.to);
    parts.push(`- ${t.to}: ${targetState?.description || '无描述'}`);
  }
}
```

**改动 4：`buildStepContext` 注入信息请求协议** ♻️ 追加内容

当 step 开启了 `enablePlanLoop` 时，在 prompt 末尾追加协议说明。**注意：不注入 Agent 列表**，Agent 不需要知道团队编制。

```typescript
if (step.enablePlanLoop) {
  parts.push(`\n# 信息请求协议`);
  parts.push(`在执行任务前，请先评估你是否有足够的信息。`);
  parts.push(`如果信息不足，请使用以下格式声明：`);
  parts.push(`- 需要技术/专业信息：[NEED_INFO] 问题描述`);
  parts.push(`- 需要用户/人类确认：[NEED_INFO:human] 问题描述`);
  parts.push(`- 信息已充分可以执行：[PLAN_DONE]`);
  parts.push(`\n注意：你不需要指定由谁来回答技术问题，系统会自动路由到合适的专家。`);
}
```

**改动 5：新增辅助方法** 🆕

```typescript
/** 🆕 构建可用 Agent 摘要列表（供 Supervisor 路由器使用，不注入 Agent prompt） */
private buildAgentSummaries(): AgentSummary[];

/** 🆕 临时调用目标 Agent 回答问题（单次问答，不走完整 step 流程） */
private async queryAgent(agentName: string, question: string, config: StateMachineWorkflowConfig): Promise<string>;

/** 🆕 调用轻量 LLM 做路由决策 */
private async callLightweightLLM(prompt: string): Promise<string>;

/**
 * 🆕 等待用户回答
 * 实现上复用 ♻️ waitForHumanApproval 的轮询等待模式：
 * 设置 pendingUserQuestion → 前端展示 → 用户通过 API 提交回答 → resolve
 */
private async waitForUserAnswer(): Promise<string>;
```

#### 修改 `src/lib/workflow-manager.ts`（phase-based 模式）

与状态机模式相同的改动：在 `executeStep` 外层套 `executeStepWithPlanLoop`。

可以将核心逻辑抽到 `supervisor-router.ts` 中复用，两个 manager 只需要调用公共方法。

### 4.3 API 层

#### 新增 `src/app/api/workflow/plan-answer/route.ts`

用户回答 Agent 提问的 API 端点：

```typescript
export async function POST(request: NextRequest) {
  const { answer } = await request.json();
  // 将 answer 传递给正在等待的 waitForUserAnswer()
  // 复用现有的 approval/feedback 注入机制
}
```

#### 修改 `src/app/api/workflow/events/route.ts`

新增 SSE 事件类型：

```typescript
// 状态机专属事件 smHandlers 中新增：
'plan-question': (data: any) => sendEvent({ type: 'plan-question', data }),
'plan-round': (data: any) => sendEvent({ type: 'plan-round', data }),
'route-decision': (data: any) => sendEvent({ type: 'route-decision', data }),
```

### 4.4 Agent 配置层

#### 修改 `configs/agents/*.yaml`

在每个 Agent 配置中**可选地**新增 `keywords` 和 `description` 字段。

**重要：这些字段是给 Supervisor 路由器用的，不会注入到 Agent 自己的 prompt 中。Agent 完全不需要知道团队有哪些成员。**

```yaml
# configs/agents/architect.yaml
name: architect
description: 负责系统架构设计、模块划分、接口定义、技术选型  # 🆕 给 Supervisor 看
keywords:  # 🆕 给 Supervisor 做关键词路由
  - 架构
  - 接口
  - 模块
  - API
  - 设计模式
  - 分层
  - 技术方案
# ... systemPrompt, capabilities 等不变 ...
```

```yaml
# configs/agents/tester.yaml
name: tester
description: 负责测试策略、用例设计、质量验证
keywords: [测试, 用例, 覆盖率, 断言, mock, 质量]
```

```yaml
# configs/agents/developer.yaml
name: developer
description: 负责代码实现、功能开发、bug修复
keywords: [实现, 编码, 开发, 修复, 代码, 重构]
```

#### 修改工作流 YAML（按需启用 Plan 循环）

```yaml
# configs/workflow-mimalloc-v2.yaml
states:
  - name: 设计方案
    steps:
      - name: 设计集成方案
        agent: architect
        task: 设计 mimalloc 集成方案...
        role: defender
        enablePlanLoop: true        # ← 启用 Plan 循环
        maxPlanRounds: 3            # ← 最多 3 轮信息收集
      - name: 攻击设计方案
        agent: design-breaker
        task: 分析设计方案...
        role: attacker
        # 不启用 Plan 循环（攻击者不需要主动要信息）
      - name: 评审方案
        agent: design-judge
        task: 评审集成方案...
        role: judge
        enablePlanLoop: true        # ← judge 也可以启用
        maxPlanRounds: 2
```

### 4.5 前端层

#### 修改 `src/components/StateMachineExecutionView.tsx`

新增 "Agent 提问" 弹窗组件，当收到 SSE `plan-question` 事件时弹出：

```
┌──────────────────────────────────────────────┐
│  📋 architect 需要确认信息                     │
│                                              │
│  问题：是否需要支持多租户部署模式？              │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  请输入您的回答...                     │    │
│  └──────────────────────────────────────┘    │
│                                              │
│           [ 提交回答 ]    [ 跳过 ]            │
└──────────────────────────────────────────────┘
```

#### 修改 `src/components/StateMachineRuntimePanel.tsx`

在运行时面板中展示 Plan 循环状态：

- 当前处于第 N / M 轮 Plan
- 已完成的信息收集记录（问了谁、问了什么、回答了什么）
- 路由决策日志（用了哪层路由、为什么）

---

## 五、配置流程（端到端）

### 步骤 1：配置 Agent（一次性）

在 `configs/agents/` 下为每个 Agent 添加 `keywords` 和 `description`：

```yaml
name: architect
description: 负责系统架构设计、模块划分、接口定义
keywords: [架构, 接口, 模块, API, 设计, 分层]
# ... systemPrompt, capabilities 等保持不变 ...
```

### 步骤 2：配置工作流 YAML

在需要信息协调的 step 上启用 `enablePlanLoop`：

```yaml
workflow:
  name: 我的项目工作流
  mode: state-machine
  states:
    - name: 需求分析
      isInitial: true
      steps:
        - name: 分析需求
          agent: architect
          task: 分析项目需求，制定技术方案
          enablePlanLoop: true      # ← 开启
          maxPlanRounds: 3          # ← 最多问 3 轮
      transitions:
        - to: 编码实现
          condition: { verdict: pass }
```

### 步骤 3：运行工作流

```
用户点击 "开始" → 系统执行工作流
    │
    ▼
architect 开始执行 "分析需求" 步骤
    │
    ├── Agent 输出中无 [NEED_INFO] → 正常完成（和以前一样）
    │
    └── Agent 输出中有 [NEED_INFO]：
        │
        │   [NEED_INFO:human] 项目是否需要支持离线模式？
        │   [NEED_INFO] 当前测试覆盖率是多少？
        │
        ├── Q1: 标记了 :human → 直接前端弹窗给用户
        │      用户回答："是，需要支持离线"
        │
        ├── Q2: 技术问题 → Supervisor 路由
        │      ├── 关键词匹配："覆盖率" 命中 tester 的 keywords
        │      └── 调用 tester Agent 回答
        │      tester 回答："当前覆盖率 67%"
        │
        ├── 两个回答注入 architect 的上下文
        │
        └── architect 继续执行（第 2 轮）
            │
            ├── 输出 [PLAN_DONE] → 正式产出
            └── 又有 [NEED_INFO] → 继续循环（直到第 3 轮上限）
```

### 步骤 4：查看执行过程

前端实时展示：

- SSE `plan-round` 事件 → 显示 "Plan 第 2/3 轮"
- SSE `plan-question` 事件 → 弹窗请用户回答
- SSE `route-decision` 事件 → 日志面板显示路由决策

---

## 六、现有流程 vs B-Lite 改动对照

按照一次完整执行的逻辑链路，逐环节说明"现在是什么样"→"B-Lite 要做什么改动"。

### 6.1 配置加载阶段

**现有流程：**

```
启动 → 读 configs/agents/*.yaml → 加载 agentConfigs（name, model, systemPrompt, capabilities...）
     → 读 configs/workflow-*.yaml → 解析 schemas.ts 校验
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| Agent YAML 有 name, team, model, systemPrompt, capabilities, constraints, allowedTools 等字段 | **追加** `keywords` 和 `description` 两个可选字段（给 Supervisor 路由器用，不影响 Agent 自身） |
| Step schema 有 name, agent, task, role, enableReviewPanel, skills 等字段 | **追加** `enablePlanLoop`（bool）和 `maxPlanRounds`（number）两个可选字段 |
| schemas.ts 做 Zod 校验 | **修改** workflowStepSchema 和 roleConfigSchema，各加几个 optional 字段（+10 行） |

### 6.2 工作流启动 → 状态执行阶段

**现有流程：**

```
用户点击开始 → API /workflow/start
  → StateMachineWorkflowManager.start()
    → executeStateMachine() 主循环
      → 找到当前状态 → executeState()
        → 遍历 state.steps
          → 对每个 step 调 executeStep()
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| `executeState()` 遍历 steps，逐个调 `executeStep()` | **改一行**：判断 `step.enablePlanLoop`，是则调新方法 `executeStepWithInfoGathering()`，否则走原路径 |
| `executeStep()` 构建上下文 → 调引擎 → 返回输出 | **不改**，完全复用 |

### 6.3 构建 Prompt 阶段（buildStepContext）

**现有流程：**

```
buildStepContext() 按顺序拼接：
  ├── 当前状态名 + 描述
  ├── 当前任务名 + task 描述
  ├── 需求说明（requirements）
  ├── 全局上下文（globalContext）
  ├── 状态上下文（stateContexts）
  ├── 项目路径
  ├── 文档输出路径
  ├── 可用 Skills
  ├── 实时反馈（liveFeedback）
  ├── 状态转移历史（最近 5 条）
  ├── 已发现的问题（最近 10 条）
  └── 前置步骤结论（最近 2 个状态的产出）
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| 注入了历史、问题、产出等上下文 | **不改**任何现有注入 |
| 没有注入可选的下一状态 | **追加**：遍历当前状态的 transitions，注入目标状态名 + 描述 |
| 没有信息请求协议 | **追加**：当 `enablePlanLoop=true` 时，注入 `[NEED_INFO]` / `[NEED_INFO:human]` / `[PLAN_DONE]` 协议说明 |
| ~~注入 Agent 列表~~ | **不做**。Agent 不需要知道团队编制 |

### 6.4 Agent 执行阶段（runAgentStep → 引擎调用）

**现有流程：**

```
runAgentStep()
  → executeWithEngine()
    ├── claude-code: processManager.executeClaudeCli()
    └── kiro-cli: KiroCliEngineWrapper.execute()
  → 返回结果（output + session_id）
  → 处理 liveFeedback 中断/续跑
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| `runAgentStep()` 完整的执行+中断+续跑逻辑 | **不改** |
| `processManager.executeClaudeCli()` | **不改** |
| 引擎层（kiro-cli 等） | **不改** |
| liveFeedback 中断机制 | **不改**，且复用其等待模式给 `waitForUserAnswer` |

### 6.5 🆕 信息收集循环（新增环节）

**现有流程中没有这个环节。** B-Lite 在 6.4 的外层套一个循环。

```
🆕 executeStepWithInfoGathering()
  │
  ├── 调 executeStep()（♻️ 复用 6.4）
  │       ↓
  ├── 🆕 parseNeedInfo(output)：解析 [NEED_INFO] / [NEED_INFO:human]
  │       ↓
  ├── 没有 NEED_INFO 或有 PLAN_DONE？ → 返回输出（结束循环）
  │       ↓
  ├── 有 NEED_INFO → 逐条处理：
  │   │
  │   ├── isHuman=true → emit 'plan-question' 事件
  │   │   → 🆕 waitForUserAnswer()（实现上复用 ♻️ waitForHumanApproval 的轮询模式）
  │   │   → 用户通过 🆕 /api/workflow/plan-answer 提交回答
  │   │   → 回答注入 extraContext
  │   │
  │   └── isHuman=false → 🆕 Supervisor 路由
  │       → 🆕 routeInfoRequest()（supervisor-router.ts）
  │         ├── 第①层：关键词匹配（Agent YAML 的 keywords 字段）
  │         └── 第②层：轻量 LLM 兜底（🆕 callLightweightLLM）
  │       → 🆕 queryAgent()：临时调一次目标 Agent（底层 ♻️ 复用 executeWithEngine）
  │       → 回答注入 extraContext
  │
  ├── emit 'plan-round' 事件
  ├── round++ → 未达 maxPlanRounds？→ 回到顶部继续循环
  └── 达到上限 → 强制进入执行（调 executeStep 带 extraContext）
```

**这个环节涉及的新增/复用明细：**

| 功能 | 新增/复用 | 说明 |
|------|----------|------|
| `executeStepWithInfoGathering()` | 🆕 新增 | 循环主体，约 60 行 |
| `parseNeedInfo()` | 🆕 新增 | 正则解析，在 `supervisor-router.ts` 中，约 20 行 |
| `isPlanDone()` | 🆕 新增 | 简单检查，约 3 行 |
| `routeInfoRequest()` | 🆕 新增 | 两层路由逻辑，在 `supervisor-router.ts` 中，约 80 行 |
| `callLightweightLLM()` | 🆕 新增 | 调小模型做路由，底层 ♻️ 复用 `executeWithEngine`，约 30 行 |
| `queryAgent()` | 🆕 新增 | 临时调目标 Agent，底层 ♻️ 复用 `executeWithEngine`，约 40 行 |
| `waitForUserAnswer()` | 🆕 新增 | 实现上 ♻️ 复用 `waitForHumanApproval` 的 setInterval 轮询模式，约 20 行 |
| `buildAgentSummaries()` | 🆕 新增 | 把 agentConfigs 转成路由器需要的摘要格式，约 15 行 |
| `executeStep()` | ♻️ 复用 | 作为循环内的执行单元，不改 |
| `executeWithEngine()` | ♻️ 复用 | queryAgent 和 callLightweightLLM 的底层调用 |
| liveFeedback 中断机制 | ♻️ 复用 | waitForUserAnswer 的等待模式 |

### 6.6 状态转移阶段（evaluateTransitions）

**现有流程：**

```
executeState() 返回 StateExecutionResult（verdict + issues）
  → evaluateTransitions()
    ├── ① 人类强制跳转（pendingForceTransition）
    ├── ② Agent 输出的 next_state（parseNextStateFromOutputs）
    ├── ③ YAML transition 规则匹配（matchCondition）
    └── 全不命中 → 升级给人类
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| 三层决策链（人类 > AI建议 > 规则） | **不改** |
| `parseNextStateFromOutputs` 解析 next_state | **不改** |
| `matchCondition` 按 verdict/issues 匹配 | **不改** |
| `requireHumanApproval` → `waitForHumanApproval` | **不改** |

### 6.7 SSE 事件 → 前端展示阶段

**现有流程：**

```
Manager emit 事件 → events/route.ts 监听 → SSE 推送 → 前端组件响应
  现有事件：status, phase, step, result, checkpoint, agents,
           iteration, escalation, token-usage, feedback-injected,
           sm-transition, human-approval-required 等
```

| 现有能力 | B-Lite 改动 |
|---------|------------|
| SSE 事件流 | **追加** 3 个事件类型：`plan-question`、`plan-round`、`route-decision` |
| `events/route.ts` 事件监听 | **追加** 3 行 handler 注册 |
| 前端 checkpoint 弹窗 | **不改**，作为 Agent 提问弹窗的参考/复用 |
| 前端运行时面板 | **追加** 信息收集轮次展示 + 路由决策日志 |
| 🆕 `/api/workflow/plan-answer` | **新增** API 端点，用户提交回答 |

### 6.8 总结

```
配置加载      → 追加 keywords/description/enablePlanLoop 字段
工作流启动    → 不改
状态执行      → executeState 改一行判断
构建 Prompt   → buildStepContext 追加两段注入
Agent 执行    → 不改（runAgentStep / executeWithEngine）
🆕 信息收集   → 新增环节（循环 + 解析 + 路由 + 问答）
状态转移      → 不改（三层决策链）
SSE/前端      → 追加 3 个事件 + 提问弹窗
```

**总代码变动：约 400 行新增 + 20 行修改**，不删除任何现有代码。

---

## 七、收益分析

### 7.1 功能收益

| 收益 | 说明 |
|------|------|
| **Agent 从"被动执行"变为"主动协作"** | Agent 不再只是接收前序产出，而是能主动发现信息缺口、请求补充 |
| **信息按需获取** | 不再把所有前序产出塞进 prompt（省 token），只拿真正需要的 |
| **精准的人机交互** | 用户不再面对笼统的 "请审批"，而是回答具体问题（"是否支持离线？"） |
| **跨 Agent 信息流通** | architect 可以直接获取 tester 的信息，无需等到 tester 的 step 执行完 |
| **减少 YAML task 手写量** | 可选状态自动注入，Agent 不再需要在 task 里硬写 `next_state` 候选值 |

### 7.2 成本收益

| 指标 | 当前系统 | B-Lite |
|------|---------|--------|
| 典型 step 的 LLM 调用 | 1 次 | 1 次（不开 Plan 循环时零变化） |
| 有信息需求时 | 无法处理，Agent 基于不完整信息执行 | +1~3 次 Agent 调用 + 偶尔 1 次小模型路由 |
| Supervisor 成本 | 0 | 每次路由约 $0.001（haiku 级别，500 token 输入 + 100 token 输出） |
| 结果质量 | Agent 可能因信息不足产出低质量结果，需要人工迭代 | 信息充分后再执行，减少返工轮次 |

**关键点**：Plan 循环带来的额外调用成本，很可能小于"信息不足 → 产出不对 → 人工 iterate → 重跑整个 phase"的成本。

### 7.3 架构收益

| 收益 | 说明 |
|------|------|
| **渐进式启用** | 只对需要的 step 开 `enablePlanLoop`，其余完全不受影响 |
| **独立可测** | `supervisor-router.ts` 是纯函数模块，可以单独写单元测试 |
| **为方案 B 铺路** | 如果后续需要完整 Supervisor，只需替换 `routeInfoRequest` 的第③层实现 |
| **规则 + LLM 分层** | 大部分路由走零成本规则，仅边界情况才用 LLM，既灵活又经济 |

### 7.4 对比：不做 B-Lite 的代价

如果继续用当前系统，遇到 Agent 信息不足时只能：

1. 人工在前端 inject-feedback，手动补充信息 → **低效**
2. 在 YAML task 里预写所有可能的上下文 → **prompt 膨胀、维护成本高**
3. Agent 基于不完整信息产出 → **质量差、需要多轮 iterate** → **成本反而更高**

---

## 八、实施计划

| 阶段 | 内容 | 预估工期 |
|------|------|---------|
| **P0** | `supervisor-router.ts`（parseNeedInfo + 三层路由） | 0.5 天 |
| **P0** | `state-machine-workflow-manager.ts` 新增 `executeStepWithPlanLoop` | 1 天 |
| **P0** | `buildStepContext` 注入可选状态 + Plan 协议 | 0.5 天 |
| **P1** | `schemas.ts` 字段扩展 + Agent YAML 加 keywords | 0.5 天 |
| **P1** | SSE 新事件 + `plan-answer` API | 0.5 天 |
| **P2** | 前端 Agent 提问弹窗 + Plan 状态展示 | 1 天 |
| **P2** | `workflow-manager.ts` phase-based 模式同步支持 | 0.5 天 |
| 总计 | | **约 4 天** |

### 优先级说明

- **P0**：核心引擎，不做前端也能通过 API / 日志验证
- **P1**：配置和接口层，让流程跑通
- **P2**：前端体验 + phase-based 模式兼容

---

## 九、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Agent 不遵守 `[NEED_INFO]` 格式 | 协议格式极简（只有两种：`[NEED_INFO]` 和 `[NEED_INFO:human]`），降低出错概率；`parseNeedInfo` 做容错 |
| Agent 无限请求信息 | `maxPlanRounds` 硬上限 + 前端显示轮次倒计时 |
| 关键词匹配路由错误 | 关键词不命中时自动 fallback 到轻量 LLM；路由日志含 `method` 和 `reason` 字段可追溯 |
| 轻量 LLM 路由错误 | 决策空间极小（从 N 个 Agent 中选一个），不稳定概率低；错误路由不会崩溃，只是回答不精准 |
| queryAgent 调用超时 | 给 queryAgent 设独立超时（如 60s），超时则跳过该信息请求并在 extraContext 标注 |
| 前端弹窗打断用户 | 弹窗可选"跳过"，系统会在 extraContext 里标注"用户未回答此问题" |
| Agent 该标 :human 没标（或反过来） | 不致命：标错了只是路由路径不同，技术问题给了用户，用户可以跳过；人类问题给了 Agent，Agent 会说"无法回答"，系统可以 fallback 到 HITL |

---

## 十、后续演进路径

```
B-Lite（当前方案）
    │
    ├── 验证有效 + 路由准确率够用 → 保持现状
    │
    ├── 发现规则不够用，路由错误率 > 10%
    │   └── 升级第③层 LLM 为更强模型 / 增加上下文
    │
    ├── 发现需要 Supervisor 做深度协调（多轮对话、任务分解）
    │   └── 升级为方案 B：routeInfoRequest 替换为完整 Supervisor 调用
```
