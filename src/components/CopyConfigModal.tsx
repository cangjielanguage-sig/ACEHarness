'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { copyConfigFormSchema, type CopyConfigForm } from '@/lib/schemas';
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
import { Label } from '@/components/ui/label';

interface CopyConfigModalProps {
  isOpen: boolean;
  sourceFilename: string;
  onClose: () => void;
  onSuccess: (newFilename: string) => void;
}

export default function CopyConfigModal({
  isOpen,
  sourceFilename,
  onClose,
  onSuccess,
}: CopyConfigModalProps) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CopyConfigForm>({
    resolver: zodResolver(copyConfigFormSchema),
  });

  const onSubmit = async (data: CopyConfigForm) => {
    try {
      const response = await fetch(`/api/configs/${sourceFilename}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newFilename: data.newFilename }),
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
      toast('success', '配置文件复制成功！');
      reset();
      onSuccess(data.newFilename);
      onClose();
    } catch (error: any) {
      toast('error', '复制失败: ' + error.message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>复制配置</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newFilename">
              新文件名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="newFilename"
              placeholder="my-workflow-copy.yaml"
              {...register('newFilename')}
              className={errors.newFilename ? 'border-destructive' : ''}
            />
            {errors.newFilename && (
              <p className="text-sm text-destructive">{errors.newFilename.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '复制中...' : '复制'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
