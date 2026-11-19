import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AdminRouteGuard } from './components/AdminRouteGuard'
import { AdminAuthProvider } from './contexts/AdminAuthContext'
import Layout from './layouts'
import BuildPage from './pages/BuildPage'
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
        <AdminAuthProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              {/* 默认首页直接进入：构建流水线（对访客公开） */}
              <Route index element={<BuildPage />} />
              <Route path="build" element={<BuildPage />} />
              {/* 存储与挂载：需管理员验证 */}
              <Route
                path="storage"
                element={
                  <AdminRouteGuard>
                    <StorageFilesPage />
                  </AdminRouteGuard>
                }
              />

              {/* 历史旧路由平滑过渡 */}
              <Route path="pipeline" element={<Navigate to="/build" replace />} />
              <Route path="overview" element={<Navigate to="/build" replace />} />
              <Route path="tasks" element={<Navigate to="/build" replace />} />
              <Route path="tasks/:taskId" element={<TaskDetailRedirect />} />
              <Route path="buckets" element={<Navigate to="/storage" replace />} />
              <Route path="files" element={<Navigate to="/storage" replace />} />
              <Route path="*" element={<Navigate to="/build" replace />} />
            </Route>
          </Routes>
        </AdminAuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
