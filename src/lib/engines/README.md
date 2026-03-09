# AI Engines

AceFlow 支持多种 AI 引擎后端，可以根据需求选择不同的引擎。

## 支持的引擎

### 1. Claude Code (默认)
- **状态**: ✅ 可用
- **命令**: `claude`
- **特性**: Anthropic 官方 CLI，功能完整
- **协议**: 专有协议

### 2. Kiro CLI
- **状态**: ✅ 已实现
- **命令**: `kiro-cli acp`
- **特性**: 基于 ACP 协议，支持自定义 Agent 配置
- **协议**: ACP (Agent Client Protocol) - JSON-RPC 2.0

### 3. Codex
- **状态**: 🚧 计划中
- **命令**: TBD
- **特性**: OpenAI Codex 引擎

### 4. Cursor CLI
- **状态**: 🚧 计划中
- **命令**: TBD
- **特性**: Cursor 命令行工具

## 配置引擎

### 方法 1: 通过 UI 配置

访问 `/engines` 页面，选择要使用的引擎。系统会自动检查引擎可用性。

### 方法 2: 手动配置

在项目根目录创建 `.engine.json` 文件：

```json
{
  "engine": "kiro-cli",
  "updatedAt": "2026-03-05T12:00:00.000Z"
}
```

支持的引擎值：
- `claude-code` (默认)
- `kiro-cli`
- `codex` (未实现)
- `cursor` (未实现)

## 使用 Kiro CLI

### 安装

```bash
# 安装 Kiro CLI
curl -fsSL https://cli.kiro.dev/install | bash
```

安装后，访问 `/engines` 页面，点击"刷新可用性"按钮，系统会检测到 Kiro CLI 可用。

### Agent 配置

Kiro CLI 支持自定义 Agent 配置。在项目中创建 `.kiro/agents/` 目录：

```json
{
  "name": "my-agent",
  "description": "A custom agent for my workflow",
  "tools": ["read", "write"],
  "allowedTools": ["read"],
  "resources": [
    "file://README.md",
    "file://.kiro/steering/**/*.md",
    "skill://.kiro/skills/**/SKILL.md"
  ],
  "prompt": "You are a helpful coding assistant",
  "model": "claude-sonnet-4"
}
```

### 使用特定 Agent

在工作流配置中指定 agent 名称，系统会自动使用对应的 Kiro CLI agent 配置。

## 架构

### 引擎接口

所有引擎都实现统一的 `Engine` 接口：

```typescript
interface Engine {
  execute(options: EngineOptions): Promise<EngineResult>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
  off(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
}
```

### 引擎工厂

`engine-factory.ts` 负责根据配置创建相应的引擎实例：

```typescript
import { createEngine, getConfiguredEngine } from '@/lib/engines';

// 获取配置的引擎类型
const engineType = await getConfiguredEngine();

// 创建引擎实例
const engine = await createEngine(engineType);
```

### 文件结构

```
src/lib/engines/
├── index.ts                  # 导出所有模块
├── engine-interface.ts       # 引擎接口定义
├── engine-factory.ts         # 引擎工厂
├── kiro-cli.ts              # Kiro CLI 核心实现
├── kiro-cli-wrapper.ts      # Kiro CLI 包装器
└── kiro-cli.test.ts         # 测试文件
```

## 工作流集成

工作流管理器会在启动时自动初始化配置的引擎：

1. 读取 `.engine.json` 配置文件
2. 创建对应的引擎实例
3. 检查引擎可用性
4. 如果引擎不可用，自动回退到 Claude Code

执行任务时，系统会根据配置使用相应的引擎：

```typescript
// workflow-manager.ts 中的执行流程
await this.initializeEngine();
const result = await this.executeWithEngine(
  processId, agent, step, prompt, systemPrompt, model, options
);
```

## 开发新引擎

要添加新的引擎支持：

1. 实现 `Engine` 接口
2. 在 `engine-factory.ts` 中添加创建逻辑
3. 更新 `EngineType` 类型定义
4. 在 UI 中添加引擎选项

示例：

```typescript
import { Engine, EngineOptions, EngineResult } from './engine-interface';

export class MyCustomEngine implements Engine {
  getName(): string {
    return 'my-engine';
  }

  async isAvailable(): Promise<boolean> {
    // 检查引擎是否可用
    return true;
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    // 实现执行逻辑
    return {
      success: true,
      output: 'Result',
    };
  }

  cancel(): void {
    // 实现取消逻辑
  }

  on(event: 'stream', listener: any): void {
    // 实现事件监听
  }

  off(event: 'stream', listener: any): void {
    // 实现事件移除
  }
}
```

## 测试

运行 Kiro CLI 测试：

```bash
npx ts-node src/lib/engines/kiro-cli.test.ts
```

## 故障排除

### Kiro CLI 不可用

确保 `kiro-cli` 命令在 PATH 中：

```bash
which kiro-cli
```

如果未安装，运行：

```bash
npm install -g kiro-cli
```

### 连接超时

检查 Kiro CLI 是否正常启动：

```bash
kiro-cli acp
# 应该等待 JSON-RPC 输入
```

### Agent 配置未找到

确保 agent 配置文件存在于正确的位置，并且格式正确。

### 引擎切换不生效

1. 检查 `.engine.json` 文件是否正确创建
2. 重启工作流服务
3. 在 `/engines` 页面刷新可用性检查

## 参考资料

- [ACP 协议文档](https://agentclientprotocol.com/)
- [Kiro CLI 集成需求文档](../../docs/kiro-cli-integration.md)
- [Claude Code 文档](https://docs.anthropic.com/claude/docs/claude-code)
