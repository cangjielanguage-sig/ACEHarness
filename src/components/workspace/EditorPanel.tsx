"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Loader2, FileCode2 } from "lucide-react"
import { registerCangjieLanguage } from "@/lib/cangjie-language"
import { registerCMakeLanguage } from "@/lib/cmake-language"
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  MenubarCheckboxItem,
} from "@/components/ui/menubar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const MonacoEditor = dynamic(
  async () => {
    const monaco = await import("monaco-editor")
    const { loader, default: Editor } = await import("@monaco-editor/react")
    loader.config({ monaco })
    return Editor
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

const FileViewer = dynamic(
  () => import("react-file-viewer-v2").then((mod) => mod.FileViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

const PREVIEW_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif",
  "mp4", "webm", "mp3",
])

interface EditorPanelProps {
  filePath: string | null
  content: string | null
  fileSize: number | null
  loading: boolean
  onSave: (content: string) => Promise<void>
  oversize?: boolean
  fileBlob?: Blob | null
  fileType?: string
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", less: "less",
  html: "html", xml: "xml", yaml: "yaml", yml: "yaml",
  py: "python", rs: "rust", go: "go", java: "java",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", graphql: "graphql", toml: "ini", env: "ini",
  c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp", hxx: "cpp",
  cmake: "cmake",
  cj: "cangjie",
}

function getLanguage(filePath: string): string {
  const name = filePath.split("/").pop() || ""
  if (name === "CMakeLists.txt") return "cmake"
  if (name === "Makefile" || name === "makefile") return "shell"
  // Handle compound extensions like .cj.d
  if (name.endsWith(".cj.d") || name.endsWith(".cj")) return "cangjie"
  const ext = name.split(".").pop()?.toLowerCase() || ""
  return EXT_LANG_MAP[ext] || "plaintext"
}

export function EditorPanel({
  filePath,
  content,
  fileSize,
  loading,
  onSave,
  oversize,
  fileBlob,
  fileType,
}: EditorPanelProps) {
  const { resolvedTheme } = useTheme()
  const editorRef = React.useRef<any>(null)
  const [wordWrap, setWordWrap] = React.useState<"on" | "off">("off")
  const [saving, setSaving] = React.useState(false)
  const [editorContent, setEditorContent] = React.useState<string | null>(null)
  const cangjieRegistered = React.useRef(false)
  const cmakeRegistered = React.useRef(false)

  React.useEffect(() => {
    setEditorContent(content)
  }, [content])

  const handleSave = React.useCallback(async () => {
    if (!editorContent || saving) return
    setSaving(true)
    try {
      await onSave(editorContent)
    } finally {
      setSaving(false)
    }
  }, [editorContent, onSave, saving])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  const handleUndo = () => {
    editorRef.current?.trigger("keyboard", "undo", null)
  }
  const handleRedo = () => {
    editorRef.current?.trigger("keyboard", "redo", null)
  }

  const pathSegments = filePath?.split("/").filter(Boolean) || []

  return (
    <div className="flex flex-col h-full w-full">
      {/* Menubar */}
      <Menubar className="rounded-none border-x-0 border-t-0 shrink-0">
        <MenubarMenu>
          <MenubarTrigger>文件</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={handleSave} disabled={!filePath || oversize || saving}>
              {saving ? "保存中..." : "保存"}
              <MenubarShortcut>⌘S</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>编辑</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={handleUndo} disabled={!filePath}>
              撤销
              <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onClick={handleRedo} disabled={!filePath}>
              重做
              <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>视图</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem
              checked={wordWrap === "on"}
              onCheckedChange={(checked) => setWordWrap(checked ? "on" : "off")}
            >
              自动换行
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/* Breadcrumb */}
      {filePath && (
        <div className="px-3 py-1.5 border-b bg-muted/30 shrink-0">
          <Breadcrumb>
            <BreadcrumbList>
              {pathSegments.map((segment, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {i === pathSegments.length - 1 ? (
                      <BreadcrumbPage>{segment}</BreadcrumbPage>
                    ) : (
                      <span className="text-muted-foreground">{segment}</span>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !filePath ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <FileCode2 className="h-12 w-12" />
            <p className="text-sm">选择一个文件开始编辑</p>
            <p className="text-xs">使用 ⌘P 快速搜索文件</p>
          </div>
        ) : oversize ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <FileCode2 className="h-12 w-12" />
            <p className="text-sm">文件过大（{fileSize ? (fileSize >= 1024 * 1024 ? `${(fileSize / 1024 / 1024).toFixed(1)}MB` : `${(fileSize / 1024).toFixed(1)}KB`) : ""}），仅支持预览和编辑 200KB 以下的文件</p>
          </div>
        ) : fileBlob && fileType && PREVIEW_EXTENSIONS.has(fileType) ? (
          <div className="h-full overflow-auto">
            <FileViewer file={fileBlob} fileType={fileType} />
          </div>
        ) : (
          <MonacoEditor
            height="100%"
            language={getLanguage(filePath)}
            theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
            value={editorContent ?? ""}
            onChange={(value) => setEditorContent(value ?? "")}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              if (!cangjieRegistered.current) {
                registerCangjieLanguage(monaco)
                cangjieRegistered.current = true
              }
              if (!cmakeRegistered.current) {
                registerCMakeLanguage(monaco)
                cmakeRegistered.current = true
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              wordWrap,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              padding: { top: 8 },
            }}
          />
        )}
      </div>
    </div>
  )
}
