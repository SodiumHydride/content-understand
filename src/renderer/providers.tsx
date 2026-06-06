import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 30_000)
    }
  }
})

export function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        expand
        duration={4_000}
        toastOptions={{
          classNames: {
            toast:
              'border border-[var(--divider)] bg-[var(--color-paper)] text-[var(--color-ink-800)] shadow-lg',
            actionButton: 'bg-[var(--color-accent)] text-white',
            cancelButton: 'bg-[var(--color-paper-deep)] text-[var(--color-ink-700)]'
          }
        }}
      />
    </QueryClientProvider>
  )
}
