import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import {
  CloseOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
} from './icons'
import {
  changeAdminPassword,
  loginAdmin,
  logoutAdmin,
  setupAdminPassword,
  type AuthStatus,
} from '../api/auth'

export interface AdminAuthDialogProps {
  open: boolean
  status: AuthStatus
  onClose: () => void
  onStatusChange: (next: AuthStatus) => void
  onAuthenticated?: () => void
}

export function AdminAuthDialog({
  open,
  status,
  onClose,
  onStatusChange,
  onAuthenticated,
}: AdminAuthDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const headingId = useId()
  const constraintsId = useId()

  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const mode: 'setup' | 'login' | 'account' = !status.configured
    ? 'setup'
    : !status.authenticated
      ? 'login'
      : 'account'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      setPassword('')
      setCurrentPassword('')
      setNewPassword('')
      setShowPassword(false)
      setShowNewPassword(false)
      setErrorMsg('')
      setSuccessMsg('')
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal()
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleNativeClose = () => {
      onClose()
    }
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  const handleBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    // Fallback for browsers that do not yet support closedby="any"
    if (e.target === e.currentTarget && !submitting) {
      e.currentTarget.close()
    }
  }

  const handleSetupOrLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')
    const trimmed = password.trim()
    if (!trimmed) {
      setErrorMsg('请输入管理员密码')
      return
    }
    if (mode === 'setup' && Array.from(trimmed).length < 6) {
      setErrorMsg('管理员密码至少需要 6 个字符')
      return
    }

    setSubmitting(true)
    try {
      const next =
        mode === 'setup'
          ? await setupAdminPassword(trimmed)
          : await loginAdmin(trimmed)
      onStatusChange({
        version: next.version || status.version,
        configured: next.configured,
        authenticated: next.authenticated,
        env_managed: next.env_managed,
      })
      onAuthenticated?.()
      dialogRef.current?.close()
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : '验证失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleChangePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')
    const cur = currentPassword.trim()
    const nextPwd = newPassword.trim()
    if (!cur) {
      setErrorMsg('请输入当前密码')
      return
    }
    if (Array.from(nextPwd).length < 6) {
      setErrorMsg('新密码至少需要 6 个字符')
      return
    }

    setSubmitting(true)
    try {
      const res = await changeAdminPassword(cur, nextPwd)
      onStatusChange({
        version: res.version || status.version,
        configured: res.configured,
        authenticated: res.authenticated,
        env_managed: res.env_managed,
      })
      setCurrentPassword('')
      setNewPassword('')
      setSuccessMsg('管理员密码已更新')
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : '修改密码失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    setSubmitting(true)
    setErrorMsg('')
    try {
      const next = await logoutAdmin()
      onStatusChange({
        version: next.version || status.version,
        configured: next.configured,
        authenticated: false,
        env_managed: next.env_managed,
      })
      dialogRef.current?.close()
    } catch (err) {
      setErrorMsg(typeof err === 'string' ? err : '退出失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="admin-native-dialog"
      aria-labelledby={headingId}
      onClick={handleBackdropClick}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="admin-dialog-panel">
        <div className="admin-dialog-header">
          <div className="admin-dialog-title-wrap">
            <span className={`admin-dialog-badge ${mode === 'account' ? 'is-active' : ''}`}>
              {mode === 'setup' ? (
                <KeyOutlined />
              ) : mode === 'login' ? (
                <LockOutlined />
              ) : (
                <SafetyCertificateOutlined />
              )}
            </span>
            <div>
              <h2 id={headingId} className="admin-dialog-title">
                {mode === 'setup'
                  ? '设置管理员密码'
                  : mode === 'login'
                    ? '管理员登录'
                    : '管理员账户'}
              </h2>
              <p className="admin-dialog-subtitle">
                {mode === 'setup'
                  ? '首次配置后，「存储与挂载」及删除操作需管理员验证'
                  : mode === 'login'
                    ? '普通访客可直接构建下载，存储管理与清理需验证身份'
                    : '当前已拥有「存储与挂载」与任务管理权限'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="admin-dialog-close"
            aria-label="关闭窗口"
            onClick={() => dialogRef.current?.close()}
          >
            <CloseOutlined />
          </button>
        </div>

        {errorMsg && (
          <div className="admin-dialog-alert is-error" role="alert">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="admin-dialog-alert is-success" role="status">
            {successMsg}
          </div>
        )}

        {mode !== 'account' ? (
          <form method="post" action="/api/auth/login" onSubmit={handleSetupOrLogin} className="admin-dialog-form">
            <input
              type="text"
              name="username"
              defaultValue="admin"
              autoComplete="username"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="visually-hidden"
            />

            <div className="admin-field-group">
              <label htmlFor="admin-password-input" className="admin-field-label">
                {mode === 'setup' ? '新管理员密码' : '管理员密码'}
              </label>
              <div className="admin-password-wrap">
                <input
                  id="admin-password-input"
                  name={mode === 'setup' ? 'new-password' : 'password'}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  minLength={mode === 'setup' ? 6 : undefined}
                  aria-describedby={mode === 'setup' ? constraintsId : undefined}
                  enterKeyHint="done"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'setup' ? '设置至少 6 位管理员密码' : '请输入管理员密码'}
                  className="admin-field-input"
                />
                <button
                  type="button"
                  className="admin-password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </button>
              </div>
              {mode === 'setup' && (
                <div id={constraintsId} className="admin-field-hint">
                  至少 6 个字符；密码加密保存在本地数据库中，也可通过环境变量 ADMIN_PASSWORD 覆盖。
                </div>
              )}
            </div>

            <div className="admin-dialog-footer">
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => dialogRef.current?.close()}
              >
                取消
              </button>
              <button type="submit" className="admin-btn-primary" disabled={submitting}>
                {submitting
                  ? '验证中…'
                  : mode === 'setup'
                    ? '保存并启用管理员'
                    : '登录管理员'}
              </button>
            </div>
          </form>
        ) : (
          <div className="admin-account-section">
            {status.env_managed ? (
              <div className="admin-env-note">
                当前管理员密码由容器环境变量 <code className="mono">ADMIN_PASSWORD</code> 托管。如需更换密码，请更新容器环境变量并重启服务。
              </div>
            ) : (
              <form
                method="post"
                action="/api/auth/password"
                onSubmit={handleChangePassword}
                className="admin-dialog-form"
              >
                <input
                  type="text"
                  name="username"
                  defaultValue="admin"
                  autoComplete="username"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="visually-hidden"
                />

                <div className="admin-field-group">
                  <label htmlFor="admin-current-password" className="admin-field-label">
                    当前密码
                  </label>
                  <div className="admin-password-wrap">
                    <input
                      id="admin-current-password"
                      name="current-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="输入当前管理员密码"
                      className="admin-field-input"
                    />
                    <button
                      type="button"
                      className="admin-password-toggle"
                      aria-pressed={showPassword}
                      aria-label={showPassword ? '隐藏当前密码' : '显示当前密码'}
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    </button>
                  </div>
                </div>

                <div className="admin-field-group">
                  <label htmlFor="admin-new-password" className="admin-field-label">
                    新管理员密码
                  </label>
                  <div className="admin-password-wrap">
                    <input
                      id="admin-new-password"
                      name="new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={6}
                      aria-describedby={constraintsId}
                      enterKeyHint="done"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="输入至少 6 位新密码"
                      className="admin-field-input"
                    />
                    <button
                      type="button"
                      className="admin-password-toggle"
                      aria-pressed={showNewPassword}
                      aria-label={showNewPassword ? '隐藏新密码' : '显示新密码'}
                      onClick={() => setShowNewPassword((prev) => !prev)}
                    >
                      {showNewPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    </button>
                  </div>
                  <div id={constraintsId} className="admin-field-hint">
                    至少 6 个字符；更新后旧登录会话会自动失效。
                  </div>
                </div>

                <div className="admin-dialog-footer is-split">
                  <button
                    type="button"
                    className="admin-btn-danger-ghost"
                    disabled={submitting}
                    onClick={handleLogout}
                  >
                    <LogoutOutlined />
                    <span>退出管理员</span>
                  </button>
                  <button type="submit" className="admin-btn-primary" disabled={submitting}>
                    {submitting ? '保存中…' : '保存新密码'}
                  </button>
                </div>
              </form>
            )}

            {status.env_managed && (
              <div className="admin-dialog-footer">
                <button
                  type="button"
                  className="admin-btn-danger-ghost"
                  disabled={submitting}
                  onClick={handleLogout}
                >
                  <LogoutOutlined />
                  <span>退出管理员</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}
