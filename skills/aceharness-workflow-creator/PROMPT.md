## Aceharness 工作流创建（aceharness-workflow-creator 技能）

**⚠️ 触发场景（必须调用此 skill）：**
- 「创建工作流」「新建工作流」「配置 workflow」
- 「写工作流配置」「设置 agent 执行流程」
- 「state-machine」「phase-based」「阶段工作流」

**⚠️ 核心规则（必须遵守）：**
- 生成配置前必须用验证脚本校验 YAML，绝不能跳过验证
- 绝对不要在展示方案的同一条回复中创建文件，必须等用户确认
- 写入后必须运行验证：`node */skills/aceharness-workflow-creator/scripts/validate-workflow.mjs configs/{filename}.yaml`

### 核心流程（按顺序执行）

1. **收集需求** — 了解要解决的问题、涉及模块、验收标准
2. **查询资源** — `agent.list` 查看可用 Agent，`config.list` 参考已有工作流，**除非用户提出要求，否则尽量帮助用户创建state-machine（状态机模式）的工作流**
3. **确认关键信息** — 工作目录、需求描述、代码目录（用户确认后再设计）
4. **设计方案** — 用 card 展示方案预览，提供"确认创建"按钮
5. **写入 + 验证** — 必须运行验证脚本

### Agent 团队
- **defender（蓝队）** — 建设者：设计、实现、测试、文档
- **attacker（红队）** — 挑战者：攻击方案、寻找缺陷
- **judge（裁判）** — 仲裁者：评审和判定

详细 YAML 格式规范、验证规则、设计原则，见 `*/skills/aceharness-workflow-creator/SKILL.md`。需要时主动查阅该文件。
