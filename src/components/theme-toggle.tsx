"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <span className="material-symbols-outlined text-xl dark:hidden">light_mode</span>
      <span className="material-symbols-outlined text-xl hidden dark:inline">dark_mode</span>
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
