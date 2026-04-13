'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { ListKit } from '@tiptap/extension-list';
import Typography from '@tiptap/extension-typography';
import { Markdown } from '@tiptap/markdown';
import { Extension } from '@tiptap/core';
import { useEffect, forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { createPortal } from 'react-dom';

export interface RichTextEditorHandle {
  clear: () => void;
  getText: () => string;
  getHTML: () => string;
  getMarkdown: () => string;
  focus: () => void;
  isEmpty: () => boolean;
  setFullscreen: (value: boolean) => void;
  setContent: (content: string) => void;
}

interface RichTextEditorProps {
  content?: string;
  onChange?: (markdown: string, text: string) => void;
  onEnter?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  showFullscreenToggle?: boolean;
  showToolbar?: boolean;
}

const SingleLineEnter = Extension.create({
  name: 'singleLineEnter',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const textarea = document.querySelector('[data-single-line-enter]') as HTMLElement;
        if (textarea?.dataset.onEnter) {
          const text = editor.getMarkdown().trim();
          if (text) {
            try {
              const callback = JSON.parse(textarea.dataset.onEnter);
              callback(text);
            } catch {}
          }
        }
        return true;
      },
      'Shift-Enter': ({ editor }) => {
        editor.commands.insertContent('\n', { contentType: 'markdown' });
        return true;
      },
    };
  },
});

