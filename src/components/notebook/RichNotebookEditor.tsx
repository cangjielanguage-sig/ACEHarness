'use client';

import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TrailingNode } from '@tiptap/extensions/trailing-node';
import { UndoRedo } from '@tiptap/extensions/undo-redo';
import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Markdown } from '@tiptap/markdown';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import sql from 'highlight.js/lib/languages/sql';
import cangjie from '@/lib/cangjie-highlight';
import { NotebookCodeBlock, NotebookOutputBlock } from './NotebookBlocks';
import { NotebookOutput, buildNotebookOutput, createNotebookCellId, createNotebookOutputId, normalizeNotebookLanguage } from '@/lib/notebook-markdown';

const lowlight = createLowlight();

lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('json', json);
lowlight.register('html', xml);
lowlight.register('xml', xml);
lowlight.register('bash', bash);
lowlight.register('shell', bash);
lowlight.register('yaml', yaml);
lowlight.register('yml', yaml);
lowlight.register('markdown', markdown);
lowlight.register('md', markdown);
lowlight.register('python', python);
lowlight.register('py', python);
lowlight.register('java', java);
lowlight.register('cpp', cpp);
lowlight.register('c', cpp);
lowlight.register('sql', sql);
lowlight.register('cangjie', cangjie as any);
lowlight.register('cj', cangjie as any);

function updateOrInsertOutput(editor: Editor, pos: number, cellId: string, output: string) {
  const { state } = editor;
  const targetNode = state.doc.nodeAt(pos);
  if (!targetNode) return;

  const currentOutputNode = state.doc.nodeAt(pos + targetNode.nodeSize);
  const outputNode = buildNotebookOutput({
    cellId,
    outputId: currentOutputNode?.type.name === 'notebookOutput' ? String(currentOutputNode.attrs.outputId || createNotebookOutputId()) : createNotebookOutputId(),
    output,
  });

  if (currentOutputNode?.type.name === 'notebookOutput' && currentOutputNode.attrs.cellId === cellId) {
    editor.chain().focus().deleteRange({ from: pos + targetNode.nodeSize, to: pos + targetNode.nodeSize + currentOutputNode.nodeSize }).insertContentAt(pos + targetNode.nodeSize, outputNode).run();
    return;
  }

  editor.chain().focus().insertContentAt(pos + targetNode.nodeSize, outputNode).run();
}

const NotebookCodeBlockExtension = CodeBlockLowlight.extend({
  name: 'notebookCodeBlock',

  addAttributes() {
    return {
      ...this.parent?.(),
      cellId: {
        default: null,
        rendered: false,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => <NotebookCodeBlock {...props} filePath={(props.extension.options as any).filePath} onRunCell={async (payload) => {
      const output = await (props.extension.options as any).onRunCell(payload);
      if (output != null) {
        updateOrInsertOutput(props.editor, payload.pos, payload.cellId, output);
      }
    }} />);
  },

  parseMarkdown: (token, helpers) => {
    if (token.raw?.startsWith('```') === false && token.raw?.startsWith('~~~') === false && token.codeBlockStyle !== 'indented') {
      return [];
    }
    return helpers.createNode('notebookCodeBlock', {
      language: normalizeNotebookLanguage(token.lang || null),
      cellId: createNotebookCellId(),
    }, token.text ? [helpers.createTextNode(token.text)] : []);
  },

  renderMarkdown: (node, h) => {
    const language = node.attrs?.language || '';
    const body = node.content ? h.renderChildren(node.content) : '';
    return `\`\`\`${language}\n${body}\n\`\`\``;
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-cell-id': node.attrs.cellId || '' }),
      ['code', { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null }, 0],
    ];
  },
});

interface RichNotebookEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
  onRunCell: (payload: { pos: number; cellId: string; language: string; code: string }) => Promise<string | null>;
}

export function RichNotebookEditor({ content, filePath, onChange, onRunCell }: RichNotebookEditorProps) {
  const changeSourceRef = useRef<'internal' | 'external'>('external');
  const notebookExtensions = useMemo(() => [
    StarterKit.configure({
      codeBlock: false,
      undoRedo: false,
    }),
    Markdown,
    UndoRedo.configure({ depth: 100, newGroupDelay: 500 }),
    Placeholder.configure({ placeholder: '开始编写 Cangjie Notebook...' }),
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    TrailingNode.configure({ node: 'paragraph', notAfter: ['paragraph'] }),
    NotebookCodeBlockExtension.configure({
      lowlight,
      enableTabIndentation: true,
      tabSize: 2,
      languageClassPrefix: 'language-',
      defaultLanguage: 'text',
      HTMLAttributes: { class: 'hljs' },
      filePath,
      onRunCell,
    } as any),
    NotebookOutput.extend({
      addNodeView() {
        return ReactNodeViewRenderer(NotebookOutputBlock);
      },
    }),
    Node.create({
      name: 'notebookKeymap',
      addKeyboardShortcuts() {
        return {
          Enter: ({ editor }) => {
            const { $from } = editor.state.selection;
            if ($from.parent.type.name === 'notebookOutput') {
              return false;
            }
            return false;
          },
        };
      },
    }),
  ], [filePath, onRunCell]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: notebookExtensions,
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'tiptap prose prose-invert max-w-none min-h-full px-6 py-5 focus:outline-none [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_hr]:my-4 [&_hr]:border-border',
      },
    },
    onCreate: ({ editor }) => {
      if (content) {
        editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
      }
    },
    onUpdate: ({ editor }) => {
      changeSourceRef.current = 'internal';
      onChange(editor.getMarkdown());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (changeSourceRef.current === 'internal') {
      changeSourceRef.current = 'external';
      return;
    }
    if (content === editor.getMarkdown()) return;
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    const { tr, doc } = editor.state;
    let changed = false;
    doc.descendants((node, pos) => {
      if (node.type.name === 'notebookCodeBlock' && !node.attrs.cellId) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          cellId: createNotebookCellId(),
        });
        changed = true;
      }
      return true;
    });
    if (changed) {
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, Math.min(tr.doc.content.size, editor.state.selection.from))));
    }
  }, [editor, content]);

  if (!editor) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">加载 Notebook 编辑器...</div>;
  }

  return (
    <div className="h-full [&_.tiptap_p]:my-3 [&_.tiptap_code]:font-mono">
      <EditorContent editor={editor} className="h-full" />
      <style jsx global>{`
        .hljs { display: block; color: #e5e7eb; background: transparent; }
        .ProseMirror .hljs { white-space: pre; }
        .ProseMirror pre code { caret-color: white; }
        .hljs-comment,
        .hljs-quote { color: #5c6370; font-style: italic; }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-literal,
        .hljs-section,
        .hljs-link { color: #c678dd; }
        .hljs-string,
        .hljs-title,
        .hljs-name,
        .hljs-type,
        .hljs-attribute,
        .hljs-symbol,
        .hljs-bullet,
        .hljs-addition { color: #98c379; }
        .hljs-number,
        .hljs-built_in,
        .hljs-builtin-name,
        .hljs-meta,
        .hljs-variable,
        .hljs-template-variable { color: #d19a66; }
        .hljs-attr,
        .hljs-operator,
        .hljs-punctuation,
        .hljs-subst { color: #56b6c2; }
        .hljs-function .hljs-title,
        .hljs-title.function_ { color: #61afef; }
      `}</style>
    </div>
  );
}
