import { useState, type FormEvent } from 'react'
import { Logo } from '../components/Logo.tsx'
import { useAuth } from './AuthContext.tsx'

export function LoginPage() {
  const { signIn, busy, error } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void signIn(username, password)
  }

  return (
    <main className="login">
      <Logo className="login-logo" />
      <form className="card login-card" onSubmit={submit}>
        <h1>SkySpark Lite</h1>
        <p className="muted">Sign in with your Haxall account.</p>
        {error && (
          <div role="alert" className={`alert ${error.kind === 'unreachable' ? 'alert-warn' : 'alert-error'}`}>
            <strong>{error.title}</strong>
            <div>{error.message}</div>
          </div>
        )}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