const MenuBar = ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 pb-1 border-b mb-1 flex-wrap">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBold().run()} title="粗体 (Ctrl+B)">
        <span className={`text-xs font-bold ${editor.isActive('bold') ? 'text-primary' : ''}`}>B</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体 (Ctrl+I)">
        <span className={`text-xs italic ${editor.isActive('italic') ? 'text-primary' : ''}`}>I</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleStrike().run()} title="删除线">
        <span className={`text-xs ${editor.isActive('strike') ? 'text-primary' : ''}`} style={{ textDecoration: 'line-through' }}>S</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码">
        <span className={`text-xs font-mono ${editor.isActive('code') ? 'text-primary' : ''}`}>`</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="一级标题">
        <span className={`text-[11px] font-semibold ${editor.isActive('heading', { level: 1 }) ? 'text-primary' : ''}`}>H1</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="二级标题">
        <span className={`text-[11px] font-semibold ${editor.isActive('heading', { level: 2 }) ? 'text-primary' : ''}`}>H2</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用">
        <span className={`material-symbols-outlined text-sm ${editor.isActive('blockquote') ? 'text-primary' : ''}`}>format_quote</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分隔线">
        <span className="material-symbols-outlined text-sm">horizontal_rule</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表">
        <span className="material-symbols-outlined text-sm">format_list_bulleted</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表">
        <span className="material-symbols-outlined text-sm">format_list_numbered</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().toggleTaskList().run()} title="任务列表">
        <span className={`material-symbols-outlined text-sm ${editor.isActive('taskList') ? 'text-primary' : ''}`}>checklist</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().undo().run()} title="撤销 (Ctrl+Z)">
        <span className="material-symbols-outlined text-sm">undo</span>
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => editor.chain().focus().redo().run()} title="重做 (Ctrl+Shift+Z)">
        <span className="material-symbols-outlined text-sm">redo</span>
      </Button>
    </div>
  );
};

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
  content = '',
  onChange,
  onEnter,
  placeholder = '输入消息...',
  maxLength = 10000,
  minHeight = 60,
  maxHeight = 120,
  disabled = false,
  className = '',
  autoFocus = false,
  showFullscreenToggle = false,
  showToolbar = false,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const [isFullscreen, setIsFullscreen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Markdown,
      Typography,
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount.configure({
        limit: maxLength,
      }),
      ListKit.configure({
        taskItem: { nested: true },
      }),
    ],
    content,
    contentType: 'markdown',
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'outline-none prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      const text = editor.getText();
      onChange?.(markdown, text);
    },
  });

  const safeFocus = useCallback((delayMs = 0) => {
    if (!editor) return;
    const run = () => {
      if (!editor || (editor as any).isDestroyed) return;
      try {
        // Prefer native view focus to avoid dispatching a transaction in unstable windows.
        editor.view?.focus();
      } catch {
        try {
          editor.commands.focus();
        } catch {
          // no-op: avoid crashing caller effects
        }
      }
    };

    const schedule = () => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 0);
      }
    };

    if (delayMs > 0) {
      setTimeout(schedule, delayMs);
    } else {
      schedule();
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    clear: () => {
      editor?.commands.clearContent();
    },
    getText: () => editor?.getText() || '',
    getHTML: () => editor?.getHTML() || '',
    getMarkdown: () => editor?.getMarkdown() || '',
    focus: () => {
      safeFocus();
    },
    isEmpty: () => {
      if (!editor) return true;
      return editor.isEmpty;
    },
    setFullscreen: (value: boolean) => {
      setIsFullscreen(value);
      if (value) {
        safeFocus(100);
      }
    },
    setContent: (content: string) => {
      if (editor) {
        editor.commands.setContent(content, { contentType: 'markdown' });
      }
    },
  }), [editor, safeFocus]);

  const editorWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor || !editorWrapperRef.current) return;

    const wrapper = editorWrapperRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();

        if (isFullscreen) {
          if (event.shiftKey) {
            const markdown = editor.getMarkdown().trim();
            if (markdown && onEnterRef.current) {
              onEnterRef.current(markdown);
            }
          } else {
            editor.commands.insertContent('\n', { contentType: 'markdown' });
          }
        } else {
          if (!event.shiftKey) {
            const markdown = editor.getMarkdown().trim();
            if (markdown && onEnterRef.current) {
              onEnterRef.current(markdown);
            }
          } else {
            editor.commands.insertContent('\n', { contentType: 'markdown' });
          }
        }
        return false;
      }
    };

    wrapper.addEventListener('keydown', handleKeyDown);
    return () => wrapper.removeEventListener('keydown', handleKeyDown);
  }, [editor, isFullscreen]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    if (content === editor.getMarkdown()) return;
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    if (autoFocus && editor) {
      safeFocus();
    }
  }, [autoFocus, editor, safeFocus]);

  useEffect(() => {
    if (isFullscreen && editor) {
      safeFocus(150);
    }
  }, [isFullscreen, editor, safeFocus]);

  if (!editor) {
    return null;
  }

  const charCount = editor.storage.characterCount.characters();
  const isNearLimit = charCount > maxLength * 0.9;

  if (isFullscreen) {
    const fullscreenContent = (
      <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
        <div className="flex-1 flex flex-col p-4 md:p-6">
          <div className="flex-1 flex flex-col rounded-xl md:rounded-2xl border border-input bg-background overflow-hidden shadow-2xl">
            <div className="px-4 md:px-6 py-3 md:py-4 border-b bg-muted/50 flex items-center justify-between">
              <span className="font-medium">全屏编辑</span>
              <div className="flex items-center gap-3 md:gap-4">
                <span className="text-xs md:text-sm text-muted-foreground hidden sm:block">Enter 换行 · Shift+Enter 发送</span>
                <Button size="sm" variant="outline" onClick={() => setIsFullscreen(false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>close_fullscreen</span>
                  <span className="hidden sm:inline">退出全屏</span>
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4 md:p-6">
              {showToolbar && <MenuBar editor={editor} />}
              <EditorContent editor={editor} className="outline-none h-full [&_.ProseMirror]:!outline-none [&_.ProseMirror]:!min-h-[300px] [&_.ProseMirror]:focus:!outline-none [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-3 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-primary/50 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-border" />
            </div>
          </div>
        </div>
      </div>
    );
    if (typeof document !== 'undefined') {
      return createPortal(fullscreenContent, document.body);
    }
    return null;
  }

  return (
    <div ref={editorContainerRef} className={`relative ${className}`}>
      <div ref={editorWrapperRef} className="overflow-hidden rounded-lg border border-input bg-background" style={{ maxHeight: `${maxHeight}px`, minHeight: `${minHeight}px` }}>
        <div className="px-2 py-1.5 flex items-start gap-1">
          <div className="flex-1 min-h-[32px] overflow-y-auto">
            {showToolbar && <MenuBar editor={editor} />}
            <EditorContent editor={editor} className="outline-none [&_.ProseMirror]:!outline-none [&_.ProseMirror:focus]:!outline-none [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-2 [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-primary/50 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_hr]:my-3 [&_.ProseMirror_hr]:border-border" style={{ maxHeight: `${maxHeight - 16}px` }} />
          </div>
          {showFullscreenToggle && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 opacity-50 hover:opacity-100" onClick={() => setIsFullscreen(true)} title="全屏编辑">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>open_in_full</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end mt-0.5 px-1">
        {maxLength < 50000 && (
          <span className={`text-[10px] ${isNearLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
            {charCount}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
