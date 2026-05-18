import { Outlet, useLocation, useNavigate } from 'react-router-dom'
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
