'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { scheduleApi, configApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ThemeToggle } from '@/components/theme-toggle';

interface ScheduleJob {
  id: string;
  name: string;
  configFile: string;
  enabled: boolean;
  mode: 'simple' | 'cron';
  interval?: { value: number; unit: 'hour' | 'day' | 'week' };
  fixedTime?: { hour: number; minute: number; weekday?: number };
  cronExpression?: string;
  lastRunId?: string;
  lastRunTime?: string;
  lastRunStatus?: string;
  nextRunTime?: string;
  createdAt: string;
  runHistory: { runId: string; time: string; status: string }[];
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeSchedule(job: ScheduleJob): string {
  if (job.mode === 'cron') return `Cron: ${job.cronExpression}`;
  if (job.interval) {
    const { value, unit } = job.interval;
    const unitLabel = { hour: '小时', day: '天', week: '周' }[unit];
    let desc = `每 ${value} ${unitLabel}`;
    if (job.fixedTime && (unit === 'day' || unit === 'week')) {
      desc += ` ${String(job.fixedTime.hour).padStart(2, '0')}:${String(job.fixedTime.minute).padStart(2, '0')}`;
    }
    if (job.fixedTime?.weekday !== undefined && unit === 'week') {
      desc += ` ${WEEKDAYS[job.fixedTime.weekday]}`;
    }
    return desc;
  }
  if (job.fixedTime) {
    const t = `${String(job.fixedTime.hour).padStart(2, '0')}:${String(job.fixedTime.minute).padStart(2, '0')}`;
    if (job.fixedTime.weekday !== undefined) return `每${WEEKDAYS[job.fixedTime.weekday]} ${t}`;
    return `每天 ${t}`;
  }
  return job.cronExpression || '未配置';
}

function formatTime(iso?: string) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; }
}

