import { flushSync } from 'react-dom'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'

export default function Layout() {
  const location = useLocation()
  const rawNavigate = useNavigate()

  const navigate = (path: string) => {
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

  return (
    <AppShell pathname={location.pathname} navigate={navigate}>
      <Outlet />
    </AppShell>
  )
}
