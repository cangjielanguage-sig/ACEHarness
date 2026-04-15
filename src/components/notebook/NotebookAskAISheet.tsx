'use client';

import AiAssistantSheet from '@/components/chat/AiAssistantSheet';

interface MessageTask {
  id: string;
  displayText: string;
  prompt: string;
}

interface NotebookAskAISheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: string;
  autoTask?: MessageTask | null;
  onInsertResult?: (content: string) => void;
  insertButtonLabel?: string;
}

export function NotebookAskAISheet({
  open,
  onOpenChange,
  context,
  autoTask,
  onInsertResult,
  insertButtonLabel = '插入回原文',
}: NotebookAskAISheetProps) {
  return (
    <AiAssistantSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Notebook AI 助手"
      context={context}
      contextLabel="当前块上下文"
      autoTask={autoTask}
      onInsertResult={onInsertResult}
      insertButtonLabel={insertButtonLabel}
      inputPlaceholder="问点具体的，例如：这段内容如何优化？"
      sessionStorageKey="notebook-ai-session-id"
      sessionTitle="Notebook AI"
    />
  );
}

export default NotebookAskAISheet;
