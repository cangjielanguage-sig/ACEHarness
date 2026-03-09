# Kiro CLI 集成需求文档

## 文档状态
- 创建时间：2026-03-05
- 更新时间：2026-03-05
- 状态：信息收集完成，准备实现
- 目标：为 AceFlow 添加 Kiro CLI 引擎支持

---

## 概述

Kiro CLI 使用 **ACP (Agent Client Protocol)** 协议，通过 **JSON-RPC 2.0** over **stdio** 进行通信。

### 关键特性
- 基于 JSON-RPC 2.0 标准
- 通过 stdin/stdout 通信
- 支持会话管理、流式输出、工具调用
- 支持自定义 Agent 配置
- 完整的 ACP 协议实现

---

## 1. 基本命令结构

### 主命令
- **命令名称**：`kiro-cli`
- **ACP 模式**：`kiro-cli acp`
- **指定 Agent**：`kiro-cli acp --agent my-agent`

### 通信协议
- **协议**：ACP (Agent Client Protocol)
- **传输方式**：JSON-RPC 2.0 over stdio
- **输入**：stdin
- **输出**：stdout
- **协议文档**：https://agentclientprotocol.com/

---

## 2. JSON-RPC 方法

### 2.1 initialize - 初始化连接

建立连接并协商协议能力。

#### 请求
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "aceflow",
      "version": "1.0.0"
    },
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": true
    }
  }
}
```

#### 响应
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "kiro-cli",
      "version": "1.0.0"
    },
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "image": true,
        "audio": false,
        "embeddedContext": true
      },
      "mcpCapabilities": {
        "http": false,
        "sse": false
      }
    },
    "authMethods": []
  }
}
```

### 2.2 session/new - 创建新会话

#### 请求
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

#### 响应
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "sess_abc123def456",
    "configOptions": [
      {
        "id": "mode",
        "name": "Session Mode",
        "category": "mode",
        "type": "select",
        "currentValue": "ask",
        "options": [
          {
            "value": "ask",
            "name": "Ask",
            "description": "Request permission before making any changes"
          },
          {
            "value": "code",
            "name": "Code",
            "description": "Write and modify code with full tool access"
          }
        ]
      },
      {
        "id": "model",
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": "claude-sonnet-4",
        "options": [...]
      }
    ],
    "modes": {
      "availableModes": [...],
      "currentModeId": "ask"
    }
  }
}
```

### 2.3 session/prompt - 发送 Prompt

#### 请求
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [
      {
        "type": "text",
        "text": "帮我写一个函数"
      }
    ]
  }
}
```

#### 响应
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn"
  }
}
```

### 2.4 session/update - 会话更新通知

Agent 通过此通知发送流式更新（无需响应）：

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "我来帮你写一个函数..."
      }
    }
  }
}
```

#### 更新类型
- `user_message_chunk` - 用户消息块
- `agent_message_chunk` - Agent 响应块
- `agent_thought_chunk` - Agent 思考过程
- `tool_call` - 工具调用
- `tool_call_update` - 工具调用更新
- `plan` - 执行计划
- `current_mode_update` - 模式更新
- `config_option_update` - 配置更新

### 2.5 session/cancel - 取消操作

通知（无响应）：

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "sess_abc123def456"
  }
}
```

### 2.6 session/set_mode - 设置模式

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/set_mode",
  "params": {
    "sessionId": "sess_abc123def456",
    "modeId": "code"
  }
}
```

