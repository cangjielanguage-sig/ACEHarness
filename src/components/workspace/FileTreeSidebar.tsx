"use client"

import * as React from "react"
import { File, Folder, FolderOpen, ChevronRight, Loader2 } from "lucide-react"
import { type TreeNode } from "@/lib/api"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible"
import { cn } from "@/lib/utils"

interface FileTreeSidebarProps {
  workspacePath: string
  tree: TreeNode[]
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  loading: boolean
}

function TreeFileItem({
  node,
  selectedFile,
  onSelectFile,
  depth,
}: {
  node: TreeNode
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  depth: number
}) {
  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm",
        "hover:bg-accent hover:text-accent-foreground",
        selectedFile === node.path &&
          "bg-accent text-accent-foreground font-medium"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

function TreeDirItem({
  node,
  selectedFile,
  onSelectFile,
  depth,
}: {
  node: TreeNode
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  depth: number
}) {
  return (
    <Collapsible className="group/collapsible">
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-2 w-full px-2 py-1 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground group-data-[state=open]/collapsible:hidden" />
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground hidden group-data-[state=open]/collapsible:block" />
          <span className="truncate">{node.name}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children?.map((child) =>
          child.type === "directory" ? (
            <TreeDirItem
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ) : (
            <TreeFileItem
              key={child.path}
              node={child}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FileTreeSidebar({
  workspacePath,
  tree,
  selectedFile,
  onSelectFile,
  loading,
}: FileTreeSidebarProps) {
  const workspaceName =
    workspacePath.split("/").filter(Boolean).pop() || "Workspace"

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <Folder className="h-4 w-4 shrink-0" />
        <span className="text-sm font-semibold truncate">{workspaceName}</span>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            空目录
          </div>
        ) : (
          tree.map((node) =>
            node.type === "directory" ? (
              <TreeDirItem
                key={node.path}
                node={node}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={0}
              />
            ) : (
              <TreeFileItem
                key={node.path}
                node={node}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                depth={0}
              />
            )
          )
        )}
      </div>
    </div>
  )
}