export default function SchedulesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [configs, setConfigs] = useState<{ filename: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduleJob | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formConfig, setFormConfig] = useState('');
  const [formMode, setFormMode] = useState<'simple' | 'cron'>('simple');
  const [formIntervalValue, setFormIntervalValue] = useState(1);
  const [formIntervalUnit, setFormIntervalUnit] = useState<'hour' | 'day' | 'week'>('day');
  const [formHour, setFormHour] = useState(0);
  const [formMinute, setFormMinute] = useState(0);
  const [formWeekday, setFormWeekday] = useState(1);
  const [formCron, setFormCron] = useState('0 0 * * *');
  const [formEnabled, setFormEnabled] = useState(true);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const [schedData, cfgData] = await Promise.all([scheduleApi.list(), configApi.listConfigs()]);
      setJobs(schedData.jobs || []);
      setConfigs((cfgData.configs || []).map((c: any) => ({ filename: c.filename, name: c.name })));
    } catch { toast('error', '加载定时任务失败'); }
    setLoading(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const resetForm = (job?: ScheduleJob) => {
    if (job) {
      setFormName(job.name);
      setFormConfig(job.configFile);
      setFormMode(job.mode);
      setFormIntervalValue(job.interval?.value ?? 1);
      setFormIntervalUnit(job.interval?.unit ?? 'day');
      setFormHour(job.fixedTime?.hour ?? 0);
      setFormMinute(job.fixedTime?.minute ?? 0);
      setFormWeekday(job.fixedTime?.weekday ?? 1);
      setFormCron(job.cronExpression || '0 0 * * *');
      setFormEnabled(job.enabled);
    } else {
      setFormName('');
      setFormConfig(configs[0]?.filename || '');
      setFormMode('simple');
      setFormIntervalValue(1);
      setFormIntervalUnit('day');
      setFormHour(0);
      setFormMinute(0);
      setFormWeekday(1);
      setFormCron('0 0 * * *');
      setFormEnabled(true);
    }
  };

  const openCreate = () => { setEditingJob(null); resetForm(); setDialogOpen(true); };
  const openEdit = (job: ScheduleJob) => { setEditingJob(job); resetForm(job); setDialogOpen(true); };

  const handleSave = async () => {
    if (!formName.trim() || !formConfig) { toast('error', '请填写名称和配置文件'); return; }
    const payload: any = {
      name: formName.trim(),
      configFile: formConfig,
      enabled: formEnabled,
      mode: formMode,
    };
    if (formMode === 'simple') {
      payload.interval = { value: formIntervalValue, unit: formIntervalUnit };
      if (formIntervalUnit !== 'hour') {
        payload.fixedTime = { hour: formHour, minute: formMinute };
        if (formIntervalUnit === 'week') payload.fixedTime.weekday = formWeekday;
      }
    } else {
      payload.cronExpression = formCron;
    }
    try {
      if (editingJob) {
        await scheduleApi.update(editingJob.id, payload);
        toast('success', '定时任务已更新');
      } else {
        await scheduleApi.create(payload);
        toast('success', '定时任务已创建');
      }
      setDialogOpen(false);
      loadJobs();
    } catch (e: any) { toast('error', e.message); }
  };

  const handleToggle = async (job: ScheduleJob) => {
    try {
      await scheduleApi.toggle(job.id);
      loadJobs();
    } catch { toast('error', '切换失败'); }
  };

  const handleTrigger = async (job: ScheduleJob) => {
    try {
      await scheduleApi.trigger(job.id);
      toast('success', `已触发 "${job.name}"`);
      loadJobs();
    } catch { toast('error', '触发失败'); }
  };

  const handleDelete = async (job: ScheduleJob) => {
    const ok = await confirm({ title: '删除定时任务', description: `确定要删除 "${job.name}" 吗？`, confirmLabel: '删除', variant: 'destructive' });
    if (!ok) return;
    try {
      await scheduleApi.delete(job.id);
      toast('success', '已删除');
      loadJobs();
    } catch { toast('error', '删除失败'); }
  };

  const statusBadge = (s?: string) => {
    if (!s) return null;
    const map: Record<string, string> = { started: 'bg-green-500/15 text-green-600', failed: 'bg-red-500/15 text-red-600', error: 'bg-red-500/15 text-red-600' };
    return <Badge className={map[s] || 'bg-muted text-muted-foreground'}>{s}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </Link>
            <h1 className="text-lg font-semibold">定时任务</h1>
            <Badge variant="secondary">{jobs.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}>
              <span className="material-symbols-outlined text-sm mr-1">add</span>新建定时任务
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-20 text-muted-foreground">加载中...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-5xl text-muted-foreground/40 mb-4 block">schedule</span>
            <p className="text-muted-foreground mb-4">还没有定时任务</p>
            <Button onClick={openCreate}>创建第一个定时任务</Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">名称</th>
                  <th className="text-left px-4 py-3 font-medium">配置文件</th>
                  <th className="text-left px-4 py-3 font-medium">调度规则</th>
                  <th className="text-center px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">上次执行</th>
                  <th className="text-left px-4 py-3 font-medium">下次执行</th>
                  <th className="text-right px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map(job => (
                  <tr key={job.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{job.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.configFile}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{describeSchedule(job)}</td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={job.enabled} onCheckedChange={() => handleToggle(job)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatTime(job.lastRunTime)}</span>
                        {statusBadge(job.lastRunStatus)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{job.enabled ? formatTime(job.nextRunTime) : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(job)} title="编辑">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleTrigger(job)} title="立即执行">
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(job)} title="删除" className="text-destructive hover:text-destructive">
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <h2 className="text-lg font-semibold mb-4">{editingJob ? '编辑定时任务' : '新建定时任务'}</h2>
          <div className="space-y-4">
            <div>
              <Label>任务名称</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="例：每日代码审计" />
            </div>
            <div>
              <Label>配置文件</Label>
              <Select value={formConfig} onValueChange={setFormConfig}>
                <SelectTrigger><SelectValue placeholder="选择配置文件" /></SelectTrigger>
                <SelectContent>
                  {configs.map(c => <SelectItem key={c.filename} value={c.filename}>{c.name} ({c.filename})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>调度模式</Label>
              <Tabs value={formMode} onValueChange={v => setFormMode(v as 'simple' | 'cron')}>
                <TabsList className="w-full">
                  <TabsTrigger value="simple" className="flex-1">简单模式</TabsTrigger>
                  <TabsTrigger value="cron" className="flex-1">Cron 模式</TabsTrigger>
                </TabsList>
                <TabsContent value="simple" className="space-y-3 mt-3">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label>间隔类型</Label>
                      <Select value={formIntervalUnit} onValueChange={v => setFormIntervalUnit(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hour">每隔N小时</SelectItem>
                          <SelectItem value="day">每天</SelectItem>
                          <SelectItem value="week">每周</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formIntervalUnit === 'hour' && (
                      <div className="w-24">
                        <Label>间隔</Label>
                        <Input type="number" min={1} max={23} value={formIntervalValue} onChange={e => setFormIntervalValue(Number(e.target.value))} />
                      </div>
                    )}
                  </div>
                  {formIntervalUnit !== 'hour' && (
                    <div className="flex gap-2 items-end">
                      {formIntervalUnit === 'week' && (
                        <div className="flex-1">
                          <Label>星期</Label>
                          <Select value={String(formWeekday)} onValueChange={v => setFormWeekday(Number(v))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="w-20">
                        <Label>时</Label>
                        <Input type="number" min={0} max={23} value={formHour} onChange={e => setFormHour(Number(e.target.value))} />
                      </div>
                      <div className="w-20">
                        <Label>分</Label>
                        <Input type="number" min={0} max={59} value={formMinute} onChange={e => setFormMinute(Number(e.target.value))} />
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="cron" className="space-y-3 mt-3">
                  <div>
                    <Label>Cron 表达式</Label>
                    <Input value={formCron} onChange={e => setFormCron(e.target.value)} placeholder="0 0 * * *" className="font-mono" />
                    <p className="text-xs text-muted-foreground mt-1">格式: 分 时 日 月 周 (例: 0 2 * * * = 每天凌晨2点)</p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              <Label>创建后立即启用</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={handleSave}>{editingJob ? '保存' : '创建'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
