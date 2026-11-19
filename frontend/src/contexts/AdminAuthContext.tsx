import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getAuthStatus, logoutAdmin, type AuthStatus } from '../api/auth'
import { ADMIN_UNAUTHORIZED_EVENT } from '../api/client'
import { AdminAuthDialog } from '../components/AdminAuthDialog'

export const DEFAULT_APP_VERSION = 'v1.0.1'

export interface AdminAuthContextValue {
  status: AuthStatus
  isLoading: boolean
  openAdminDialog: (onSuccess?: () => void) => void
  requireAdmin: (action: () => void) => void
  logout: () => Promise<void>
}

const defaultStatus: AuthStatus = {
  version: DEFAULT_APP_VERSION,
  configured: true,
  authenticated: true,
  env_managed: false,
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 30_000,
    retry: 1,
  })

  const status: AuthStatus = authQuery.data ?? {
    version: DEFAULT_APP_VERSION,
    configured: true,
    authenticated: false,
    env_managed: false,
  }

  const updateStatus = useCallback(
    (next: AuthStatus) => {
      queryClient.setQueryData(['auth-status'], next)
      queryClient.invalidateQueries({ queryKey: ['buckets'] })
    },
    [queryClient]
  )

  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.setQueryData<AuthStatus | undefined>(['auth-status'], (prev) =>
        prev
          ? { ...prev, authenticated: false }
          : {
              version: DEFAULT_APP_VERSION,
              configured: true,
              authenticated: false,
              env_managed: false,
            }
      )
      queryClient.invalidateQueries({ queryKey: ['auth-status'] })
    }
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [queryClient])

  const openAdminDialog = useCallback((onSuccess?: () => void) => {
    pendingActionRef.current = onSuccess ?? null
    setDialogOpen(true)
  }, [])

  const requireAdmin = useCallback(
    (action: () => void) => {
      if (status.configured && status.authenticated) {
        action()
        return
      }
      pendingActionRef.current = action
      setDialogOpen(true)
    },
    [status.authenticated, status.configured]
  )

  const handleAuthenticated = useCallback(() => {
    const fn = pendingActionRef.current
    pendingActionRef.current = null
    if (fn) {
      window.setTimeout(() => fn(), 0)
    }
  }, [])

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false)
    pendingActionRef.current = null
  }, [])

  const logout = useCallback(async () => {
    const next = await logoutAdmin()
    updateStatus({
      version: next.version || status.version,
      configured: next.configured,
      authenticated: false,
      env_managed: next.env_managed,
    })
  }, [status.version, updateStatus])

  return (
    <AdminAuthContext.Provider
      value={{
        status,
        isLoading: authQuery.isLoading,
        openAdminDialog,
        requireAdmin,
        logout,
      }}
    >
      {children}
      <AdminAuthDialog
        open={dialogOpen}
        status={status}
        onClose={handleCloseDialog}
        onStatusChange={updateStatus}
        onAuthenticated={handleAuthenticated}
      />
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) {
    // Fallback for standalone unit tests that render pages without AdminAuthProvider
    return {
      status: defaultStatus,
      isLoading: false,
      openAdminDialog: () => undefined,
      requireAdmin: (action) => action(),
      logout: async () => undefined,
    }
  }
  return ctx
}