### 2.7 session/set_config_option - 设置配置

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "sess_abc123def456",
    "configId": "model",
    "value": "claude-opus-4"
  }
}
```

---

## 3. Agent 配置系统

### 配置文件位置
- 默认位置：`.kiro/agents/`（待确认）
- 格式：JSON

### 配置文件结构
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

### 字段说明
- **name**: Agent 名称
- **description**: 描述
- **tools**: 可用工具列表
- **allowedTools**: 允许的工具子集
- **resources**: 资源列表（支持 file://, skill:// 和 glob 模式）
- **prompt**: System prompt
- **model**: 使用的模型

---

## 4. 工具调用系统

### 工具类型 (ToolKind)
- `read` - 读取文件
- `edit` - 编辑文件
- `delete` - 删除文件
- `move` - 移动/重命名
- `search` - 搜索
- `execute` - 执行命令
- `think` - 内部推理
- `fetch` - 获取外部数据
- `switch_mode` - 切换模式
- `other` - 其他

### 工具调用状态
- `pending` - 等待中
- `in_progress` - 执行中
- `completed` - 已完成
- `failed` - 失败

### 工具调用内容类型
- `content` - 标准内容块（文本、图片等）
- `diff` - 文件差异
- `terminal` - 终端输出

---

## 5. 停止原因 (StopReason)

- `end_turn` - 正常结束
- `max_tokens` - 达到最大 token 数
- `max_turn_requests` - 达到最大请求数
- `refusal` - Agent 拒绝继续
- `cancelled` - 被取消

---

## 6. 客户端能力

### 文件系统
- `fs/read_text_file` - 读取文本文件
- `fs/write_text_file` - 写入文本文件

### 终端
- `terminal/create` - 创建终端
- `terminal/output` - 获取输出
- `terminal/wait_for_exit` - 等待退出
- `terminal/kill` - 终止命令
- `terminal/release` - 释放终端

### 权限请求
- `session/request_permission` - 请求用户权限

---

## 7. 实现计划

### 7.1 核心功能
- [x] 文档收集完成
- [ ] 实现 JSON-RPC 通信层
- [ ] 实现 initialize 握手
- [ ] 实现 session/new 创建会话
- [ ] 实现 session/prompt 发送指令
- [ ] 实现 session/update 流式输出处理
- [ ] 实现 session/cancel 取消功能

### 7.2 Agent 配置
- [ ] 支持加载 Agent 配置文件
- [ ] 支持通过 --agent 参数指定配置
- [ ] 支持默认 Agent (kiro_default)

### 7.3 工具调用
- [ ] 处理工具调用通知
- [ ] 显示工具执行状态
- [ ] 支持文件差异显示
- [ ] 支持终端输出显示

### 7.4 集成到 AceFlow
- [ ] 在 workflow-manager.ts 中添加 Kiro CLI 适配器
- [ ] 创建 src/lib/engines/kiro-cli.ts
- [ ] 支持引擎切换
- [ ] 日志记录和错误处理

---

## 8. 技术实现要点

### 8.1 进程管理
```typescript
import { spawn } from 'child_process';

const kiroProcess = spawn('kiro-cli', ['acp', '--agent', agentName], {
  cwd: workingDirectory,
  stdio: ['pipe', 'pipe', 'pipe']
});
```

### 8.2 JSON-RPC 通信
```typescript
// 发送请求
function sendRequest(method: string, params: any) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };
  kiroProcess.stdin.write(JSON.stringify(request) + '\n');
}

// 接收响应
kiroProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (line.trim()) {
      const message = JSON.parse(line);
      handleMessage(message);
    }
  }
});
```

### 8.3 流式输出处理
```typescript
function handleSessionUpdate(update: SessionUpdate) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      // 累积文本块
      outputBuffer += update.content.text;
      break;
    case 'tool_call':
      // 显示工具调用
      displayToolCall(update);
      break;
    // ...
  }
}
```

---

## 9. 与 Claude Code 的对比

| 功能 | Claude Code | Kiro CLI |
|------|-------------|----------|
| 启动命令 | `claude` | `kiro-cli acp` |
| 通信协议 | 专有协议 | ACP (JSON-RPC 2.0) |
| 会话管理 | 自动管理 | 显式 session/new |
| 流式输出 | 支持 | 支持 (session/update) |
| 工具调用 | 支持 | 支持 (详细状态) |
| 文件操作 | 支持 | 支持 (通过工具) |
| Agent 配置 | 内置 | JSON 配置文件 |
| 模式切换 | 不支持 | 支持 (session/set_mode) |

---

## 10. 参考资料

- **ACP 协议文档**：https://agentclientprotocol.com/
- **完整 Schema**：https://agentclientprotocol.com/llms.txt
- **JSON-RPC 2.0 规范**：https://www.jsonrpc.org/specification

---

## 11. 下一步

现在信息已经收集完整，可以开始实现了。建议的实现顺序：

1. 创建 `src/lib/engines/kiro-cli.ts` - Kiro CLI 适配器
2. 实现基本的 JSON-RPC 通信层
3. 实现 initialize 和 session/new
4. 实现 session/prompt 和流式输出处理
5. 集成到 workflow-manager.ts
6. 测试和调试

准备好开始实现了吗？

### 主命令
- **命令名称**：`kiro-cli`
- **版本要求**：`待填写`
- **安装方式**：`待填写`

### 通信协议
- **协议**：ACP (Agent Communication Protocol)
- **传输方式**：JSON-RPC over stdio
- **启动命令**：`kiro-cli acp`
- **协议规范**：参考 ACP specification

### 使用方式
```bash
# 基本启动
cd my-project
kiro-cli acp  # 启动 ACP 服务，通过 stdio 进行 JSON-RPC 通信

