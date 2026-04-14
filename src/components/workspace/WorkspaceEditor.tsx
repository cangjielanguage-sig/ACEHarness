"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { workspaceApi, type NotebookScope, type TreeNode, type WorkspaceMode } from "@/lib/api"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { useDefaultLayout, usePanelRef } from "react-resizable-panels"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { FileTreeSidebar, type ClipboardItem } from "./FileTreeSidebar"
import { EditorPanel } from "./EditorPanel"
import { FileSearchCommand } from "./FileSearchCommand"
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"
import { useDocumentTitle } from "@/hooks/useDocumentTitle"

interface WorkspaceEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath: string
  mode?: WorkspaceMode
  title?: string
  notebookScope?: NotebookScope
  notebookShareToken?: string
  notebookPermission?: 'read' | 'write'
}

const PREVIEW_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx",
  "png", "jpg", "jpeg", "gif",
  "mp4", "webm", "mp3",
])

function isPreviewFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  return PREVIEW_EXTENSIONS.has(ext)
}

function getFileType(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() || ""
}

export function WorkspaceEditor({
  open,
  onOpenChange,
  workspacePath,
  mode = "default",
  title,
  notebookScope = 'personal',
  notebookShareToken,
  notebookPermission = 'write',
}: WorkspaceEditorProps) {
  const [tree, setTree] = React.useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = React.useState(false)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [fileContent, setFileContent] = React.useState<string | null>(null)
  const [fileSize, setFileSize] = React.useState<number | null>(null)
  const [fileLoading, setFileLoading] = React.useState(false)
  const [oversize, setOversize] = React.useState(false)
  const [fileBlob, setFileBlob] = React.useState<Blob | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [treeCollapsed, setTreeCollapsed] = React.useState(false)
  const [clipboard, setClipboard] = React.useState<ClipboardItem | null>(null)
  const treePanelRef = usePanelRef()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const fileParamKey = mode === "notebook" ? "notebookFile" : "workspaceFile"
  const panelParamKey = mode === "notebook" ? "notebook" : "workspace"
  const scopeParamKey = mode === "notebook" ? "notebookScope" : "workspaceScope"

  const baseTitle = React.useMemo(() => {
    if (title?.trim()) return title.trim()
    if (mode === "notebook") return "Cangjie Notebook"
    return workspacePath.split("/").filter(Boolean).pop() || "Workspace"
  }, [mode, title, workspacePath])

  const currentTitle = React.useMemo(() => {
    if (!open) return null
    if (!selectedFile) return baseTitle
    const fileName = selectedFile.split("/").pop() || selectedFile
    return `${fileName} · ${baseTitle}`
  }, [baseTitle, open, selectedFile])

  useDocumentTitle(currentTitle)

  const toggleTree = React.useCallback(() => {
    const panel = treePanelRef.current
    if (!panel) return
    panel.isCollapsed() ? panel.expand() : panel.collapse()
  }, [treePanelRef])

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workspace-editor",
  })

  const updateUrlFileState = React.useCallback((filePath: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (filePath) {
      params.set(fileParamKey, filePath)
      params.set(panelParamKey, "1")
      if (mode === 'notebook') params.set(scopeParamKey, notebookScope)
    } else {
      params.delete(fileParamKey)
      params.delete(panelParamKey)
      if (mode === 'notebook') params.delete(scopeParamKey)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [fileParamKey, mode, notebookScope, panelParamKey, pathname, router, scopeParamKey, searchParams])

  React.useEffect(() => {
    if (!open || !workspacePath) return
    setTreeLoading(true)
    const loadTree = mode === "notebook"
      ? workspaceApi.getNotebookTree(2, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getTree(workspacePath)
    loadTree
      .then((data) => setTree(data.tree))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false))
  }, [mode, notebookScope, notebookShareToken, open, workspacePath])

  React.useEffect(() => {
    if (!open) return
    const fileFromUrl = searchParams.get(fileParamKey)
    if (fileFromUrl) {
      setSelectedFile(fileFromUrl)
    }
  }, [fileParamKey, open, searchParams])

  React.useEffect(() => {
    if (!selectedFile || !workspacePath) return
    setFileLoading(true)
    setOversize(false)
    setFileBlob(null)
    setFileContent(null)

    if (isPreviewFile(selectedFile)) {
      const loadBlob = mode === "notebook"
        ? workspaceApi.getNotebookFileBlob(selectedFile, { scope: notebookScope, shareToken: notebookShareToken })
        : workspaceApi.getFileBlob(workspacePath, selectedFile)
      loadBlob
        .then((blob) => {
          setFileBlob(blob)
        })
        .catch(() => {
          setFileBlob(null)
        })
        .finally(() => setFileLoading(false))
      return
    }

    const loadFile = mode === "notebook"
      ? workspaceApi.getNotebookFile(selectedFile, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getFile(workspacePath, selectedFile)
    loadFile
      .then((data) => {
        setFileContent(data.content)
        setFileSize(data.size)
      })
      .catch((err: Error & { size?: number }) => {
        if (err.message?.includes("KB 限制")) {
          setOversize(true)
          if (err.size != null) setFileSize(err.size)
        }
      })
      .finally(() => setFileLoading(false))
  }, [mode, notebookScope, notebookShareToken, selectedFile, workspacePath])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  const handleSave = React.useCallback(
    async (content: string) => {
      if (!selectedFile) return
      if (mode === "notebook") {
        if (notebookPermission === 'read') {
          throw new Error('当前分享链接为只读权限，无法保存')
        }
        await workspaceApi.saveNotebookFile(selectedFile, content, { scope: notebookScope, shareToken: notebookShareToken })
        return
      }
      await workspaceApi.saveFile(workspacePath, selectedFile, content)
    },
    [mode, notebookPermission, notebookScope, notebookShareToken, selectedFile, workspacePath]
  )

  const handleSelectFile = React.useCallback((filePath: string) => {
    setSelectedFile(filePath)
    updateUrlFileState(filePath)
  }, [updateUrlFileState])

  const handleDeletedPath = React.useCallback((deletedPath: string) => {
    if (!selectedFile) return
    const affected = selectedFile === deletedPath || selectedFile.startsWith(`${deletedPath}/`)
    if (!affected) return
    setSelectedFile(null)
    setFileContent(null)
    setFileSize(null)
    setOversize(false)
    setFileBlob(null)
    updateUrlFileState(null)
  }, [selectedFile, updateUrlFileState])

  const handleTreeRefresh = React.useCallback(() => {
    if (!workspacePath) return
    setTreeLoading(true)
    const loadTree = mode === "notebook"
      ? workspaceApi.getNotebookTree(2, { scope: notebookScope, shareToken: notebookShareToken })
      : workspaceApi.getTree(workspacePath)
    loadTree
      .then((data) => setTree(data.tree))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false))
  }, [mode, notebookScope, notebookShareToken, workspacePath])

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedFile(null)
        setFileContent(null)
        setFileSize(null)
        setOversize(false)
        setFileBlob(null)
        setTree([])
        updateUrlFileState(null)
      }
      onOpenChange(newOpen)
    },
    [onOpenChange, updateUrlFileState]
  )

  return (
    <>
      <Drawer direction="bottom" open={open} onOpenChange={handleOpenChange} dismissible={false}>
        <DrawerContent className="h-screen w-screen max-w-none rounded-none mt-0 after:hidden">
          <VisuallyHidden.Root>
            <DrawerTitle>工作区编辑器</DrawerTitle>
          </VisuallyHidden.Root>
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0">
              <span className="text-sm text-muted-foreground truncate flex-1 px-2">
                {baseTitle}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleOpenChange(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </Button>
            </div>
            <ResizablePanelGroup id="workspace-editor" orientation="horizontal" className="flex-1 min-h-0" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
              <ResizablePanel
                id="workspace-tree"
                panelRef={treePanelRef}
                defaultSize="20%"
                minSize="12%"
                maxSize="40%"
                collapsible
                collapsedSize="0%"
                onResize={() => setTreeCollapsed(treePanelRef.current?.isCollapsed() ?? false)}
              >
                <FileTreeSidebar
                  workspacePath={workspacePath}
                  tree={tree}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  onDeletedPath={handleDeletedPath}
                  loading={treeLoading}
                  clipboard={clipboard}
                  setClipboard={setClipboard}
                  onRefresh={handleTreeRefresh}
                  mode={mode}
                  notebookScope={notebookScope}
                  notebookShareToken={notebookShareToken}
                  notebookPermission={notebookPermission}
                />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                collapsed={treeCollapsed}
                onClickHandle={toggleTree}
                handleIcon={treeCollapsed
                  ? <ChevronRight className="h-2.5 w-2.5" />
                  : <ChevronLeft className="h-2.5 w-2.5" />
                }
              />
              <ResizablePanel id="workspace-editor-panel" defaultSize="80%" minSize="40%">
                <EditorPanel
                  filePath={selectedFile}
                  content={fileContent}
                  fileSize={fileSize}
                  loading={fileLoading}
                  onSave={handleSave}
                  oversize={oversize}
                  fileBlob={fileBlob}
                  fileType={selectedFile ? getFileType(selectedFile) : undefined}
                  mode={mode}
                  notebookScope={notebookScope}
                  notebookShareToken={notebookShareToken}
                  notebookPermission={notebookPermission}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </DrawerContent>
      </Drawer>

      <FileSearchCommand
        open={searchOpen}
        onOpenChange={setSearchOpen}
        tree={tree}
        onSelectFile={handleSelectFile}
      />
    </>
  )
}
