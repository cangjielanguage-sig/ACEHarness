# Claude SDK Plan 相关本地改动说明（冲突恢复用）

> 用途：与远端同步若覆盖本地，可按本文在对应文件中恢复实现。  
> 涉及：**plan 交付物多通道捕获**、**步骤校验**、**刷新后人工审查弹窗**。

---

## 1. 问题背景（为何要改）

- Plan 模式下 SDK 往往在 **`canUseTool` 之前**就处理工具权限，原先在 `canUseTool` 里拦 `Write` **经常捕不到**正文，最终只剩 `result`/流式摘要。
- 刷新页面后 **`humanApprovalData` 丢失**，因只依赖 SSE `human-approval-required`，**`fetchCurrentStatus` 未恢复**弹窗。
- 事件里字段名为 **`suggestedNextState`**，工作台曾只读 **`nextState`**，导致建议下一状态为空。

---

## 2. 改动文件清单

| 文件 | 作用 |
|------|------|
| [`src/lib/engines/claude-sdk-plan.ts`](../src/lib/engines/claude-sdk-plan.ts) | Hooks + `user` 消息 + 合并优先级 + 跨轮保留 `capturedDeliverable` |
| [`src/lib/state-machine-workflow-manager.ts`](../src/lib/state-machine-workflow-manager.ts) | FS 兜底、`getStatus` 扩展、事件字段、校验闸门、评审路径日志 |
| [`src/app/workbench/[config]/page.tsx`](../src/app/workbench/[config]/page.tsx) | 轮询状态恢复人工审查弹窗、`human-approval-required` 兼容 `nextState` |
| [`src/lib/api.ts`](../src/lib/api.ts) | `WorkflowStatusResponse` 增加 `workflowMode`、`pendingHumanApproval` |
| [`src/lib/engines/claude-sdk-plan.test.ts`](../src/lib/engines/claude-sdk-plan.test.ts) | 独立脚本测试 `setCapturedDeliverable` 优先级（可选） |

---

## 3. `claude-sdk-plan.ts` 要点

- **`CapturedVia`**：`hook_exit` | `hook_write` | `user_msg` | `canUseTool` | `filesystem`；**数字越小优先级越高**（高优先级不被低优先级覆盖）。
- **`setCapturedDeliverable(content, filePath, via)`**：统一写入 `_capturedDeliverable` / `_planFilePath` / `_capturedVia`，并 `emit('plan-file-captured', { via })`。
- **`sdkOptions.hooks`**：
  - `PostToolUse` + matcher `ExitPlanMode`：从 `input.tool_response` 取 `plan`、`filePath`。
  - `PreToolUse` + matcher `Write`：路径含 `.claude/plans` 时从 `tool_input` 取内容。
- **消息循环** `case 'user'`：`tool_use_result.plan` 为字符串时调用 `setCapturedDeliverable(..., 'user_msg')`。
- **不要在每次 `execute()` 开头清空** `_capturedDeliverable` / `_planFilePath`（仅重置 `streamContent` 等按轮状态），避免多轮 `resume` 丢正文。
- **`canUseTool`** 里 `Write` 改为走 `setCapturedDeliverable(..., 'canUseTool')`；`ExitPlanMode` 仍要求已有 `_capturedDeliverable`（任一路径写入即可）。

---

## 4. `state-machine-workflow-manager.ts` 要点

### 4.1 `readLatestPlanFile(workDir)`

- 读取 `workDir/.claude/plans/` 下 **mtime 最新**文件全文；失败返回 `null`。

### 4.2 `executeStepWithSdkPlan` 内

- 变量 **`capturedVia`**：记录最终来自哪条通道（含 `text_marker`、`filesystem`）。
- 每轮在内存捕获之后：**`readLatestPlanFile` 兜底**；若命中则 `planEngine.setCapturedDeliverable(..., 'filesystem')` 并 `planCompleted = true`。
- **校验闸门**：`MIN_PLAN_LENGTH = 200`；若 **`!planCompleted` 且** `cleanPlanMarkers(accumulatedOutput)` 长度不足 → 步骤 **failed**、写日志、`throw`，避免「短摘要当成功」。
- **成功时日志**：`[SDK-Plan] 步骤完成 { captured_via, content_length, planFilePath, planCompleted }`。
- **`step-complete`** 成功分支增加 **`capturedVia`** 字段（若类型需对齐前端可再收敛）。

### 4.3 `getStatus()`

- 增加 **`workflowMode: 'state-machine'`**。
- 当 `currentState === '__human_approval__'` 且存在 **`pendingApprovalInfo`** 时返回 **`pendingHumanApproval`**：
  - `sourceState`：从 `stateHistory` 里最后一条 `to === '__human_approval__'` 的 `from`。
  - `nextState` / `suggestedNextState` / `result` / `availableStates`。

### 4.4 `human-approval-required` 三处 emit

- 统一带 **`nextState`** 与 **`suggestedNextState`**（同值即可）。
- **主路径**：`currentState` 用 **`fromStateName`**（进入审批前刚跑完的业务状态名），不要用裸 `'__human_approval__'`（与历史恢复、弹窗标题一致）。
- **无匹配转移**、**resume 从 `__human_approval__` 继续** 两处同样补全 `nextState`，resume 的 `currentState` 用 **`previousState || '__human_approval__'`**。

---

## 5. `page.tsx`（Workbench）要点

### 5.1 `fetchCurrentStatus`

- 在拉取到非 idle 且为本 config 的状态后，若 **`workflowMode === 'state-machine'`** 或配置为状态机：
  - **`running` 且 `currentPhase === '__human_approval__'`**：用 **`pendingHumanApproval`** 恢复 `setHumanApprovalData`；若无则用 **`stateHistory` + workflow 状态列表** 兜底拼一份。
  - **否则**（非人工审查态）：`setHumanApprovalData(null)`。
- **`status === 'idle'`** 等未进入主分支时：**`setHumanApprovalData(null)`**（避免脏弹窗）。

### 5.2 `handleEvent` → `human-approval-required`

- `nextState` 使用 **`event.data.nextState ?? event.data.suggestedNextState`**。

---

## 6. `api.ts` 要点

- `WorkflowStatusResponse` 增加可选字段：
  - `workflowMode?: 'state-machine'`
  - `pendingHumanApproval?: { sourceState, nextState, suggestedNextState?, result, availableStates }`

---

## 7. 测试与构建

- **类型检查**：`npx tsc --noEmit`
- **Plan 引擎逻辑**（可选）：`npx tsx src/lib/engines/claude-sdk-plan.test.ts`（7 条断言）
- **全量**：`npx next build`

---

## 8. 与「原状态机」关系（同步给同事）

- SDK plan **不替换**状态机：仍由 **`enablePlanLoop` + `usePlanMode` + 引擎 claude-code + SDK 可用** 共同决定分支。
- 未走 plan 的步骤行为应保持不变；冲突解决时优先保证 **非 plan 路径** 的 `executeState` / `executeStep` / 人工审批主流程未被误删。

---

## 9. 远端合并建议

1. 先备份或分支保存当前上述文件。
2. 合并远端后按 **第 2 节清单** 打开每个文件，对照 **第 3–6 节** 补回块级逻辑。
3. 跑 **第 7 节** 命令确认无回归。

---

*文档生成上下文：plan 模式交付物捕获、人工审查刷新恢复、事件字段对齐。*
