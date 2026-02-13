'use client';

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
});

type PhaseForm = z.infer<typeof phaseSchema>;
type StepForm = z.infer<typeof stepSchema>;

interface RoleOption {
  name: string;
  team: string;
}

interface EditNodeModalProps {
  isOpen: boolean;
  type: 'phase' | 'step';
  data: any;
  roles?: RoleOption[];
  onClose: () => void;
  onSave: (data: any) => void;
  onDelete?: () => void;
}

export default function EditNodeModal({
  isOpen,
  type,
  data,
  roles = [],
  onClose,
  onSave,
  onDelete,
}: EditNodeModalProps) {
  const isPhase = type === 'phase';
  const schema = isPhase ? phaseSchema : stepSchema;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
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
          constraints: data?.constraints?.join('\n') || '',
        },
  });

  const checkpointEnabled = watch('checkpointEnabled');
  const iterationEnabled = watch('iterationEnabled');
  /* PLACEHOLDER_ONSUBMIT */

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
      onSave(stepData);
    }
  };
  /* PLACEHOLDER_RETURN */

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPhase ? '编辑阶段' : '编辑步骤'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            </>
          )}

          <DialogFooter className="gap-2">
            {onDelete && (
              <Button type="button" variant="destructive" onClick={onDelete} className="mr-auto">
                <span className="material-symbols-outlined text-base mr-1">delete</span>
                删除
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
