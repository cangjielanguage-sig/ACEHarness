---
name: aceflow-workflow-creator
description: "AceFlow 工作流配置文件创建技能。"
---

# AceFlow Workflow Creator

AceFlow 工作流配置文件创建技能。**每当用户提到以下任何场景时，必须调用此 skill：**
- 「创建一个工作流」「配置一个 workflow」「新建工作流」
- 「帮我写个工作流配置」「生成工作流 yaml」
- 「设置 agent 执行流程」「配置 agent 步骤」
- 「创建 state-machine 工作流」「创建 phase-based 工作流」
- 工作流模式选择（状态机 vs 阶段式）
- 修改已有工作流配置时的格式检查

**生成工作流配置前必须用验证脚本校验格式，确保 YAML 语法正确、agent 引用存在于 `configs/agents/` 目录、状态机/阶段模式结构完整。不要在没有调用此 skill 的情况下直接生成工作流配置文件。**

## 工作流模式

### state-machine（状态机模式）
- 有且仅有一个 `isInitial: true` 的初始状态
- 至少有一个 `isFinal: true` 的最终状态
- 所有 `transition.to` 必须指向已定义的状态名

### phase-based（阶段模式）
- 至少一个 phase，每个 phase 至少一个 step
- step 中的 agent 引用必须在 `configs/agents/` 中存在

## 验证脚本

```bash
node skills/.claude/skills/aceflow-workflow-creator/scripts/validate-workflow.mjs <config.yaml>
```

验证内容：YAML 语法、agent 引用存在性、状态机/阶段模式结构完整性。

## 核心流程

1. **收集需求** — 了解要解决的问题、涉及模块、验收标准
2. **查询资源** — `agent.list` 查看可用 Agent，`config.list` 参考已有工作流
3. **确认关键信息** — 工作目录、需求描述、代码目录（用户确认后再设计）
4. **设计方案** — 用 card 展示方案预览，确认后再写入
5. **写入 + 验证** — 必须运行验证脚本：`node skills/.claude/skills/aceflow-workflow-creator/scripts/validate-workflow.mjs configs/{filename}.yaml`

**绝对不要在展示方案的同一条回复中创建文件，必须等用户确认。**

## Agent 团队

- **defender（蓝队）** — 建设者：设计、实现、测试、文档
- **attacker（红队）** — 挑战者：攻击方案、寻找缺陷、压力测试
- **judge（裁判）** — 仲裁者：评审和判定
