'use client';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  filename: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteConfirmModal({
  isOpen,
  filename,
  onClose,
  onConfirm,
}: DeleteConfirmModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="flex flex-col p-0">
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <div className="px-6">
          <AlertDialogDescription>
            确定要删除配置文件 <span className="font-semibold text-foreground">{filename}</span> 吗？此操作不可撤销。
          </AlertDialogDescription>
        </div>
        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          <AlertDialogCancel onClick={onClose}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
