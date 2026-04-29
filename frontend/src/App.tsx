import { Routes, Route, NavLink } from 'react-router-dom'
import BucketsPage from './pages/BucketsPage'
import FilesPage from './pages/FilesPage'
import BuildPage from './pages/BuildPage'
import TasksPage from './pages/TasksPage'
import TaskDetailPage from './pages/TaskDetailPage'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex gap-6">
        <span className="font-bold text-lg mr-4">ESXi ISO Builder</span>
        {[
          { to: '/buckets', label: 'Storage' },
          { to: '/files', label: 'Files' },
          { to: '/build', label: 'Build' },
          { to: '/tasks', label: 'Tasks' },
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} className={({ isActive }) =>
            isActive ? 'text-blue-600 font-medium' : 'text-gray-600 hover:text-gray-900'
          }>{label}</NavLink>
        ))}
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<TasksPage />} />
          <Route path="/buckets" element={<BucketsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/build" element={<BuildPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}
