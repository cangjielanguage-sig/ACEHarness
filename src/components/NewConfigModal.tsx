'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { newConfigFormSchema, type NewConfigForm } from '@/lib/schemas';
import { useToast } from '@/components/ui/toast';
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
import WorkflowModeSelector from './WorkflowModeSelector';

interface NewConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (filename: string) => void;
}

export default function NewConfigModal({
  isOpen,
  onClose,
  onSuccess,
}: NewConfigModalProps) {
  const { toast } = useToast();
  const [workflowMode, setWorkflowMode] = useState<'phase-based' | 'state-machine'>('phase-based');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<NewConfigForm>({
    resolver: zodResolver(newConfigFormSchema),
  });

  const onSubmit = async (data: NewConfigForm) => {
    try {
      const response = await fetch('/api/configs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, mode: workflowMode }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.details) {
          toast('error', '表单验证失败:\n' + result.details.map((e: any) => e.message).join('\n'));
        } else {
          toast('error', result.message || result.error);
        }
        return;
      }
      toast('success', '配置文件创建成功！');
      reset();
      onSuccess(data.filename);
      onClose();
    } catch (error: any) {
      toast('error', '创建失败: ' + error.message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl flex flex-col p-0 max-h-[90vh]">
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <DialogTitle>新建工作流配置</DialogTitle>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="new-config-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-auto px-6 space-y-6">
          {/* 工作流模式选择 */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">
              选择工作流模式 <span className="text-destructive">*</span>
            </Label>
            <WorkflowModeSelector
              value={workflowMode}
              onChange={setWorkflowMode}
              showDetails={true}
            />
          </div>

          {/* 分隔线 */}
          <div className="border-t border-gray-200 dark:border-gray-700" />

          <div className="space-y-2">
            <Label htmlFor="filename">
              文件名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="filename"
              placeholder="my-workflow.yaml"
              {...register('filename')}
              className={errors.filename ? 'border-destructive' : ''}
            />
            {errors.filename && (
              <p className="text-sm text-destructive">{errors.filename.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflowName">
              工作流名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workflowName"
              placeholder="我的工作流"
              {...register('workflowName')}
              className={errors.workflowName ? 'border-destructive' : ''}
            />
            {errors.workflowName && (
              <p className="text-sm text-destructive">{errors.workflowName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="描述这个工作流的用途..."
              {...register('description')}
            />
          </div>
        </form>

        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="new-config-form" disabled={isSubmitting}>
            {isSubmitting ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
