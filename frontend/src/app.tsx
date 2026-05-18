import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './layouts'
import BucketsPage from './pages/BucketsPage'
import BuildPage from './pages/BuildPage'
import FilesPage from './pages/FilesPage'
import OverviewPage from './pages/OverviewPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TasksPage from './pages/TasksPage'

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="buckets" element={<BucketsPage />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="build" element={<BuildPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
