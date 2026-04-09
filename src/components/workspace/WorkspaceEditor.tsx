"use client"

import * as React from "react"
import { workspaceApi, type TreeNode } from "@/lib/api"
import { X } from "lucide-react"
import { useDefaultLayout } from "react-resizable-panels"
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
import { FileTreeSidebar } from "./FileTreeSidebar"
import { EditorPanel } from "./EditorPanel"
import { FileSearchCommand } from "./FileSearchCommand"
import * as VisuallyHidden from "@radix-ui/react-visually-hidden"

interface WorkspaceEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath: string
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

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workspace-editor",
  })

  // Load file tree when drawer opens
  React.useEffect(() => {
    if (!open || !workspacePath) return
    setTreeLoading(true)
    workspaceApi
      .getTree(workspacePath)
      .then((data) => setTree(data.tree))
      .catch(() => setTree([]))
      .finally(() => setTreeLoading(false))
  }, [open, workspacePath])

  // Load file content when a file is selected
  React.useEffect(() => {
    if (!selectedFile || !workspacePath) return
    setFileLoading(true)
    setOversize(false)
    setFileBlob(null)
    setFileContent(null)

    if (isPreviewFile(selectedFile)) {
      // Binary preview files: fetch as blob
      workspaceApi
        .getFileBlob(workspacePath, selectedFile)
        .then((blob) => {
          setFileBlob(blob)
        })
        .catch(() => {
          setFileBlob(null)
        })
        .finally(() => setFileLoading(false))
    } else {
      // Text files: fetch as text
      workspaceApi
        .getFile(workspacePath, selectedFile)
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
    }
  }, [selectedFile, workspacePath])

  // Ctrl+P / Cmd+P to open file search
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
      await workspaceApi.saveFile(workspacePath, selectedFile, content)
    },
    [workspacePath, selectedFile]
  )

  const handleSelectFile = React.useCallback((filePath: string) => {
    setSelectedFile(filePath)
  }, [])

  // Reset state when drawer closes
  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedFile(null)
        setFileContent(null)
        setFileSize(null)
        setOversize(false)
        setFileBlob(null)
        setTree([])
      }
      onOpenChange(newOpen)
    },
    [onOpenChange]
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
                {workspacePath.split("/").filter(Boolean).pop() || "Workspace"}
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
              <ResizablePanel id="workspace-tree" defaultSize="20%" minSize="12%" maxSize="40%">
                <FileTreeSidebar
                  workspacePath={workspacePath}
                  tree={tree}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  loading={treeLoading}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
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
