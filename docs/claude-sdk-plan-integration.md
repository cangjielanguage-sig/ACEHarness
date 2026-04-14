# Claude Agent SDK Plan 模式接入技术文档

## 概述

本次在 ACEHarness 状态机工作流中接入了 `@anthropic-ai/claude-agent-sdk`，实现了 **SDK Plan 模式**（区别于原有的 `claude` CLI spawn 方式）。该模式支持在需求分析等阶段与用户进行多轮交互澄清，并在 Plan 生成后提供人工审批（通过 / 编辑 / 驳回重做）流程。

---

## 架构概览

```
WorkflowConfig (useSdkPlan: true)
        │
        ▼
StateMachineWorkflowManager.executeStepWithSdkPlan()
        │
        ├─ ClaudeSdkPlanEngine.execute()   ← 进程内 SDK query，非 CLI spawn
        │       │
        │       ├─ permissionMode: 'plan'
        │       ├─ canUseTool → AskUserQuestion → 前端弹窗
        │       ├─ canUseTool → Write (.claude/plans/) → 捕获 Plan 内容
        │       └─ stop_hook / output_parse / filesystem 兜底捕获
        │
        ├─ Plan 落盘 runs/{runId}/plans/{stepKey}.md
        │
        └─ waitForPlanApproval()           ← 暂停等待人工审批
                │
                ├─ approve  → 继续执行
                ├─ edit     → 使用修改后内容继续
                └─ reject   → 注入反馈重新执行（最多 5 轮）
```

---

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/lib/engines/claude-sdk-plan.ts` | SDK Plan 引擎，进程内调用 `query()`，管理 Plan 内容多通道捕获 |
| `src/lib/state-machine-workflow-manager.ts` | 新增 `executeStepWithSdkPlan`、`waitForPlanApproval`、`submitPlanReview`、`getPendingPlanReview` |
| `src/app/api/workflow/plan-answer/route.ts` | 新增 `type=sdk-plan-review` 处理分支，接收前端审批结果 |
| `src/app/api/workflow/events/route.ts` | 注册 `sdk-plan-review` 事件转发到 SSE |
| `src/app/workbench/[config]/page.tsx` | Plan 审批弹窗 UI（预览 / 编辑 / 驳回三种操作） |
| `src/lib/run-state-persistence.ts` | `PersistedRunState` 新增 `pendingPlanReview` 字段 |
| `src/lib/api.ts` | `WorkflowStatusResponse` 新增 `pendingPlanReview` 字段 |

---

## ClaudeSdkPlanEngine 详解

### 触发条件

工作流 step 配置 `useSdkPlan: true` 时，`StateMachineWorkflowManager` 走 `executeStepWithSdkPlan` 分支，使用 `ClaudeSdkPlanEngine` 而非 `processManager.executeClaudeCli`。

### Plan 内容捕获（多通道 + 优先级）

SDK 在 plan 模式下写入 Plan 的路径不固定，引擎实现了四条捕获通道，数字越小优先级越高（高优先级不被低优先级覆盖）：

| 优先级 | 通道 | 说明 |
|--------|------|------|
| 0 | `canUseTool_write` | `canUseTool` 拦截 `Write` 工具，路径含 `.claude/plans` 时直接取内容 |
| 1 | `stop_hook` | SDK `stop` 事件携带的 plan 字段 |
| 2 | `output_parse` | 从 `result` 事件的 `accumulated` 文本中解析 |
| 3 | `filesystem` | 读取 `workDir/.claude/plans/` 下 mtime 最新文件作为兜底 |

核心方法 `setCapturedDeliverable(content, filePath, via)` 统一写入，低优先级通道无法覆盖已有高优先级内容。

### AskUserQuestion 桥接

当 SDK 调用 `AskUserQuestion` 工具时，引擎通过 `canUseTool` 钩子：

1. emit `ask-user-question` 事件，携带问题和选项
2. 暂停执行，等待前端通过 `/api/workflow/plan-answer` POST `type=sdk-plan` 提交答案
3. 答案注入后继续 SDK query

### 子任务遥测

SDK 内部的 `local_agent` 子任务（如"探查目录结构"）会通过 `SdkPlanSubtaskTelemetry` 事件实时上报到前端，展示子任务启动 / 进度 / 完成状态和耗时。

---

## Plan 审批流程

### 流程图

```
executeStepWithSdkPlan
        │
        ▼
  Plan 生成完成
        │
        ▼
  写入 runs/{runId}/plans/{stepKey}.md
        │
        ▼
  emit 'sdk-plan-review' (SSE → 前端)
        │
        ▼
  waitForPlanApproval() 阻塞等待
        │
   ┌────┴────┐────────────┐
   ▼         ▼            ▼
