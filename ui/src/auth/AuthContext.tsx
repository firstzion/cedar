import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AuthError, str } from '@ssl/haystack'
import { client, onAuthLost } from '../lib/client.ts'
import { describeError } from '../lib/errors.ts'

export type AuthStatus = 'checking' | 'signedOut' | 'signedIn'

interface AuthValue {
  status: AuthStatus
  user: string | null
  /** message from the last failed sign-in or session check */
  error: { kind: string; title: string; message: string } | null
  busy: boolean
  signIn(username: string, password: string): Promise<void>
  signOut(): void
  recheck(): void
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<string | null>(null)
  const [error, setError] = useState<AuthValue['error']>(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    if (!client.isLoggedIn) { setStatus('signedOut'); return }
    setStatus('checking')
    try {
      const about = await client.about()
      setUser(str(about.whoami) ?? null)
      setError(null)
      setStatus('signedIn')
    } catch (e) {
      const info = describeError(e)
      // a dead session is normal after a restart; only show the message for real problems
      setError(info.kind === 'auth' ? null : info)
      setStatus('signedOut')
    }
  }, [])

  useEffect(() => {
    onAuthLost(() => {
      qc.clear()
      setError({ kind: 'auth', title: 'Signed out', message: 'Your session has ended. Please sign in again.' })
      setStatus('signedOut')
    })
    void check()
  }, [check, qc])

  const signIn = useCallback(async (username: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      await client.login(username, password)
      const about = await client.about()
      setUser(str(about.whoami) ?? username)
      setStatus('signedIn')
    } catch (e) {
      const info = describeError(e)
      setError(e instanceof AuthError ? { ...info, title: 'Sign-in failed', message: 'Wrong username or password.' } : info)
      setStatus('signedOut')
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(() => {
    client.logout()
    qc.clear()
    setUser(null)
    setError(null)
    setStatus('signedOut')
  }, [qc])

  const value = useMemo(() => ({ status, user, error, busy, signIn, signOut, recheck: check }), [status, user, error, busy, signIn, signOut, check])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
