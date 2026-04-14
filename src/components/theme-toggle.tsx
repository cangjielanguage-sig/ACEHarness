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
      <span className="material-symbols-outlined dark:hidden" style={{ fontSize: '18px' }}>light_mode</span>
      <span className="material-symbols-outlined hidden dark:inline" style={{ fontSize: '18px' }}>dark_mode</span>
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
