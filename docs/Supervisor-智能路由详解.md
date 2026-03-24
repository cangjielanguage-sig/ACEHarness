# Supervisor 智能路由 -- 让 AI 决定找谁干活

> AceFlow 的 Supervisor-Lite 架构将多 Agent 协作从「静态流水线」推进到「动态按需协调」：Agent 只声明自己缺什么，Supervisor 自动判断问谁。

---

## 一、核心问题：多 Agent 系统的信息困境

在传统的多 Agent 工作流中，每个 Agent 按固定顺序执行，拿到前序步骤的全部产出，然后输出自己的结果。这个模式有三个根本性问题：

1. **信息过载**：所有前序产出被塞进 prompt，与当前任务无关的内容占据大量 token，稀释了真正有用的信息。
2. **信息缺口**：Agent 需要的信息可能来自流程中更早的步骤，或来自并不在当前执行链路上的另一个 Agent，甚至需要人工确认 -- 但静态流程无法表达这种跨步骤的信息依赖。
3. **被动执行**：Agent 发现信息不足时，只能基于猜测产出低质量结果，然后等待人工 iterate -- 本质上是把「信息不足」的代价转嫁给了后续环节。

Supervisor-Lite 的核心洞察是：**Agent 自己最清楚自己缺什么信息**，而**谁能回答这个问题**则应该由一个全局视角的路由器来决定。

---

## 二、架构设计：职责分离三角

Supervisor-Lite 严格遵循「职责分离」原则，将多 Agent 协作拆解为三个独立角色：

| 角色 | 职责 | 明确不做的事 |
|------|------|-------------|
| **Agent** | 领域专业工作 + 判断自身信息缺口 + 区分「问人」还是「问机器」 | 不需要知道团队有哪些 Agent，不判断该问谁 |
| **Supervisor（路由器）** | 根据问题内容决定转发给哪个 Agent | 不参与业务讨论、不产出任何内容 |
| **WorkflowManager** | 状态流转、持久化、人机交互暂停/恢复 | 不做路由决策 |

这种分离带来的关键好处是：**Agent 的 prompt 中不包含团队编制信息**。Agent 只需要专注于自己的领域，用简单的标记协议声明信息需求，完全不需要理解系统中存在哪些其他 Agent。这避免了「Agent 列表注入 → prompt 膨胀 → Agent 尝试自行路由 → 路由质量不可控」的常见陷阱。

---

## 三、信息请求协议：极简的 Agent 通信契约

Agent 通过在输出中嵌入结构化标记来声明信息需求：

```
[NEED_INFO] 当前仓颉 SDK 中 file.fs 模块的实现覆盖了哪些方法？
[NEED_INFO:human] 开发的 API 接口是否只包含同步方法，还是同时包含异步方法？
[PLAN_DONE]
```

协议只有三个标记：

| 标记 | 含义 | 处理路径 |
|------|------|---------|
| `[NEED_INFO]` | 需要技术/专业信息 | Supervisor 路由到最合适的 Agent |
| `[NEED_INFO:human]` | 需要人工确认或业务决策 | 直接暂停执行，前端弹窗请用户回答 |
| `[PLAN_DONE]` | 信息已充分，开始正式执行 | 结束信息收集循环，进入执行阶段 |

协议设计的关键取舍：

- **极简**：只有两种需求类型（技术 vs 人工），Agent 几乎不可能用错格式。
- **声明式**：Agent 只声明「我需要什么」，不指定「谁来回答」。这让路由决策完全集中在 Supervisor，Agent 的 prompt 保持纯净。
- **单问题合并**：当 Agent 有多个问题时，只需要列出一个 `[NEED_INFO]` 标记，在问题描述中列出所有子问题。这减少了解析复杂度，也避免了多个问题被拆分成独立路由导致的上下文碎片化。

---

## 四、两层路由决策：规则优先，LLM 兜底

Supervisor 的路由决策采用分层架构，优先使用零成本的规则匹配，仅在规则不命中时才调用 LLM：

