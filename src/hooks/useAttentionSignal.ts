import * as React from 'react'

import { getDocumentTitle } from '@/hooks/useDocumentTitle'

interface AttentionSignalOptions {
  active: boolean
  title: string
  notificationTitle?: string
  notificationBody?: string
  toast?: (level: 'info' | 'success' | 'warning' | 'error', message: string) => void
  toastMessage?: string
}

export function useAttentionSignal({
  active,
  title,
  notificationTitle,
  notificationBody,
  toast,
  toastMessage,
}: AttentionSignalOptions) {
  const hasAnnouncedRef = React.useRef(false)
  const notificationRef = React.useRef<Notification | null>(null)

  React.useEffect(() => {
    if (!active) {
      hasAnnouncedRef.current = false
      notificationRef.current?.close()
      notificationRef.current = null
      return
    }

    if (!hasAnnouncedRef.current && toast && toastMessage) {
      toast('warning', toastMessage)
    }

    const canNotify =
      typeof window !== 'undefined'
      && typeof document !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted'
      && document.visibilityState === 'hidden'

    if (!hasAnnouncedRef.current && canNotify) {
      notificationRef.current?.close()
      notificationRef.current = new Notification(notificationTitle || title, {
        body: notificationBody,
      })
    }

    hasAnnouncedRef.current = true

    return () => {
      notificationRef.current?.close()
      notificationRef.current = null
    }
  }, [active, title, notificationTitle, notificationBody, toast, toastMessage])

  return React.useMemo(
    () => ({
      active,
      title: active ? getDocumentTitle(title) : undefined,
    }),
    [active, title],
  )
}
