import { Outlet, useLocation, useNavigate } from '@umijs/max'
import { AppShell } from './AppShell'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <AppShell pathname={location.pathname} navigate={navigate}>
      <Outlet />
    </AppShell>
  )
}
