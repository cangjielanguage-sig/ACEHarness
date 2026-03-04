'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, Cpu, Database, TrendingUp, Clock, CheckCircle2, XCircle, AlertCircle, Workflow, Bot, Settings, History, Play } from 'lucide-react';
import { configApi, runsApi, agentApi } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import NewConfigModal from '@/components/NewConfigModal';

interface DashboardStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  activeWorkflows: number;
  totalAgents: number;
  runningProcesses: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const [stats, setStats] = useState<DashboardStats>({
    totalRuns: 0,
    successRate: 0,
    avgDuration: 0,
    activeWorkflows: 0,
    totalAgents: 0,
    runningProcesses: 0,
  });
  const [configs, setConfigs] = useState<any[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [performanceData, setPerformanceData] = useState<any[]>([]);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [runningRuns, setRunningRuns] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const configsData = await configApi.listConfigs();
      setConfigs(configsData.configs || []);

      // Load agent count
      let agentCount = 0;
      try {
        const agentsData = await agentApi.listAgents();
        agentCount = agentsData.agents?.length || 0;
      } catch (e) {
        console.error('Failed to load agents:', e);
      }

      // Load runs from all configs
      const allRuns: any[] = [];
      for (const config of (configsData.configs || [])) {
        try {
          const runsData = await runsApi.listByConfig(config.filename);
          const runs = runsData.runs || [];
          allRuns.push(...runs);
        } catch (e) {
          // Ignore errors for individual configs
        }
      }

      // Filter running runs for active workflows section
      const activeRuns = allRuns.filter((r: any) => r.status === 'running');
      setRunningRuns(activeRuns);

      // Sort runs by start time
      allRuns.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      setRecentRuns(allRuns.slice(-5).reverse());

      // Calculate stats
      const completed = allRuns.filter((r: any) => r.status === 'completed').length;
      const failed = allRuns.filter((r: any) => r.status === 'failed').length;
      const successRate = allRuns.length > 0 ? (completed / allRuns.length) * 100 : 0;
      const avgDuration = allRuns.length > 0
        ? allRuns.reduce((acc: number, r: any) => {
            if (r.endTime) {
              return acc + (new Date(r.endTime).getTime() - new Date(r.startTime).getTime());
            }
            return acc;
          }, 0) / allRuns.length / 1000 / 60
        : 0;

      setStats({
        totalRuns: allRuns.length,
        successRate: Math.round(successRate),
        avgDuration: Math.round(avgDuration),
        activeWorkflows: configsData.configs?.length || 0,
        totalAgents: agentCount,
        runningProcesses: allRuns.filter((r: any) => r.status === 'running').length,
      });

      // Generate performance trend data (last 24 hours, grouped by 4-hour intervals)
      const now = Date.now();
      const intervals = 6; // 24 hours / 4 hours
      const perfData = [];

      for (let i = 0; i < intervals; i++) {
        const startTime = now - (intervals - i) * 4 * 60 * 60 * 1000;
        const endTime = now - (intervals - i - 1) * 4 * 60 * 60 * 1000;
        const hour = new Date(startTime).getHours();

        const runsInInterval = allRuns.filter((r: any) => {
          const runTime = new Date(r.startTime).getTime();
          return runTime >= startTime && runTime < endTime;
        });

        const successCount = runsInInterval.filter((r: any) => r.status === 'completed').length;
        const failCount = runsInInterval.filter((r: any) => r.status === 'failed').length;

        perfData.push({
          time: `${hour.toString().padStart(2, '0')}:00`,
          success: successCount,
          failed: failCount,
        });
      }

      setPerformanceData(perfData);

      // Generate weekly activity data (last 7 days)
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const actData = [];

      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date();
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        const runsInDay = allRuns.filter((r: any) => {
          const runTime = new Date(r.startTime).getTime();
          return runTime >= dayStart.getTime() && runTime <= dayEnd.getTime();
        });

        actData.push({
          name: weekDays[dayStart.getDay()],
          runs: runsInDay.length,
        });
      }

      setActivityData(actData);

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ icon: Icon, label, value, trend, color }: any) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(59, 130, 246, 0.3)' }}
      className="relative bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-xl border border-border/50 rounded-xl p-6 overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-lg bg-gradient-to-br ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          {trend && (
            <Badge variant="secondary" className="text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              {trend}
            </Badge>
          )}
        </div>
        <div className="text-3xl font-bold mb-1">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
      <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />
    </motion.div>
  );

  const QuickAction = ({ icon: Icon, label, onClick, color }: any) => (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`relative bg-gradient-to-br ${color} p-6 rounded-xl border border-white/10 overflow-hidden group`}
    >
      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10 flex flex-col items-center gap-3">
        <Icon className="w-8 h-8 text-white" />
        <span className="text-sm font-medium text-white">{label}</span>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-2000" />
      </div>

      {/* Grid overlay */}
      <div className="fixed inset-0 z-0 opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(hsl(var(--primary) / 0.1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.1) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }} />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <motion.header
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50"
        >
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                  className="p-2 bg-gradient-to-br from-primary to-blue-600 rounded-lg"
                >
                  <Zap className="w-6 h-6 text-white" />
                </motion.div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                    {t('dashboard.title')}
                  </h1>
                  <p className="text-xs text-muted-foreground">{t('dashboard.subtitle')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <LanguageToggle />
                <ThemeToggle />
                <Button variant="outline" size="sm" onClick={() => router.push('/agents')}>
                  <Bot className="w-4 h-4 mr-2" />
                  {t('agents.title')}
                </Button>
                <Button size="sm" onClick={() => setShowNewModal(true)}>
                  <Play className="w-4 h-4 mr-2" />
                  {t('dashboard.quickActions.newWorkflow')}
                </Button>
              </div>
            </div>
          </div>
        </motion.header>

        <div className="container mx-auto px-6 py-8 space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              icon={Activity}
              label={t('dashboard.stats.totalRuns')}
              value={stats.totalRuns}
              trend="+12%"
              color="from-blue-500 to-blue-600"
            />
            <StatCard
              icon={CheckCircle2}
              label={t('dashboard.stats.successRate')}
              value={`${stats.successRate}%`}
              trend="+5%"
              color="from-green-500 to-green-600"
            />
            <StatCard
              icon={Clock}
              label={t('dashboard.stats.avgDuration')}
              value={`${stats.avgDuration}m`}
              trend="-8%"
              color="from-purple-500 to-purple-600"
            />
            <StatCard
              icon={Cpu}
              label={t('dashboard.stats.activeProcesses')}
              value={stats.runningProcesses}
              color="from-orange-500 to-orange-600"
            />
          </div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {t('dashboard.quickActions.title')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <QuickAction
                icon={Play}
                label={t('dashboard.quickActions.newWorkflow')}
                onClick={() => setShowNewModal(true)}
                color="from-blue-600 to-blue-700"
              />
              <QuickAction
                icon={Workflow}
                label={t('dashboard.quickActions.workflows')}
                onClick={() => router.push('/workflows')}
                color="from-cyan-600 to-cyan-700"
              />
              <QuickAction
                icon={Bot}
                label={t('dashboard.quickActions.manageAgents')}
                onClick={() => router.push('/agents')}
                color="from-purple-600 to-purple-700"
              />
              <QuickAction
                icon={History}
                label={t('dashboard.quickActions.viewHistory')}
                onClick={() => router.push('/workbench/workflow.yaml?mode=history')}
                color="from-green-600 to-green-700"
              />
              <QuickAction
                icon={Settings}
                label={t('dashboard.quickActions.settings')}
                onClick={() => router.push('/models')}
                color="from-orange-600 to-orange-700"
              />
            </div>
          </motion.div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Chart */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                {t('dashboard.charts.performanceTrends')}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={performanceData}>
                  <defs>
                    <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Area type="monotone" dataKey="success" stroke="#10b981" fillOpacity={1} fill="url(#colorSuccess)" />
                  <Area type="monotone" dataKey="failed" stroke="#ef4444" fillOpacity={1} fill="url(#colorFailed)" />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            {/* Activity Chart */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                {t('dashboard.charts.weeklyActivity')}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={activityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="runs" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* Workflows and Recent Runs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Workflows */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Workflow className="w-5 h-5 text-primary" />
                {t('dashboard.sections.activeWorkflows')}
              </h3>
              <div className="space-y-3">
                {runningRuns.slice(0, 5).map((run, i) => {
                  const config = configs.find(c => c.filename === run.configFile);
                  const configName = config?.name || run.configName || run.configFile;

                  return (
                    <motion.div
                      key={run.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                      whileHover={{ x: 5 }}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/30 cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <div className="flex flex-col">
                          <span className="font-medium">{configName}</span>
                          <span className="text-xs text-muted-foreground">{run.currentPhase || 'Starting...'}</span>
                        </div>
                      </div>
                      <Badge variant="secondary">{run.completedSteps || 0}/{run.totalSteps || 0}</Badge>
                    </motion.div>
                  );
                })}
                {runningRuns.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    {t('dashboard.sections.noActiveWorkflows')}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Recent Runs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                {t('dashboard.sections.recentRuns')}
              </h3>
              <div className="space-y-3">
                {recentRuns.map((run, i) => (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 + i * 0.1 }}
                    onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/30 cursor-pointer hover:bg-muted/70 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {run.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : run.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{run.configName || run.configFile}</div>
                        <div className="text-xs text-muted-foreground">
                          {run.currentPhase || '启动中'} · {new Date(run.startTime).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>
                      {t(`dashboard.status.${run.status}`)}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onSuccess={(filename) => {
            setShowNewModal(false);
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }}
        />
      )}
    </div>
  );
}