# 使用特定 agent 配置
kiro-cli acp --agent my-agent
```

### 通信细节
- **JSON-RPC 版本**：2.0
- **输入**：stdin
- **输出**：stdout
- **编辑器集成**：任何支持 ACP 的编辑器都可以通过 spawn 此命令来集成 Kiro

---

## 2. ACP 协议方法

### 核心协议方法

#### initialize
- **描述**：初始化连接并交换能力信息
- **用途**：建立连接，获取 agent 支持的功能

#### session/new
- **描述**：创建新的聊天会话
- **用途**：开始新的对话

#### session/load
- **描述**：通过 ID 加载现有会话
- **用途**：继续之前的对话

#### session/prompt
- **描述**：向 agent 发送 prompt
- **用途**：发送用户指令

#### session/cancel
- **描述**：取消当前操作
- **用途**：中断正在执行的任务

#### session/set_mode
- **描述**：切换 agent 模式
- **用途**：切换不同的 agent 配置

#### session/set_model
- **描述**：更改会话使用的模型
- **用途**：动态切换模型

---

## 3. Agent 能力

### 初始化时广告的能力
- **loadSession**: `true` - 支持加载现有会话
- **promptCapabilities.image**: `true` - 支持 prompt 中的图片内容

---

## 4. 会话更新通知

### session/notification
Agent 通过此通知类型发送会话更新，包括：
- `待填写`（具体的更新类型）

---

## 2. 会话管理 (原有章节)

### 创建新会话
```bash
# 待填写：创建新会话的命令
```

### 继续现有会话
```bash
# 待填写：如何继续一个已存在的会话
```

### 会话标识符
- **格式**：`待填写`
- **存储位置**：`待填写`

### 列出会话
```bash
# 待填写：如何列出所有会话
```

---

## 7. JSON-RPC 消息格式

### session/new - 创建新会话

#### 请求
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {}  // 待确认：是否需要参数？
}
```

#### 响应
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "sess_abc123def456",
    "configOptions": [
      {
        "id": "mode",
        "name": "Session Mode",
        "description": "Controls how the agent requests permission",
        "category": "mode",
        "type": "select",
        "currentValue": "ask",
        "options": [
          {
            "value": "ask",
            "name": "Ask",
            "description": "Request permission before making any changes"
          },
          {
            "value": "code",
            "name": "Code",
            "description": "Write and modify code with full tool access"
          }
        ]
      },
      {
        "id": "model",
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": "model-1",
        "options": [
          {
            "value": "model-1",
            "name": "Model 1",
            "description": "The fastest model"
          },
          {
            "value": "model-2",
            "name": "Model 2",
            "description": "The most powerful model"
          }
        ]
      }
    ]
  }
}
```

#### 响应字段说明
- **sessionId**: 会话唯一标识符，格式如 `sess_abc123def456`
- **configOptions**: 可配置选项数组
  - **id**: 选项 ID（如 "mode", "model"）
  - **name**: 显示名称
  - **description**: 选项描述
  - **category**: 分类（"mode", "model" 等）
  - **type**: 类型（"select" 等）
  - **currentValue**: 当前值
  - **options**: 可选值列表
    - **value**: 选项值
    - **name**: 选项名称
    - **description**: 选项描述

### 会话模式
- **ask**: 在做任何更改前请求权限
- **code**: 使用完整工具访问权限编写和修改代码

---

## 8. 其他 JSON-RPC 方法 (待补充)

### 输入方式
- **命令行参数**：`待填写`
- **标准输入 (stdin)**：`待填写`
- **文件输入**：`待填写`
- **多行输入**：`待填写`

### 输出格式
- **默认格式**：`待填写`（纯文本/JSON/其他）
- **是否支持流式输出**：`待填写`
- **输出到**：`待填写`（stdout/stderr/文件）

### 实时输出读取
```bash
# 待填写：如何读取实时输出
```

---

## 4. 配置选项

### API Endpoint
```bash
# 待填写：如何设置 API endpoint
```

### API Key
```bash
# 待填写：如何配置 API key
```

### 环境变量
- `待填写`：用途说明
- `待填写`：用途说明

### 配置文件
- **位置**：`待填写`
- **格式**：`待填写`（JSON/YAML/TOML/其他）
- **示例**：
```
待填写
```

---

## 5. Agent 配置

### 创建 Agent
```bash
# 从模板创建 agent
/agent create my-agent --from backend-specialist
```

### Agent 配置文件格式
Agent 使用 JSON 配置文件定义，示例：

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

### 配置字段说明
- **name**: Agent 名称
- **description**: Agent 描述
- **tools**: 可用工具列表（如 read, write）
- **allowedTools**: 允许使用的工具子集
- **resources**: 资源列表，支持：
  - `file://` - 文件资源
  - `skill://` - Skill 资源
  - 支持 glob 模式（`**/*.md`）
