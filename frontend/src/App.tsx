import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Activity, Boxes, Clock3, Database, Disc3, FileArchive } from 'lucide-react'
import OverviewPage from './pages/OverviewPage'
import BucketsPage from './pages/BucketsPage'
import FilesPage from './pages/FilesPage'
import BuildPage from './pages/BuildPage'
import TasksPage from './pages/TasksPage'
import TaskDetailPage from './pages/TaskDetailPage'

const sections = [
  {
    title: '站点概览',
    items: [{ to: '/', label: '总览', icon: Activity }],
  },
  {
    title: '存储与资产',
    items: [
      { to: '/buckets', label: '存储与挂载', icon: Database },
      { to: '/files', label: '文件库', icon: FileArchive },
    ],
  },
  {
    title: '自动化构建',
    items: [
      { to: '/build', label: '定制构建', icon: Disc3 },
      { to: '/tasks', label: '任务历史', icon: Clock3 },
    ],
  },
]

const routeLabels: Record<string, string> = {
  '/': '总览',
  '/buckets': '存储与挂载',
  '/files': '文件库',
  '/build': '定制构建',
  '/tasks': '任务历史',
}

export default function App() {
  const location = useLocation()
  const currentLabel = location.pathname.startsWith('/tasks/') ? '任务详情' : routeLabels[location.pathname] ?? '总览'

  return (
    <div className="flex h-screen overflow-hidden bg-white text-gray-950">
      <aside className="sidebar flex w-60 shrink-0 flex-col">
        <div className="flex h-14 items-center gap-2 border-b bg-white px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[#f38020] text-[11px] font-bold text-white">
            <Boxes className="h-4 w-4" />
          </div>
          <span className="text-[14px] font-bold tracking-tight">ESXi ISO Builder</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="sidebar-section-title">{section.title}</div>
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-white px-8">
          <div className="breadcrumb">
            <span className="text-[#0051c3]">账户</span>
            <span>/</span>
            <span className="font-bold text-gray-900">{currentLabel}</span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-6xl">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/buckets" element={<BucketsPage />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="/build" element={<BuildPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
            </Routes>
          </div>
        </div>
      </main>
    </div>
  )
}
