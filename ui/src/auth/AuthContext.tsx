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
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  // with a stored token the session is checked first; without one there is nothing to check
  const [status, setStatus] = useState<AuthStatus>(() => (client.isLoggedIn ? 'checking' : 'signedOut'))
  const [user, setUser] = useState<string | null>(null)
  const [error, setError] = useState<AuthValue['error']>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    onAuthLost(() => {
      qc.clear()
      setError({ kind: 'auth', title: 'Signed out', message: 'Your session has ended. Please sign in again.' })
      setStatus('signedOut')
    })
    if (!client.isLoggedIn) return
    // is the stored token still good? state only changes once Haxall has answered
    let current = true
    client.about().then(
      (about) => {
        if (!current) return
        setUser(str(about.whoami) ?? null)
        setError(null)
        setStatus('signedIn')
      },
      (e: unknown) => {
        if (!current) return
        const info = describeError(e)
        // a dead session is normal after a restart; only show the message for real problems
        setError(info.kind === 'auth' ? null : info)
        setStatus('signedOut')
      },
    )
    return () => { current = false }
  }, [qc])

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
    void client.logout() // the page signs out at once; Haxall is told to close the session in the background
    qc.clear()
    setUser(null)
    setError(null)
    setStatus('signedOut')
  }, [qc])

  const value = useMemo(() => ({ status, user, error, busy, signIn, signOut }), [status, user, error, busy, signIn, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
