"use client"

import * as React from "react"
import { File, Folder, FolderOpen, ChevronRight, Loader2, FilePlus, FolderPlus, Pencil, Copy, Scissors, Clipboard, Trash2 } from "lucide-react"
import { workspaceApi, type TreeNode } from "@/lib/api"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

export interface ClipboardItem {
  path: string
  type: "file" | "directory"
  action: "copy" | "cut"
}

interface FileTreeSidebarProps {
  workspacePath: string
  tree: TreeNode[]
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  loading: boolean
  clipboard: ClipboardItem | null
  setClipboard: (item: ClipboardItem | null) => void
  onRefresh: () => void
}

// Inline rename input
function InlineRenameInput({
  defaultValue,
  onConfirm,
  onCancel,
}: {
  defaultValue: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(defaultValue)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter" && value.trim()) onConfirm(value.trim())
        if (e.key === "Escape") onCancel()
      }}
      onBlur={() => onCancel()}
      className="text-sm bg-background border rounded px-1 py-0.5 w-full outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

// Shared context for file operations
const TreeContext = React.createContext<{
  workspacePath: string
  clipboard: ClipboardItem | null
  setClipboard: (item: ClipboardItem | null) => void
  onRefresh: () => void
  renamingPath: string | null
  setRenamingPath: (p: string | null) => void
  creatingIn: { dir: string; type: "file" | "folder" } | null
  setCreatingIn: (c: { dir: string; type: "file" | "folder" } | null) => void
  onSelectFile: (filePath: string) => void
  contextTarget: string | null
  setContextTarget: (p: string | null) => void
} | null>(null)

function useTreeCtx() {
  const ctx = React.useContext(TreeContext)
  if (!ctx) throw new Error("TreeContext missing")
  return ctx
}

function getParentDir(filePath: string): string {
  const parts = filePath.split("/")
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
}

