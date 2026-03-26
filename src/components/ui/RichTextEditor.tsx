'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension } from '@tiptap/core';
import { useEffect, forwardRef, useImperativeHandle, useRef, useState } from 'react';
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
  onChange?: (html: string, text: string) => void;
  onEnter?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  showFullscreenToggle?: boolean;
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

// Simple HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let markdown = html
    // Replace bold tags
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    // Replace italic tags
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '*$1*')
    // Replace strikethrough tags
    .replace(/<s>(.*?)<\/s>/g, '~~$1~~')
    .replace(/<strike>(.*?)<\/strike>/g, '~~$1~~')
    .replace(/<del>(.*?)<\/del>/g, '~~$1~~')
    // Replace code tags (inline)
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    // Replace paragraph tags with double newline
    .replace(/<p><br\s*\/?><\/p>/g, '\n')
    .replace(/<\/p>/g, '\n\n')
    // Replace line breaks
    .replace(/<br\s*\/?>/g, '\n')
    // Replace list items
    .replace(/<ul>/g, '')
    .replace(/<\/ul>/g, '\n')
    .replace(/<ol>/g, '')
    .replace(/<\/ol>/g, '\n')
    .replace(/<li>(.*?)<\/li>/g, '- $1\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();

  return markdown;
}

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
  content = '',
  onChange,
  onEnter,
  placeholder = '输入消息...',
  maxLength = 10000,
  minHeight = 60,
  maxHeight = 120, // Default max height ~4-5 lines
  disabled = false,
  className = '',
  autoFocus = false,
  showFullscreenToggle = false,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    getMarkdown: () => {
      const html = editor?.getHTML() || '';
      return htmlToMarkdown(html);
    },
    focus: () => {
      editor?.commands.focus();
    },
    isEmpty: () => {
      if (!editor) return true;
      return editor.isEmpty;
    },
    setFullscreen: (value: boolean) => {
      setIsFullscreen(value);
      if (value) {
        setTimeout(() => editor?.commands.focus(), 100);
      }
    },
    setContent: (content: string) => {
      if (editor) {
        editor.commands.setContent(content);
      }
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

      // In fullscreen mode: Enter = newline, Shift+Enter = send
      // In normal mode: Enter = send, Shift+Enter = newline
      if (event.key === 'Enter') {
        event.preventDefault();

        if (isFullscreen) {
          // Fullscreen mode: Enter = newline, Shift+Enter = send
          if (event.shiftKey) {
            const markdown = htmlToMarkdown(editor.getHTML()).trim();
            if (markdown && onEnterRef.current) {
              onEnterRef.current(markdown);
            }
          } else {
            // Insert newline
            editor.commands.insertContent('<p><br></p>');
          }
        } else {
          // Normal mode: Enter = send, Shift+Enter = newline
          if (!event.shiftKey) {
            const markdown = htmlToMarkdown(editor.getHTML()).trim();
            if (markdown && onEnterRef.current) {
              onEnterRef.current(markdown);
            }
          } else {
            editor.commands.insertContent('<br>');
          }
        }
        return false;
      }
    };

    wrapper.addEventListener('keydown', handleKeyDown);
    return () => wrapper.removeEventListener('keydown', handleKeyDown);
  }, [editor, isFullscreen]);

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

  // Focus editor when entering fullscreen
  useEffect(() => {
    if (isFullscreen && editor) {
      setTimeout(() => editor.commands.focus(), 150);
    }
  }, [isFullscreen, editor]);

  if (!editor) {
    return null;
  }

  const charCount = editor.storage.characterCount.characters();
  const isNearLimit = charCount > maxLength * 0.9;

  // Fullscreen mode - use portal to render at body level
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
              <EditorContent editor={editor} className="outline-none h-full [&_.ProseMirror]:!outline-none [&_.ProseMirror]:!min-h-[300px] [&_.ProseMirror]:focus:!outline-none" />
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

  // Normal mode
  return (
    <div ref={editorContainerRef} className={`relative ${className}`}>
      <div
        ref={editorWrapperRef}
        className="overflow-hidden rounded-lg border border-input bg-background"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div className="px-2 py-1.5 flex items-start gap-1">
          <div className="flex-1 min-h-[32px] overflow-y-auto">
            <EditorContent
              editor={editor}
              className="outline-none [&_.ProseMirror]:!outline-none [&_.ProseMirror:focus]:!outline-none"
              style={{ maxHeight: `${maxHeight - 16}px` }}
            />
          </div>
          {showFullscreenToggle && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 shrink-0 opacity-50 hover:opacity-100"
              onClick={() => setIsFullscreen(true)}
              title="全屏编辑"
            >
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
