'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension } from '@tiptap/core';
import { useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { Button } from '@/components/ui/button';

export interface RichTextEditorHandle {
  clear: () => void;
  getText: () => string;
  getHTML: () => string;
  focus: () => void;
  isEmpty: () => boolean;
}

interface RichTextEditorProps {
  content?: string;
  onChange?: (html: string, text: string) => void;
  onEnter?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}

// Extension to make Enter submit and Shift+Enter create line breaks
const SingleLineEnter = Extension.create({
  name: 'singleLineEnter',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        // Get the callback from storage - this is a workaround since we can't pass it directly
        const textarea = document.querySelector('[data-single-line-enter]') as HTMLElement;
        if (textarea?.dataset.onEnter) {
          const text = editor.getText().trim();
          if (text) {
            try {
              const callback = JSON.parse(textarea.dataset.onEnter);
              callback(text);
            } catch {}
          }
        }
        return true; // Prevent default
      },
      'Shift-Enter': ({ editor }) => {
        editor.commands.insertContent('<br>');
        return true;
      },
    };
  },
});

const MenuBar = ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 pb-1 border-b mb-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="粗体 (Ctrl+B)"
      >
        <span className={`text-xs font-bold ${editor.isActive('bold') ? 'text-primary' : ''}`}>B</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="斜体 (Ctrl+I)"
      >
        <span className={`text-xs italic ${editor.isActive('italic') ? 'text-primary' : ''}`}>I</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="删除线"
      >
        <span className={`text-xs ${editor.isActive('strike') ? 'text-primary' : ''}`} style={{ textDecoration: 'line-through' }}>S</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="行内代码"
      >
        <span className={`text-xs font-mono ${editor.isActive('code') ? 'text-primary' : ''}`}>`</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="无序列表"
      >
        <span className="material-symbols-outlined text-sm">format_list_bulleted</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="有序列表"
      >
        <span className="material-symbols-outlined text-sm">format_list_numbered</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().undo().run()}
        title="撤销 (Ctrl+Z)"
      >
        <span className="material-symbols-outlined text-sm">undo</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => editor.chain().focus().redo().run()}
        title="重做 (Ctrl+Shift+Z)"
      >
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
  maxHeight = 300,
  disabled = false,
  className = '',
  autoFocus = false,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount.configure({
        limit: maxLength,
      }),
      Typography,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content,
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'outline-none prose prose-sm max-w-none',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();
      onChange?.(html, text);
    },
  });

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    clear: () => {
      editor?.commands.clearContent();
    },
    getText: () => editor?.getText() || '',
    getHTML: () => editor?.getHTML() || '',
    focus: () => {
      editor?.commands.focus();
    },
    isEmpty: () => {
      if (!editor) return true;
      return editor.isEmpty;
    },
  }), [editor]);

  const editorWrapperRef = useRef<HTMLDivElement>(null);

  // Handle keyboard shortcuts for Enter
  useEffect(() => {
    if (!editor || !editorWrapperRef.current) return;

    const wrapper = editorWrapperRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if IME is composing (Chinese/Japanese input method)
      if (event.isComposing) return;

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const text = editor.getText().trim();
        if (text && onEnterRef.current) {
          onEnterRef.current(text);
        }
        return false;
      }

      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        editor.commands.insertContent('<br>');
        return false;
      }
    };

    wrapper.addEventListener('keydown', handleKeyDown);
    return () => wrapper.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  // Auto-focus
  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus();
    }
  }, [autoFocus, editor]);

  if (!editor) {
    return null;
  }

  const charCount = editor.storage.characterCount.characters();
  const isNearLimit = charCount > maxLength * 0.9;

  return (
    <div ref={editorContainerRef} className={`relative ${className}`}>
      <div
        ref={editorWrapperRef}
        className="overflow-hidden rounded-xl border border-input bg-background"
        data-single-line-enter="true"
        data-on-enter={onEnter ? JSON.stringify(onEnter) : undefined}
      >
        <div className="px-3 py-2">
          <EditorContent
            editor={editor}
            className="outline-none min-h-[42px]"
          />
        </div>
      </div>
      {/* Character count */}
      {maxLength < 50000 && (
        <div className={`absolute bottom-2 right-2 text-[10px] ${isNearLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
          {charCount}/{maxLength}
        </div>
      )}
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