- **prompt**: System prompt
- **model**: 使用的模型（如 `claude-sonnet-4`）

### 使用 Agent

#### 方式 1：启动时指定
```bash
kiro-cli --agent my-agent
```

#### 方式 2：ACP 模式指定
```bash
kiro-cli acp --agent my-agent
```

#### 方式 3：会话中切换
```bash
# 在交互式会话中
> /agent swap

# 选择 agent
❯ rust-developer-agent
  kiro_default
  backend-specialist
  my-agent

# 切换后提示符会显示当前 agent
[backend-specialist] >
```

### 默认 Agent
- **名称**: `kiro_default`
- **用途**: 未指定 agent 时使用的默认配置

---

## 6. 模型和参数 (原有章节更新)

### 支持的模型
- `待填写`
- `待填写`

### 模型参数
- **temperature**：`待填写`（如何设置）
- **max_tokens**：`待填写`（如何设置）
- **top_p**：`待填写`（如何设置）
- **其他参数**：`待填写`

### System Prompt
```bash
# 待填写：如何传递 system prompt
```

---

## 6. 工作目录和文件操作

### 工作目录
- **默认工作目录**：`待填写`
- **如何指定工作目录**：`待填写`

### 文件访问
- **文件读取**：`待填写`
- **文件写入**：`待填写`
- **权限要求**：`待填写`

---

## 7. 错误处理

### 错误输出
- **输出位置**：`待填写`（stderr/stdout）
- **错误格式**：`待填写`

### 退出码
- `0`：`待填写`
- `1`：`待填写`
- `其他`：`待填写`

### 中断处理
```bash
# 待填写：如何优雅地中断执行
```

---

## 8. 命令示例

### 基本使用
```bash
# 示例 1：待填写
# 示例 2：待填写
# 示例 3：待填写
```

### 高级用法
```bash
# 示例 1：待填写
# 示例 2：待填写
```

---

## 9. 与 Claude Code 的对比

| 功能 | Claude Code | Kiro CLI |
|------|-------------|----------|
| 启动命令 | `claude` | `待填写` |
| 会话管理 | 自动管理 | `待填写` |
| 流式输出 | 支持 | `待填写` |
| 工具调用 | 支持 | `待填写` |
| 文件操作 | 支持 | `待填写` |

---

## 10. 集成计划

### 需要实现的功能
- [ ] 启动 Kiro CLI 进程
- [ ] 传递 prompt 和配置
- [ ] 读取实时输出
- [ ] 处理错误和中断
- [ ] 会话管理
- [ ] 日志记录

### 技术实现位置
- **主要文件**：`src/lib/workflow-manager.ts`
- **新增文件**：`src/lib/engines/kiro-cli.ts`（可能）
- **配置文件**：`.kiro-config.json`（可能）

---

## 11. 待确认的问题

1. Kiro CLI 是否已经存在，还是需要开发？
2. 是否有官方文档或 README？
3. 是否支持 Anthropic 和 OpenAI 两种 API？
4. 输出格式是否与 Claude Code 兼容？
5. 是否需要特殊的安装或配置步骤？
6. 是否有速率限制或并发限制？
7. 是否支持工具调用（function calling）？
8. 是否支持多轮对话？

---

## 12. 参考资料

- 官方文档：`待填写`
- GitHub 仓库：`待填写`
- 示例项目：`待填写`

---

## 更新日志

- 2026-03-05：创建初始文档框架
