'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, Check, Cpu, Zap } from 'lucide-react';

interface Engine {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'available' | 'coming-soon';
  features: string[];
  endpoints: string[];
}

const engines: Engine[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic 官方 CLI 工具，功能强大，支持完整的代码编辑和执行能力',
    icon: '🤖',
    status: 'available',
    features: ['完整的文件操作', '代码执行', 'Git 集成', 'MCP 工具支持'],
    endpoints: ['anthropic'],
  },
  {
    id: 'cangjie-magic',
    name: 'CangjieMagic',
    description: '仓颉语言 AI Agent 框架，通过 MCP 协议提供智能工具调用能力',
    icon: '/images/cj_magic_logo.png',
    status: 'available',
    features: ['MCP 协议', 'JSON-RPC 2.0', '仓颉语言原生', 'Agent 工具调用'],
    endpoints: ['cangjie'],
  },
  {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    description: '基于 ACP 协议的 AI 编程助手，支持自定义 Agent 配置',
    icon: '⚡',
    status: 'available',
    features: ['ACP 协议', '自定义 Agent', 'JSON-RPC 2.0', '流式输出'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: '开源 AI 编程 Agent，支持 ACP 协议，模型在 opencode 配置中设置',
    icon: '/images/opencode_logo.svg',
    status: 'available',
    features: ['ACP 协议', 'JSON-RPC 2.0', '开源', '流式输出'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex 引擎，专注于代码生成和理解',
    icon: '🔮',
    status: 'coming-soon',
    features: ['代码生成', '代码补全', '多语言支持', 'API 集成'],
    endpoints: ['openai'],
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    description: 'Cursor 命令行工具，提供智能代码编辑和 AI 辅助能力',
    icon: '✨',
    status: 'coming-soon',
    features: ['智能补全', '代码重构', '命令行集成', '上下文感知'],
    endpoints: ['anthropic', 'openai'],
  },
];

export default function EnginesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [currentEngine, setCurrentEngine] = useState<string>('claude-code');
  const [loading, setLoading] = useState(true);
  const [engineAvailability, setEngineAvailability] = useState<Record<string, boolean>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  useEffect(() => {
    loadCurrentEngine();
    checkEngineAvailability();
  }, []);

  const loadCurrentEngine = async () => {
    try {
      const response = await fetch('/api/engine');
      const data = await response.json();
      if (data.engine) {
        setCurrentEngine(data.engine);
      }
    } catch (error) {
      console.error('Failed to load current engine:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkEngineAvailability = async () => {
    setCheckingAvailability(true);
    const availability: Record<string, boolean> = {};

    for (const engine of engines) {
      if (engine.status === 'available') {
        try {
          const response = await fetch(`/api/engine/availability?engine=${engine.id}`);
          const data = await response.json();
          availability[engine.id] = data.available;
        } catch (error) {
          console.error(`Failed to check ${engine.id} availability:`, error);
          availability[engine.id] = false;
        }
      }
    }

    setEngineAvailability(availability);
    setCheckingAvailability(false);
  };

  const handleSelectEngine = async (engineId: string) => {
    const engine = engines.find(e => e.id === engineId);
    if (engine?.status === 'coming-soon') {
      return;
    }

    // Check if engine is available before switching
    if (engineAvailability[engineId] === false) {
      const hints: Record<string, string> = {
        'kiro-cli': '安装方法：curl -fsSL https://cli.kiro.dev/install | bash',
        'claude-code': '安装方法：npm install -g @anthropic-ai/claude-code',
        'cangjie-magic': '请在环境变量中配置 CANGJIE_HOME、CANGJIE_MAGIC_PATH、OPENSSL_PATH、CANGJIE_STDX_PATH',
        'opencode': '安装方法：npm install -g opencode-ai',
      };
      const hint = hints[engineId] || '请确保已安装相应的命令行工具';
      toast('error', `引擎 ${engine?.name} 不可用。${hint}`);
      return;
    }

    try {
      const response = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engineId }),
      });

      if (response.ok) {
        setCurrentEngine(engineId);
        toast('success', `已切换到 ${engine?.name} 引擎`);
      } else {
        toast('error', '切换引擎失败');
      }
    } catch (error) {
      console.error('Failed to set engine:', error);
      toast('error', '切换引擎失败: ' + (error as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  返回首页
                </Link>
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-2xl font-bold">引擎管理</h1>
                <p className="text-xs text-muted-foreground">选择和配置 AI 编程引擎</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Current Engine Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-xl p-6"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-lg">
              <Cpu className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">当前引擎</h2>
              <p className="text-sm text-muted-foreground">
                {engines.find(e => e.id === currentEngine)?.name || 'Claude Code'}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Engines Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {engines.map((engine, index) => (
            <motion.div
              key={engine.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative bg-card border rounded-xl p-6 transition-all ${
                currentEngine === engine.id
                  ? 'border-primary shadow-lg shadow-primary/20'
                  : 'border-border hover:border-primary/50'
              } ${engine.status === 'coming-soon' ? 'opacity-60' : 'cursor-pointer'}`}
              onClick={() => handleSelectEngine(engine.id)}
            >
              {/* Selected Badge */}
              {currentEngine === engine.id && (
                <div className="absolute top-4 right-4">
                  <Badge className="bg-primary text-primary-foreground">
                    <Check className="w-3 h-3 mr-1" />
                    使用中
                  </Badge>
                </div>
              )}

              {/* Coming Soon Badge */}
              {engine.status === 'coming-soon' && (
                <div className="absolute top-4 right-4">
                  <Badge variant="secondary">即将推出</Badge>
                </div>
              )}

              {/* Availability Badge */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <div className="absolute top-4 right-4">
                  {checkingAvailability ? (
                    <Badge variant="outline">检查中...</Badge>
                  ) : engineAvailability[engine.id] === false ? (
                    <Badge variant="destructive">不可用</Badge>
                  ) : engineAvailability[engine.id] === true ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">可用</Badge>
                  ) : null}
                </div>
              )}

              {/* Engine Icon */}
              {engine.icon.startsWith('/') ? (
                <img src={engine.icon} alt={engine.name} className="w-24 h-24 mb-4 object-contain" />
              ) : (
                <div className="text-5xl mb-4">{engine.icon}</div>
              )}

              {/* Engine Info */}
              <h3 className="text-xl font-bold mb-2">{engine.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">{engine.description}</p>

              {/* Features */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">特性：</p>
                <div className="flex flex-wrap gap-2">
                  {engine.features.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* API Endpoints */}
              <div className="space-y-2 mt-3">
                <p className="text-xs font-medium text-muted-foreground">API 端点：</p>
                <div className="flex flex-wrap gap-2">
                  {engine.endpoints.map((endpoint) => (
                    <Badge key={endpoint} variant="default" className="text-xs bg-primary/10 text-primary hover:bg-primary/20">
                      {endpoint}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Select Button */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectEngine(engine.id);
                  }}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  切换到此引擎
                </Button>
              )}
            </motion.div>
          ))}
        </div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 bg-muted/50 border border-border rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">关于引擎</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={checkEngineAvailability}
              disabled={checkingAvailability}
            >
              {checkingAvailability ? '检查中...' : '刷新可用性'}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            不同的 AI 引擎提供不同的能力和特性。Claude Code 提供完整的代码编辑和执行能力。
            Kiro CLI 基于 ACP 协议，支持自定义 Agent 配置。
            CangjieMagic 是仓颉语言 AI Agent 框架，通过 MCP 协议提供工具调用能力。
          </p>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
            <p><strong>安装 Claude Code：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              npm install -g @anthropic-ai/claude-code
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Claude Code 引擎。</p>
            <p className="mt-2"><strong>安装 Kiro CLI：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              curl -fsSL https://cli.kiro.dev/install | bash
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Kiro CLI 引擎。</p>
            <p className="mt-2"><strong>配置 CangjieMagic：</strong></p>
            <p className="text-xs">在环境变量中配置以下变量后刷新可用性检查：</p>
            <code className="block bg-background/50 p-2 rounded text-xs whitespace-pre-line">
{`CANGJIE_HOME — 仓颉 SDK 根目录
CANGJIE_MAGIC_PATH — CangjieMagic 项目路径
OPENSSL_PATH — OpenSSL 动态库路径
CANGJIE_STDX_PATH — stdx 动态库路径`}
            </code>
            <p className="mt-2"><strong>安装 OpenCode：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              npm install -g opencode-ai
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 OpenCode 引擎。</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
