'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const phaseSchema = z.object({
  name: z.string().min(1, '阶段名称不能为空'),
  checkpointEnabled: z.boolean(),
  checkpointName: z.string().optional(),
  checkpointMessage: z.string().optional(),
  iterationEnabled: z.boolean(),
  maxIterations: z.number().min(1).max(20).optional(),
  exitCondition: z.string().optional(),
  consecutiveCleanRounds: z.number().min(1).max(10).optional(),
  escalateToHuman: z.boolean().optional(),
});

const stepSchema = z.object({
  name: z.string().min(1, '步骤名称不能为空'),
  agent: z.string().min(1, 'Agent 名称不能为空'),
  task: z.string().min(1, '任务描述不能为空'),
  constraints: z.string().optional(),
  enableReviewPanel: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
});

type PhaseForm = z.infer<typeof phaseSchema>;
type StepForm = z.infer<typeof stepSchema>;

interface RoleOption {
  name: string;
  team: string;
}

interface SkillOption {
  name: string;
  description: string;
  tags?: string[];
}

interface EditNodeModalProps {
  isOpen: boolean;
  type: 'phase' | 'step';
  data: any;
  roles?: RoleOption[];
  availableSkills?: SkillOption[];
  isNew?: boolean;
  existingPhases?: any[];
  existingSteps?: any[];
  onClose: () => void;
  onSave: (data: any) => void;
  onDelete?: () => void;
}

