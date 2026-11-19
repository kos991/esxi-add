import { flushSync } from 'react-dom'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'
import { AppShell } from './AppShell'

export default function Layout() {
  const location = useLocation()
  const rawNavigate = useNavigate()
  const { status, openAdminDialog, requireAdmin } = useAdminAuth()

  const performNavigate = (path: string) => {
    if (path === location.pathname + location.search) return
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void
    }

    if (!prefersReduced && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        flushSync(() => {
          rawNavigate(path)
        })
      })
    } else {
      rawNavigate(path)
    }
  }

  const navigate = (path: string) => {
    if (
      (path.startsWith('/storage') || path.startsWith('/buckets') || path.startsWith('/files')) &&
      !(status.configured && status.authenticated)
    ) {
      requireAdmin(() => performNavigate(path))
      return
    }
    performNavigate(path)
  }

  return (
    <AppShell
      pathname={location.pathname}
      navigate={navigate}
      version={status.version}
      auth={status}
      onAdminClick={() => openAdminDialog()}
    >
      <Outlet />
    </AppShell>
  )
}
