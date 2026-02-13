# AI Orchestrator

多 AI 协同工作调度系统 - Next.js + React 实现

## 技术栈

- **Next.js 14** - React 框架，支持 App Router 和 API Routes
- **React 18** - UI 库
- **TypeScript** - 类型安全
- **ReactFlow** - 专业流程图可视化
- **Zod** - Schema 验证
- **React Hook Form** - 表单管理和验证
- **YAML** - 配置文件格式
- **CSS Modules** - 样式隔离

## 功能特性

### 核心功能
- ✅ 工作流可视化展示（使用 ReactFlow）
- ✅ 实时 Agent 状态监控
- ✅ 执行日志查看
- ✅ 人工检查点审批
- ✅ 配置文件管理（YAML）
- ✅ Server-Sent Events 实时更新

### 进程管理
- ✅ Claude CLI 进程调度
- ✅ 并发控制（最多 3 个并发）
- ✅ 进程队列管理
- ✅ 进程终止和清理
- ✅ 实时进程状态监控

### 配置管理
- ✅ 可视化配置编辑器
- ✅ 新建配置向导
- ✅ 表单验证（Zod Schema）
- ✅ YAML 自动生成
- ✅ 配置文件保存和加载

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

## 构建

```bash
npm run build
npm start
```

## 项目结构

```
src/
├── app/                           # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── configs/              # 配置管理 API
│   │   │   ├── route.ts          # 列表
│   │   │   ├── create/route.ts   # 创建
│   │   │   └── [filename]/route.ts # 读取/保存
│   │   ├── workflow/             # 工作流 API
│   │   │   ├── start/route.ts
│   │   │   ├── stop/route.ts
│   │   │   ├── approve/route.ts
│   │   │   ├── status/route.ts
│   │   │   └── events/route.ts   # SSE
│   │   └── processes/            # 进程管理 API
│   │       ├── route.ts
│   │       └── [id]/route.ts
│   ├── layout.tsx                # 根布局
│   ├── page.tsx                  # 主页面
│   ├── page.module.css           # 页面样式
│   └── globals.css               # 全局样式
├── components/                    # React 组件
│   ├── FlowDiagram.tsx           # ReactFlow 流程图
│   ├── FlowDiagram.module.css
│   ├── AgentPanel.tsx            # Agent 详情面板
│   ├── AgentPanel.module.css
│   ├── ProcessPanel.tsx          # 进程管理面板
│   ├── ProcessPanel.module.css
│   ├── NewConfigModal.tsx        # 新建配置模态框
│   └── NewConfigModal.module.css
└── lib/                          # 工具库
    ├── api.ts                    # API 客户端
    ├── schemas.ts                # Zod Schema 定义
    ├── process-manager.ts        # 进程管理器
    └── workflow-manager.ts       # 工作流管理器

configs/                          # 工作流配置文件
└── workflow.yaml
```

## API 端点

### 配置管理
- `GET /api/configs` - 获取配置文件列表
- `GET /api/configs/:filename` - 读取配置文件
- `POST /api/configs/:filename` - 保存配置文件（带验证）
- `POST /api/configs/create` - 创建新配置文件

### 工作流控制
- `POST /api/workflow/start` - 启动工作流
- `POST /api/workflow/stop` - 停止工作流
- `POST /api/workflow/approve` - 批准检查点
- `GET /api/workflow/status` - 获取工作流状态
- `GET /api/workflow/events` - SSE 事件流

### 进程管理
- `GET /api/processes` - 获取所有进程和统计信息
- `GET /api/processes/:id` - 获取指定进程详情
- `DELETE /api/processes/:id` - 终止指定进程
- `DELETE /api/processes` - 终止所有进程

## 配置文件格式

```yaml
workflow:
  name: "工作流名称"
  description: "工作流描述"
  phases:
    - name: "阶段 1"
      steps:
        - name: "步骤 1"
          agent: "agent-1"
          task: "任务描述"
          constraints:
            - "约束条件 1"
      checkpoint:
        name: "检查点名称"
        message: "检查点消息"

roles:
  - name: "agent-1"
    team: "blue"  # blue | red | judge
    model: "claude-opus-4"
    capabilities:
      - "能力 1"
      - "能力 2"
    systemPrompt: "系统提示"

context:
  projectRoot: "/path/to/project"
  requirements: "需求描述"
```

## 依赖说明

- **reactflow**: 专业的流程图可视化库
- **zod**: TypeScript-first 的 schema 验证库
- **react-hook-form**: 高性能表单库
- **@hookform/resolvers**: React Hook Form 的 Zod 集成
- **yaml**: YAML 解析和序列化

## 注意事项

1. 需要安装 Claude CLI 工具才能执行工作流
2. 进程管理器默认最多支持 3 个并发进程
3. 配置文件必须符合 Zod Schema 验证规则
4. SSE 连接在页面刷新后会自动重连