export default function EditNodeModal({
  isOpen,
  type,
  data,
  roles = [],
  availableSkills = [],
  isNew = false,
  existingPhases = [],
  existingSteps = [],
  onClose,
  onSave,
  onDelete,
}: EditNodeModalProps) {
  const isPhase = type === 'phase';
  const schema = isPhase ? phaseSchema : stepSchema;
  const [showSkillSelector, setShowSkillSelector] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isPhase
      ? {
          name: data?.name || '',
          checkpointEnabled: !!data?.checkpoint,
          checkpointName: data?.checkpoint?.name || '',
          checkpointMessage: data?.checkpoint?.message || '',
          iterationEnabled: !!data?.iteration?.enabled,
          maxIterations: data?.iteration?.maxIterations || 5,
          exitCondition: data?.iteration?.exitCondition || 'no_new_bugs_3_rounds',
          consecutiveCleanRounds: data?.iteration?.consecutiveCleanRounds || 3,
          escalateToHuman: data?.iteration?.escalateToHuman ?? true,
        }
      : {
          name: data?.name || '',
          agent: data?.agent || '',
          task: data?.task || '',
          constraints: Array.isArray(data?.constraints) ? data.constraints.join('\n') : (data?.constraints || ''),
          enableReviewPanel: data?.enableReviewPanel || false,
          skills: data?.skills || [],
        },
  });

  const checkpointEnabled = watch('checkpointEnabled');
  const iterationEnabled = watch('iterationEnabled');

  const handleCopyFrom = (sourceName: string) => {
    if (!sourceName) return;
    if (isPhase) {
      const source = existingPhases.find((p: any) => p.name === sourceName);
      if (!source) return;
      reset({
        name: source.name + ' (副本)',
        checkpointEnabled: !!source.checkpoint,
        checkpointName: source.checkpoint?.name || '',
        checkpointMessage: source.checkpoint?.message || '',
        iterationEnabled: !!source.iteration?.enabled,
        maxIterations: source.iteration?.maxIterations || 5,
        exitCondition: source.iteration?.exitCondition || 'no_new_bugs_3_rounds',
        consecutiveCleanRounds: source.iteration?.consecutiveCleanRounds || 3,
        escalateToHuman: source.iteration?.escalateToHuman ?? true,
      });
    } else {
      const source = existingSteps.find((s: any) => s.name === sourceName);
      if (!source) return;
      reset({
        name: source.name + ' (副本)',
        agent: source.agent || '',
        task: source.task || '',
        constraints: source.constraints?.join('\n') || '',
        enableReviewPanel: source.enableReviewPanel || false,
        skills: source.skills || [],
      });
    }
  };

  const onSubmit = (formData: any) => {
    if (isPhase) {
      const phaseData: any = { name: formData.name };
      if (formData.checkpointEnabled) {
        phaseData.checkpoint = {
          name: formData.checkpointName,
          message: formData.checkpointMessage,
        };
      }
      if (formData.iterationEnabled) {
        phaseData.iteration = {
          enabled: true,
          maxIterations: Number(formData.maxIterations) || 5,
          exitCondition: formData.exitCondition || 'no_new_bugs_3_rounds',
          consecutiveCleanRounds: Number(formData.consecutiveCleanRounds) || 3,
          escalateToHuman: formData.escalateToHuman ?? true,
        };
      } else {
        phaseData.iteration = { enabled: false };
      }
      onSave(phaseData);
    } else {
      const selectedRole = roles.find((r) => r.name === formData.agent);
      const teamToRole: Record<string, string> = { blue: 'defender', red: 'attacker', judge: 'judge' };
      const stepData: any = {
        name: formData.name,
        agent: formData.agent,
        task: formData.task,
      };
      if (selectedRole && teamToRole[selectedRole.team]) {
        stepData.role = teamToRole[selectedRole.team];
      }
      if (formData.constraints) {
        stepData.constraints = formData.constraints
          .split('\n')
          .filter((c: string) => c.trim());
      }
      if (formData.enableReviewPanel !== undefined) {
        stepData.enableReviewPanel = formData.enableReviewPanel;
      }
      if (formData.skills && formData.skills.length > 0) {
        stepData.skills = formData.skills;
      }
      onSave(stepData);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0">
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <DialogTitle>{isNew ? (isPhase ? '新建阶段' : '新建步骤') : (isPhase ? '编辑阶段' : '编辑步骤')}</DialogTitle>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="edit-node-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-auto px-6 space-y-4">
          {isNew && ((isPhase && existingPhases.length > 0) || (!isPhase && existingSteps.length > 0)) && (
            <div className="space-y-2">
              <Label>从现有复制</Label>
              <Select onValueChange={handleCopyFrom}>
                <SelectTrigger>
                  <SelectValue placeholder="选择要复制的模板..." />
                </SelectTrigger>
                <SelectContent>
                  {(isPhase ? existingPhases : existingSteps).map((item: any) => (
                    <SelectItem key={item.name} value={item.name}>
                      <span className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        {item.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isPhase ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">
                  阶段名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  {...register('name')}
                  className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message as string}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="checkpointEnabled">启用检查点</Label>
                <Switch
                  id="checkpointEnabled"
                  checked={checkpointEnabled as boolean}
                  onCheckedChange={(v) => setValue('checkpointEnabled', v)}
                />
              </div>

              {checkpointEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="checkpointName">检查点名称</Label>
                    <Input id="checkpointName" {...register('checkpointName')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="checkpointMessage">检查点消息</Label>
                    <Textarea id="checkpointMessage" rows={3} {...register('checkpointMessage')} />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="iterationEnabled">启用对抗迭代</Label>
                <Switch
                  id="iterationEnabled"
                  checked={iterationEnabled as boolean}
                  onCheckedChange={(v) => setValue('iterationEnabled', v)}
                />
              </div>
              {iterationEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="maxIterations">最大迭代次数 (1-20)</Label>
                    <Input id="maxIterations" type="number" min={1} max={20} {...register('maxIterations', { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="exitCondition">退出条件</Label>
                    <Select
                      defaultValue={data?.iteration?.exitCondition || 'no_new_bugs_3_rounds'}
                      onValueChange={(v) => setValue('exitCondition', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no_new_bugs_3_rounds">连续 N 轮无新 Bug</SelectItem>
                        <SelectItem value="all_resolved">所有问题已解决</SelectItem>
                        <SelectItem value="manual">手动停止</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="consecutiveCleanRounds">连续无 Bug 轮数</Label>
                    <Input id="consecutiveCleanRounds" type="number" min={1} max={10} {...register('consecutiveCleanRounds', { valueAsNumber: true })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="escalateToHuman">达到上限时升级人工</Label>
                    <Switch
                      id="escalateToHuman"
                      checked={watch('escalateToHuman') as boolean}
                      onCheckedChange={(v) => setValue('escalateToHuman', v)}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">
                  步骤名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  {...register('name')}
                  className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message as string}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="agent">
                  Agent <span className="text-destructive">*</span>
                </Label>
                <Select
                  defaultValue={data?.agent || ''}
                  onValueChange={(v) => setValue('agent', v)}
                >
                  <SelectTrigger className={errors.agent ? 'border-destructive' : ''}>
                    <SelectValue placeholder="请选择 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">
                            {r.team === 'red' ? 'swords' : r.team === 'judge' ? 'balance' : 'shield'}
                          </span>
                          {r.name} ({r.team})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.agent && (
                  <p className="text-sm text-destructive">{errors.agent.message as string}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="task">
                  任务描述 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="task"
                  rows={4}
                  {...register('task')}
                  className={errors.task ? 'border-destructive' : ''}
                />
                {errors.task && (
                  <p className="text-sm text-destructive">{errors.task.message as string}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="constraints">约束条件（每行一条）</Label>
                <Textarea
                  id="constraints"
                  rows={3}
                  {...register('constraints')}
                  placeholder={"不得修改公共 API 接口\n必须保持向后兼容\n单个文件不超过 500 行"}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="enableReviewPanel">启用专家模式</Label>
                  <p className="text-xs text-muted-foreground">
                    启用后将启动多个专家子 Agent 从不同角度进行分析
                  </p>
                </div>
                <Switch
                  id="enableReviewPanel"
                  checked={watch('enableReviewPanel') as boolean}
                  onCheckedChange={(v) => setValue('enableReviewPanel', v)}
                />
              </div>

              {availableSkills.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Skills</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowSkillSelector(true)}
                    >
                      <span className="material-symbols-outlined text-xs mr-1">list</span>
                      选择 ({(watch('skills') || []).length})
                    </Button>
                  </div>
                  <div className="min-h-[40px] p-2 border rounded-md bg-muted/30">
                    {(watch('skills') || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(watch('skills') || []).map((skillName: string) => (
                          <Badge key={skillName} variant="secondary" className="text-xs">
                            {skillName}
                            <button
                              type="button"
                              className="ml-1 hover:text-destructive"
                              onClick={() => {
                                const current = watch('skills') || [];
                                setValue('skills', current.filter((s: string) => s !== skillName));
                              }}
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center text-muted-foreground text-xs py-2">
                        <span className="material-symbols-outlined text-sm mr-1">info</span>
                        未选择任何 Skills
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

        </form>
        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          {onDelete && (
            <Button type="button" variant="destructive" onClick={onDelete} className="mr-auto">
              <span className="material-symbols-outlined text-base mr-1">delete</span>
              删除
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="edit-node-form" disabled={isSubmitting}>
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
        {/* Skill Selector Dialog */}
        {showSkillSelector && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowSkillSelector(false)}>
            <div className="bg-card rounded-lg w-[600px] max-w-[90%] max-h-[70vh] flex flex-col border" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b flex items-center justify-between shrink-0">
                <h3 className="text-base font-semibold">选择 Skills</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSkillSelector(false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 w-8"></th>
                      <th className="text-left py-2 px-2">名称</th>
                      <th className="text-left py-2 px-2">描述</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableSkills.map((skill) => (
                      <tr key={skill.name} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-2">
                          <Checkbox
                            checked={(watch('skills') || []).includes(skill.name)}
                            onCheckedChange={(checked) => {
                              const current = watch('skills') || [];
                              const newSkills = checked
                                ? [...current, skill.name]
                                : current.filter((s: string) => s !== skill.name);
                              setValue('skills', newSkills);
                            }}
                          />
                        </td>
                        <td className="py-2 px-2 font-medium">{skill.name}</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{skill.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t flex justify-between items-center shrink-0">
                <span className="text-xs text-muted-foreground">已选择 {(watch('skills') || []).length} 个</span>
                <Button size="sm" onClick={() => setShowSkillSelector(false)}>确定</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}