import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import Layout from './layouts'
import BuildPage from './pages/BuildPage'
import OverviewPage from './pages/OverviewPage'
import StorageFilesPage from './pages/StorageFilesPage'

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

function TaskDetailRedirect() {
  const { taskId } = useParams<{ taskId: string }>()
  const target = taskId ? `/build?task=${encodeURIComponent(taskId)}` : '/build'
  return <Navigate to={target} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="storage" element={<StorageFilesPage />} />
            <Route path="build" element={<BuildPage />} />
            {/* 兼容历史旧路径，统一收敛至 3 大核心页面 */}
            <Route path="buckets" element={<Navigate to="/storage?focus=nodes" replace />} />
            <Route path="files" element={<Navigate to="/storage" replace />} />
            <Route path="tasks" element={<Navigate to="/build" replace />} />
            <Route path="tasks/:taskId" element={<TaskDetailRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
