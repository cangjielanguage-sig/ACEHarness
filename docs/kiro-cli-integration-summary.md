# Kiro CLI 引擎集成总结

## 概述

已成功将 Kiro CLI 引擎集成到 AceFlow 工作流系统中。用户现在可以在 Claude Code 和 Kiro CLI 之间自由切换。

## 完成的功能

### 1. 核心引擎实现

**文件**: `src/lib/engines/kiro-cli.ts`
- 实现了完整的 ACP (Agent Client Protocol) 通信
- 支持 JSON-RPC 2.0 over stdio
- 实现了会话管理（初始化、创建会话、发送提示、取消）
- 支持流式输出和事件处理
- 处理各种会话更新类型（agent_message_chunk, tool_call, plan 等）

### 2. 引擎抽象层

**文件**: `src/lib/engines/engine-interface.ts`
- 定义了统一的 Engine 接口
- 支持执行、取消、可用性检查
- 支持流式事件监听

**文件**: `src/lib/engines/kiro-cli-wrapper.ts`
- 将 KiroCliEngine 包装为标准 Engine 接口
- 转换事件格式以兼容现有系统
- 管理引擎生命周期

**文件**: `src/lib/engines/engine-factory.ts`
- 工厂模式创建引擎实例
- 读取配置文件 `.engine.json`
- 检查引擎可用性
- 自动回退到 Claude Code

### 3. 工作流集成

**文件**: `src/lib/workflow-manager.ts`
- 在启动时初始化配置的引擎
- `initializeEngine()` 方法读取配置并创建引擎
- `executeWithEngine()` 方法根据配置使用相应引擎
- 支持引擎切换和回退
- 在停止时正确清理引擎资源

### 4. UI 管理界面

**文件**: `src/app/engines/page.tsx`
- 引擎选择和管理页面
- 实时检查引擎可用性
- 显示引擎状态（可用/不可用/使用中）
- 支持一键切换引擎
- 提供安装说明和故障排除信息
- 使用 Toast 提示用户操作结果

### 5. API 端点

**文件**: `src/app/api/engine/route.ts`
- GET: 获取当前配置的引擎
- POST: 设置新的引擎配置

**文件**: `src/app/api/engine/availability/route.ts`
- GET: 检查指定引擎的可用性

### 6. 配置管理

**文件**: `.engine.json` (项目根目录)
```json
{
  "engine": "kiro-cli",
  "updatedAt": "2026-03-05T12:00:00.000Z"
}
```

## 使用方法

### 安装 Kiro CLI

```bash
curl -fsSL https://cli.kiro.dev/install | bash
```

### 通过 UI 切换引擎

1. 访问 `/engines` 页面
2. 点击"刷新可用性"检查引擎状态
3. 选择 Kiro CLI 引擎
4. 点击"切换到此引擎"按钮

### 手动配置

创建 `.engine.json` 文件：

```json
{
  "engine": "kiro-cli",
  "updatedAt": "2026-03-05T12:00:00.000Z"
}
```

### 自定义 Agent 配置

在工作流配置中指定 agent 名称，Kiro CLI 会自动加载对应的 agent 配置。

## 技术特性

### 1. 协议支持
- ACP (Agent Client Protocol)
- JSON-RPC 2.0
- 流式输出
- 会话管理

### 2. 事件处理
- agent_message_chunk: 文本输出
- agent_thought: 思考过程
- tool_call: 工具调用
- plan: 计划制定
- error: 错误处理

### 3. 兼容性
- 与现有 Claude Code 工作流完全兼容
- 无缝切换，无需修改工作流配置
- 自动回退机制

### 4. 可靠性
- 进程管理和清理
- 错误处理和恢复
- 超时控制
- 取消支持

## 架构设计

```
┌─────────────────────────────────────────┐
│         Workflow Manager                │
│  ┌───────────────────────────────────┐  │
│  │   initializeEngine()              │  │
│  │   executeWithEngine()             │  │
│  └───────────────┬───────────────────┘  │
└──────────────────┼──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         Engine Factory                  │
│  ┌───────────────────────────────────┐  │
│  │   getConfiguredEngine()           │  │
│  │   createEngine()                  │  │
│  │   isEngineAvailable()             │  │
│  └───────────────┬───────────────────┘  │
└──────────────────┼──────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│ Claude Code  │    │ Kiro CLI Engine  │
│   (Default)  │    │   (Wrapper)      │
└──────────────┘    └────────┬─────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ KiroCliEngine   │
                    │  (ACP Protocol) │
                    └─────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  kiro-cli acp   │
                    │   (Process)     │
                    └─────────────────┘
```

## 测试

### 单元测试
```bash
npx ts-node src/lib/engines/kiro-cli.test.ts
```

### 集成测试
1. 安装 Kiro CLI
2. 创建测试工作流
3. 切换到 Kiro CLI 引擎
4. 运行工作流
5. 验证输出和日志

## 故障排除

### 问题 1: Kiro CLI 不可用
**症状**: 引擎页面显示"不可用"
**解决方案**:
```bash
# 检查是否安装
which kiro-cli

# 安装
npm install -g kiro-cli

# 刷新可用性
访问 /engines 页面，点击"刷新可用性"
```

### 问题 2: 切换引擎失败
**症状**: 点击切换按钮后没有反应
**解决方案**:
1. 检查浏览器控制台错误
2. 检查 `.engine.json` 文件权限
3. 重启开发服务器

### 问题 3: 工作流执行失败
**症状**: 使用 Kiro CLI 时工作流报错
**解决方案**:
1. 检查 Kiro CLI 进程是否正常启动
2. 查看工作流日志中的详细错误信息
3. 验证 agent 配置是否正确
4. 尝试切换回 Claude Code 验证工作流本身是否正常

## 未来改进

1. **Agent 配置管理 UI**: 在 UI 中管理 Kiro CLI agent 配置
2. **性能监控**: 添加引擎性能指标和监控
3. **多引擎并行**: 支持同时使用多个引擎
4. **引擎插件系统**: 更容易添加新引擎
5. **配置验证**: 在切换前验证引擎配置

## 相关文档

- [引擎系统 README](../src/lib/engines/README.md)
- [Kiro CLI 集成需求](./kiro-cli-integration.md)
- [ACP 协议文档](https://agentclientprotocol.com/)

## 更新日志

### 2026-03-05
- ✅ 完成 Kiro CLI 核心引擎实现
- ✅ 完成引擎抽象层和工厂模式
- ✅ 完成工作流管理器集成
- ✅ 完成 UI 管理界面
- ✅ 完成 API 端点
- ✅ 完成文档和测试
- ✅ 改进错误提示（使用 Toast）