```
                    Agent 声明信息需求
                           │
                    ┌──────▼──────┐
                    │ :human 标记？ │
                    └──┬──────┬───┘
                  是   │      │ 否
                       ▼      ▼
                    暂停等   Supervisor 路由
                    待用户        │
                              ┌──▼──────────────┐
                   第①层      │  关键词匹配       │
                              │  (零 LLM 开销)    │
                              └──┬──────────┬───┘
                              命中│          │ 未命中
                                 ▼          ▼
                              路由到     ┌──────────────┐
                              目标Agent  │  轻量 LLM     │   第②层
                                        │  语义路由      │
                                        └──┬───────┬───┘
                                        命中│       │ 未命中
                                           ▼       ▼
                                        路由到   Fallback
                                        目标Agent 到用户
```

### 第①层：关键词匹配

每个 Agent 的 YAML 配置中可以声明 `keywords` 字段，供 Supervisor 做快速匹配：

```yaml
# configs/agents/oh-cangjie-analyst.yaml
keywords:
  - 分析
  - Gap
  - Gap分析
```

当 Agent 的信息请求中包含某个 Agent 的关键词时，Supervisor 直接路由到该 Agent，无需 LLM 调用。这层路由覆盖了大部分场景（领域关键词通常非常明确），成本为零。

### 第②层：轻量 LLM 语义路由

当关键词匹配不命中时，Supervisor 构建一个精简的路由 prompt，调用轻量级模型（默认 `claude-sonnet-4-6`，可通过 `context.routerModel` 配置）做语义级路由：

```
你是一个路由器，需要决定谁最适合回答以下问题。

当前执行步骤: Gap分析

问题: 当前仓颉 SDK 中 file.fs 模块的 FFI 层实现状况如何？

可用 Agent:
- oh-cangjie-analyst: 负责 API 需求解析与 Gap 分析 (关键词: 分析, Gap, Gap分析)
- oh-cangjie-architect: 负责架构设计与模块划分 (关键词: 架构, 设计, 接口)
- oh-cangjie-coder: 负责仓颉与 C++ FFI 编码实现 (关键词: 编码, 实现, FFI)

请选择一个最合适的 Agent 来回答问题。只返回 Agent 名称，不要返回其他内容。
```

路由 prompt 的设计要点：

- **决策空间极小**：从 N 个 Agent 中选一个名字，即使用较小的模型也能保证高准确率。
- **无业务讨论**：Supervisor 只做路由，不参与内容生成，prompt 简短、输出简短，成本约 $0.001/次。
- **容错解析**：对 LLM 的返回做两级匹配 -- 先精确匹配 Agent 名称，再模糊匹配（返回内容中包含某个 Agent 名称即可）。

### Fallback：优雅降级到用户

如果两层路由都未命中（极少出现），系统自动降级为向用户提问。这保证了流程永远不会因路由失败而卡死。

---

## 五、Plan 循环：多轮信息收集与执行分离

Supervisor 路由不是一次性动作，而是嵌入在一个「Plan 循环」中。这个循环将 Agent 的执行拆分为两个阶段：**信息收集阶段**和**正式执行阶段**。

```
Agent 首次执行 ──→ 输出含 [NEED_INFO]？
                         │
                    否    │    是
                    ↓     ↓
              直接完成  ┌─────────────────────────────────────┐
                       │ 循环（最多 maxPlanRounds 轮）         │
                       │                                      │
                       │  解析 [NEED_INFO] ──→ Supervisor 路由 │
                       │                         │             │
                       │              ┌──────────┴──────┐     │
                       │              ▼                  ▼     │
                       │         路由到 Agent        暂停等用户  │
                       │         临时问答             前端弹窗   │
                       │              │                  │     │
                       │              ▼                  ▼     │
                       │         回答注入            回答注入    │
                       │         extraContext        extraContext│
                       │              │                  │     │
                       │              └──────┬───────────┘     │
                       │                     ▼                 │
                       │           Agent 再次执行（带补充信息）   │
                       │                     │                 │
                       │        输出含 [PLAN_DONE] 或无请求？    │
                       │              │              │         │
                       │           是 ↓           否 ↓         │
                       │         结束循环     继续下一轮         │
                       │                                       │
                       └───── 达到轮次上限 → 强制执行 ───────────┘
```

