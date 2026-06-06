import { toast } from 'sonner'

type NotifyType = 'success' | 'error' | 'info' | 'warning'

interface NotifyOptions {
  description?: string
  type?: NotifyType
  action?: { label: string; onClick: () => void }
  duration?: number
}

function isWindowFocused(): boolean {
  return document.hasFocus()
}

export function notify(title: string, options?: NotifyOptions): void {
  if (isWindowFocused()) {
    const type = options?.type ?? 'info'
    toast[type](title, {
      description: options?.description,
      action: options?.action,
      duration: options?.duration
    })
  } else {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body: options?.description })
    } else {
      toast[options?.type ?? 'info'](title, {
        description: options?.description,
        action: options?.action,
        duration: options?.duration
      })
    }
  }
}

export function notifyPromise<T>(
  promise: Promise<T>,
  msgs: { loading: string; success: string | ((data: T) => string); error: string | ((err: unknown) => string) }
): void {
  toast.promise(promise, msgs)
}
