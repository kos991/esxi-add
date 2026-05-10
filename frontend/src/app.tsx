import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import 'antd/dist/reset.css'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function rootContainer(container: ReactNode) {
  return <QueryClientProvider client={queryClient}>{container}</QueryClientProvider>
}