approve     edit        reject
   │         │            │
   │    使用修改后      注入反馈
   │    内容继续       重新执行
   │                   (≤5轮)
   └────┬────┘            │
        ▼                 │
   继续后续步骤 ◄──────────┘
```

### 后端实现

**`waitForPlanApproval()`**（`state-machine-workflow-manager.ts`）：
- emit `sdk-plan-review` 事件，保存 `pendingPlanReviewPayload`
- 创建 Promise，等待 `submitPlanReview()` resolve
- `reject` 动作：将用户反馈拼入 prompt，重新调用 `planEngine.execute()`，最多循环 5 轮
- `edit` 动作：直接使用前端修改后的内容作为 `finalOutput`

**`submitPlanReview()`**：由 `/api/workflow/plan-answer` 路由调用，resolve 等待中的 Promise。

**`getPendingPlanReview()`**：返回当前待审批的 Plan 信息，供页面刷新后状态恢复。

### 前端实现

`page.tsx` 中的审批弹窗提供三个 Tab：

| Tab | 操作 | POST body |
|-----|------|-----------|
| 预览 | Markdown 渲染，点击"确认并继续" | `{ type: 'sdk-plan-review', action: 'approve' }` |
| 编辑 | Textarea 直接修改，点击"保存并继续" | `{ type: 'sdk-plan-review', action: 'edit', content: '...' }` |
| 驳回 | 填写反馈意见，点击"提交驳回反馈" | `{ type: 'sdk-plan-review', action: 'reject', feedback: '...' }` |

页面刷新后，`getStatus()` 返回的 `pendingPlanReview` 字段会自动恢复弹窗状态。

---

## 状态持久化

`PersistedRunState` 新增 `pendingPlanReview` 字段，格式：

```ts
pendingPlanReview: {
  planContent: string;   // Plan 正文
  stepKey: string;       // 如 "需求分析-需求确认"
  agent: string;
  stateName: string;
  stepName: string;
} | null
```

Plan 内容同时落盘到两个位置：
- `runs/{runId}/plans/{stepKey}.md` — 与 run 绑定，便于历史查阅
- `{workingDirectory}/.claude/plans/plan-{timestamp}.md` — SDK 原生目录（best-effort）

---

## 工作流配置示例

```yaml
steps:
  - name: 需求确认
    agent: calc-req-analyst
    role: defender
    useSdkPlan: true          # 启用 SDK Plan 模式
    enablePlanLoop: true      # 允许多轮交互
    maxPlanRounds: 5          # 最多 5 轮驳回重做
    task: >
      澄清需求边界，产出需求摘要...
```

---

## Bash 工具使用约束

Agent 在 SDK Plan 模式下可以调用 Bash 工具。为防止长驻进程（如 `python3 -m http.server`）导致 claude CLI 进程永久阻塞，**应在 systemPrompt 中注入以下约束**：

```
【重要约束 - Bash 工具使用规范】
禁止运行任何会占用前台、持续阻塞的长驻进程，包括但不限于：
http.server、npm start/dev、nginx 等。
验证交付物时，必须仅做静态代码检查或使用 curl/wget 访问已有服务；
若确需临时启动服务，必须使用后台模式并设超时：
`timeout 5 python3 -m http.server 8888 & sleep 2 && curl -s http://localhost:8888 ; kill %1`
```

**根本原因**：`claude` CLI 的 Bash 工具默认超时为 2 分钟，但在某些配置下超时不生效，长驻子进程会导致 claude 进程无法输出 `{"type":"result"}` 行，`processManager` 只能等到 20 分钟总超时才能感知失败。

---

## 与原有 CLI 模式的关系

SDK Plan 模式**不替换**原有的 `processManager.executeClaudeCli` 路径，两者并存：

| 条件 | 执行路径 |
|------|---------|
| `useSdkPlan: true` | `executeStepWithSdkPlan` → `ClaudeSdkPlanEngine` |
| 其他步骤 | `executeStep` → `processManager.executeClaudeCli` |

未走 SDK Plan 的步骤行为完全不变。

---

## 相关 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workflow/plan-answer` | POST | 提交 SDK Plan 问答（`type=sdk-plan`）或审批结果（`type=sdk-plan-review`） |
| `/api/workflow/plan-answer` | GET | 查询当前待审批状态，用于页面刷新恢复 |
| `/api/workflow/events` | GET (SSE) | 实时推送 `sdk-plan-review`、`ask-user-question` 等事件 |