循环的关键机制：

- **增量上下文注入**：每轮收集到的信息以 `[Agent名 回答] 问题\n回答内容` 的格式追加到 `extraContext`，在下一轮 Agent 执行时注入 prompt。Agent 看到的是结构化的问答记录，而非原始的前序输出。
- **轮次上限保护**：通过 `maxPlanRounds`（默认 3，YAML 可配 1~10）防止 Agent 无限请求信息。达到上限后系统追加提示「信息收集完成，请基于现有信息执行任务」，强制进入执行阶段。
- **按需启用**：只有 YAML 中标记了 `enablePlanLoop: true` 的步骤才走信息收集循环，其余步骤的执行路径完全不变。

---

## 六、Agent 间的临时问答：queryAgent

当 Supervisor 将信息请求路由到某个 Agent 时，系统通过 `queryAgent` 方法临时调用目标 Agent 做单次问答。这不是一个完整的工作流步骤执行，而是一次轻量级的定向咨询：

- 使用目标 Agent 自身配置的 `systemPrompt` 和 `model`，确保回答的专业性。
- prompt 只包含问题本身，附加指令「请直接回答这个问题，不需要执行其他任务」，避免目标 Agent 越界执行不相关的操作。
- 回答完成后，目标 Agent 的输出被注入到发起请求的 Agent 的上下文中，形成跨 Agent 的信息传递闭环。

这意味着在一个状态的执行过程中，`oh-cangjie-analyst`（分析员）可以直接向 `oh-cangjie-coder`（编码实现）咨询某个 FFI 模块的实现细节，而无需等到编码阶段才获取这些信息。**信息流不再受限于工作流的线性执行顺序**。

---

## 七、全链路可观测：从决策到可视化

Supervisor 的每一次路由决策都被完整记录，并通过三条通道推送到前端：

### 数据结构

系统维护两个流转记录数组：

| 记录类型 | 字段 | 用途 |
|---------|------|------|
| `supervisorFlow` | `type`（question/decision）, `from`, `to`, `method`（keyword/llm）, `question`, `round`, `timestamp`, `stateName` | Supervisor 决策链路追溯 |
| `agentFlow` | `type`（request/response/supervisor/stream）, `fromAgent`, `toAgent`, `message`, `stateName`, `stepName`, `round` | Agent 间消息传递拓扑 |

### 实时推送

通过 SSE（Server-Sent Events）向前端推送三类事件：

| 事件 | 触发时机 | 前端响应 |
|------|---------|---------|
| `plan-question` | Agent 标记 `[NEED_INFO:human]` 或路由 fallback 到用户 | 弹出提问弹窗，等待用户输入 |
| `route-decision` | Supervisor 完成一次路由决策 | 在 Supervisor 视图中追加决策记录 |
| `plan-round` | 一轮信息收集完成 | 更新轮次进度指示 |

### 可视化组件

工作台提供专属的 Supervisor 视图（`SupervisorFlowVisualizer`），以时间线形式展示每一次路由决策：

- **时间轴**：紫色竖线串联所有事件，按时间排序。
- **路由卡片**：每张卡片展示 `from → to` 的路由路径、所在状态、轮次编号。
- **方法徽章**：用绿色「关键词」和蓝色「LLM」徽章标识路由使用的决策层级。
- **问题详情**：展开可查看完整的信息请求内容。

`AgentFlowDiagram` 组件则从另一个维度展示 Agent 间的消息传递拓扑：Agent → Supervisor（蓝色请求线）→ 目标 Agent（橙色路由线）→ 回答（响应线），形成完整的协作关系图。

### 持久化

所有 `supervisorFlow` 和 `agentFlow` 记录随工作流状态一同持久化到 `runs/{runId}/state.yaml`，支持事后分析和回放。

---

## 八、配置方式：渐进式启用

Supervisor 路由的启用完全通过 YAML 配置控制，对现有工作流零侵入：