/* --- TreeFileItem --- */
function TreeFileItem({
  node, selectedFile, depth,
}: {
  node: TreeNode; selectedFile: string | null; depth: number
}) {
  const { workspacePath, clipboard, setClipboard, onRefresh, renamingPath, setRenamingPath, onSelectFile, contextTarget, setContextTarget } = useTreeCtx()

  const handleRename = async (newName: string) => {
    const parent = getParentDir(node.path)
    const newPath = parent ? `${parent}/${newName}` : newName
    try {
      await workspaceApi.manage(workspacePath, "rename", { oldPath: node.path, newPath })
      onRefresh()
    } catch {}
    setRenamingPath(null)
  }

  const handleDelete = async () => {
    try {
      await workspaceApi.manage(workspacePath, "delete", { path: node.path })
      onRefresh()
    } catch {}
  }

  if (renamingPath === node.path) {
    return (
      <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="px-2 py-0.5">
        <InlineRenameInput defaultValue={node.name} onConfirm={handleRename} onCancel={() => setRenamingPath(null)} />
      </div>
    )
  }

  const isContextActive = contextTarget === node.path

  return (
    <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
      <ContextMenuTrigger asChild>
        <button
          onClick={() => onSelectFile(node.path)}
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm",
            "hover:bg-accent hover:text-accent-foreground",
            selectedFile === node.path && "bg-accent text-accent-foreground font-medium",
            isContextActive && "bg-accent/70 ring-1 ring-primary/40"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>
        <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>
        <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "file", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* --- TreeDirItem --- */
function TreeDirItem({
  node, selectedFile, depth,
}: {
  node: TreeNode; selectedFile: string | null; depth: number
}) {
  const { workspacePath, clipboard, setClipboard, onRefresh, renamingPath, setRenamingPath, creatingIn, setCreatingIn, onSelectFile, contextTarget, setContextTarget } = useTreeCtx()
  const [children, setChildren] = React.useState<TreeNode[] | undefined>(node.children)
  const [loadingChildren, setLoadingChildren] = React.useState(false)

  React.useEffect(() => { setChildren(node.children) }, [node.children])

  const handleOpenChange = React.useCallback(async (open: boolean) => {
    if (open && children === undefined && !loadingChildren) {
      setLoadingChildren(true)
      try {
        const params = new URLSearchParams({ path: workspacePath, sub: node.path, depth: "2" })
        const res = await fetch(`/api/workspace/tree?${params}`)
        if (res.ok) {
          const data = await res.json()
          setChildren(data.tree || [])
        }
      } catch {}
      setLoadingChildren(false)
    }
  }, [children, loadingChildren, workspacePath, node.path])

  const handleRename = async (newName: string) => {
    const parent = getParentDir(node.path)
    const newPath = parent ? `${parent}/${newName}` : newName
    try {
      await workspaceApi.manage(workspacePath, "rename", { oldPath: node.path, newPath })
      onRefresh()
    } catch {}
    setRenamingPath(null)
  }

  const handleDelete = async () => {
    try {
      await workspaceApi.manage(workspacePath, "delete", { path: node.path })
      onRefresh()
    } catch {}
  }

  const handlePaste = async () => {
    if (!clipboard) return
    const name = clipboard.path.split("/").pop() || "pasted"
    const destPath = `${node.path}/${name}`
    try {
      if (clipboard.action === "copy") {
        await workspaceApi.manage(workspacePath, "copy", { srcPath: clipboard.path, destPath })
      } else {
        await workspaceApi.manage(workspacePath, "move", { srcPath: clipboard.path, destPath })
        setClipboard(null)
      }
      onRefresh()
    } catch {}
  }

  const handleCreateConfirm = async (name: string) => {
    if (!creatingIn) return
    const newPath = `${creatingIn.dir}/${name}`
    try {
      await workspaceApi.manage(workspacePath, creatingIn.type === "file" ? "create-file" : "create-folder", { path: newPath })
      onRefresh()
    } catch {}
    setCreatingIn(null)
  }

  if (renamingPath === node.path) {
    return (
      <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="px-2 py-0.5">
        <InlineRenameInput defaultValue={node.name} onConfirm={handleRename} onCancel={() => setRenamingPath(null)} />
      </div>
    )
  }

  const isCreatingHere = creatingIn?.dir === node.path
  const isContextActive = contextTarget === node.path

  return (
    <Collapsible className="group/collapsible" onOpenChange={handleOpenChange} defaultOpen={isCreatingHere}>
      <ContextMenu onOpenChange={(open) => { if (open) setContextTarget(node.path); else setContextTarget(null) }}>
        <ContextMenuTrigger asChild>
          <CollapsibleTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground",
                isContextActive && "bg-accent/70 ring-1 ring-primary/40"
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground group-data-[state=open]/collapsible:hidden" />
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground hidden group-data-[state=open]/collapsible:block" />
              <span className="truncate">{node.name}</span>
            </button>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setCreatingIn({ dir: node.path, type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>
          <ContextMenuItem onClick={() => setCreatingIn({ dir: node.path, type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenamingPath(node.path)}><Pencil className="h-3.5 w-3.5 mr-2" />重命名</ContextMenuItem>
          <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "copy" })}><Copy className="h-3.5 w-3.5 mr-2" />复制</ContextMenuItem>
          <ContextMenuItem onClick={() => setClipboard({ path: node.path, type: "directory", action: "cut" })}><Scissors className="h-3.5 w-3.5 mr-2" />剪切</ContextMenuItem>
          {clipboard && <ContextMenuItem onClick={handlePaste}><Clipboard className="h-3.5 w-3.5 mr-2" />粘贴</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />删除</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent>
        {isCreatingHere && (
          <div style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }} className="px-2 py-0.5">
            <InlineRenameInput defaultValue="" onConfirm={handleCreateConfirm} onCancel={() => setCreatingIn(null)} />
          </div>
        )}
        {loadingChildren ? (
          <div className="flex items-center gap-2 px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">加载中...</span>
          </div>
        ) : (
          children?.map((child) =>
            child.type === "directory" ? (
              <TreeDirItem key={child.path} node={child} selectedFile={selectedFile} depth={depth + 1} />
            ) : (
              <TreeFileItem key={child.path} node={child} selectedFile={selectedFile} depth={depth + 1} />
            )
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/* --- Main Sidebar --- */
export function FileTreeSidebar({
  workspacePath, tree, selectedFile, onSelectFile, loading,
  clipboard, setClipboard, onRefresh,
}: FileTreeSidebarProps) {
  const workspaceName = workspacePath.split("/").filter(Boolean).pop() || "Workspace"
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  const [creatingIn, setCreatingIn] = React.useState<{ dir: string; type: "file" | "folder" } | null>(null)
  const [contextTarget, setContextTarget] = React.useState<string | null>(null)

  const handleRootPaste = async () => {
    if (!clipboard) return
    const name = clipboard.path.split("/").pop() || "pasted"
    try {
      if (clipboard.action === "copy") {
        await workspaceApi.manage(workspacePath, "copy", { srcPath: clipboard.path, destPath: name })
      } else {
        await workspaceApi.manage(workspacePath, "move", { srcPath: clipboard.path, destPath: name })
        setClipboard(null)
      }
      onRefresh()
    } catch {}
  }

  const handleRootCreateConfirm = async (name: string) => {
    if (!creatingIn) return
    try {
      await workspaceApi.manage(workspacePath, creatingIn.type === "file" ? "create-file" : "create-folder", { path: name })
      onRefresh()
    } catch {}
    setCreatingIn(null)
  }

  const isCreatingAtRoot = creatingIn?.dir === ""

  return (
    <TreeContext.Provider value={{ workspacePath, clipboard, setClipboard, onRefresh, renamingPath, setRenamingPath, creatingIn, setCreatingIn, onSelectFile, contextTarget, setContextTarget }}>
      <div className="flex flex-col h-full bg-card">
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <Folder className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold truncate flex-1">{workspaceName}</span>
        </div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 overflow-auto py-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : tree.length === 0 && !isCreatingAtRoot ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">空目录</div>
              ) : (
                <>
                  {isCreatingAtRoot && (
                    <div className="px-2 py-0.5" style={{ paddingLeft: "8px" }}>
                      <InlineRenameInput defaultValue="" onConfirm={handleRootCreateConfirm} onCancel={() => setCreatingIn(null)} />
                    </div>
                  )}
                  {tree.map((node) =>
                    node.type === "directory" ? (
                      <TreeDirItem key={node.path} node={node} selectedFile={selectedFile} depth={0} />
                    ) : (
                      <TreeFileItem key={node.path} node={node} selectedFile={selectedFile} depth={0} />
                    )
                  )}
                </>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setCreatingIn({ dir: "", type: "file" })}><FilePlus className="h-3.5 w-3.5 mr-2" />新建文件</ContextMenuItem>
            <ContextMenuItem onClick={() => setCreatingIn({ dir: "", type: "folder" })}><FolderPlus className="h-3.5 w-3.5 mr-2" />新建文件夹</ContextMenuItem>
            {clipboard && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleRootPaste}><Clipboard className="h-3.5 w-3.5 mr-2" />粘贴</ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </TreeContext.Provider>
  )
}