### 步骤 1：为 Agent 配置路由元数据

在 `configs/agents/*.yaml` 中添加 `keywords` 和 `description` 字段。这些字段只供 Supervisor 路由器使用，不会注入到 Agent 自身的 prompt 中：

```yaml
name: oh-cangjie-analyst
keywords:
  - 分析
  - Gap
  - Gap分析
```

### 步骤 2：在需要的步骤上启用 Plan 循环

```yaml
steps:
  - name: Gap分析
    agent: oh-cangjie-analyst
    task: ...
    enablePlanLoop: true    # 启用信息收集循环
    maxPlanRounds: 2        # 最多 2 轮信息收集
```

### 步骤 3（可选）：配置路由模型

```yaml
context:
  routerModel: claude-sonnet-4-6  # Supervisor 路由使用的模型
```

不配置时默认使用 `claude-sonnet-4-6`。可根据成本和准确率需求选择更轻或更重的模型。

---

## 九、实际效果：OpenHarmony 仓颉鸿蒙 SDK API 开发工作流

在 `oh-cangjiedev-sm` 工作流中，7 个状态中有 5 个步骤启用了 `enablePlanLoop`。以 `分析Gap` 状态的执行为例：

```
oh-cangjie-analyst 开始执行「Gap分析」
      │
      ├── Agent 评估信息缺口，输出：
      │   [NEED_INFO:human] 以下信息需要确认：
      │   1. 优先级的定义规则是什么？
      │   2. API 接口是否只包含同步方法，还是同时包含异步方法？
      │
      ├── Supervisor 识别 :human 标记 → 前端弹窗
      │   用户回答：「按使用频率排列，只做同步方法」
      │
      ├── 回答注入上下文，Agent 继续执行（第 2 轮）
      │
      └── Agent 输出 [PLAN_DONE] + 完整的 Gap 分析报告
```

在架构设计和编译验证阶段，Agent 则更多地通过 `[NEED_INFO]`（不带 `:human`）向其他 Agent 咨询技术细节：

```
oh-cangjie-architect 开始执行「架构设计」
      │
      ├── Agent 输出：
      │   [NEED_INFO] 仓颉 SDK 中 ohos.file.fs 对应的 CJ wrapper 目录结构是什么？
      │
      ├── Supervisor 路由：
      │   关键词匹配 → 未命中
      │   LLM 语义路由 → 选择 oh-cangjie-coder
      │
      ├── 临时调用 oh-cangjie-coder 回答
      │   回答注入上下文
      │
      └── Agent 继续执行，产出架构文档
```

---

## 十、设计亮点总结

| 亮点 | 说明 |
|------|------|
| **Agent 无感知** | Agent 不知道系统中有哪些其他 Agent，只需用简单标记声明信息需求。这保持了 Agent prompt 的纯净性和专注度。 |
| **分层路由、成本可控** | 关键词匹配覆盖大部分场景（零成本），LLM 仅在边界情况下启用。单次 LLM 路由成本约 $0.001，远低于因信息不足导致的重新执行。 |
| **渐进式启用** | 通过 `enablePlanLoop` 按步骤粒度开启，未启用的步骤执行路径完全不变，对存量工作流零侵入。 |
| **信息流打破线性约束** | Agent 可以在执行过程中按需咨询任意其他 Agent，信息获取不再受限于工作流的步骤顺序。 |
| **人机协作无缝切换** | `:human` 标记的信息请求自动转为前端弹窗，技术问题自动路由到 Agent，两条路径共享同一套信息注入机制。 |
| **全链路可追溯** | 每次路由决策都记录方法（关键词/LLM）、路由来源和目标、问题内容和时间戳，支持事后分析「为什么选了这条路」。 |
| **优雅降级** | 关键词不命中 → LLM 兜底 → LLM 也不命中 → fallback 到用户。流程永远不会因路由失败而卡死。 |
| **执行与收集分离** | Plan 循环将 Agent 执行显式拆分为「信息收集」和「正式执行」两个阶段，Agent 在信息充分后才开始产出，显著减少因信息不足导致的返工。 |
