import { Link, NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { displayName, refId } from '@ssl/haystack'
import { useAuth } from '../auth/AuthContext.tsx'
import { client } from '../lib/client.ts'
import { Logo } from '../components/Logo.tsx'
import { describeError } from '../lib/errors.ts'
import { useSite } from './SiteContext.tsx'

export const APPS = [
  { path: '/site-organization', label: 'Site Organization' },
  { path: '/trend-viewer', label: 'Trend Viewer' },
]

export function Shell() {
  const { user, signOut } = useAuth()
  const { sites, siteId, setSiteId } = useSite()

  // heartbeat: tells us quickly when Haxall goes away or comes back
  const health = useQuery({ queryKey: ['health'], queryFn: () => client.about(), refetchInterval: 15000, retry: false })
  const down = health.isError ? describeError(health.error) : null

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/site-organization" className="brandlink"><Logo /><span className="brand">SkySpark Lite</span></Link>
        <nav aria-label="Apps" className="apps">
          {APPS.map((a) => (
            <NavLink key={a.path} to={a.path} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>{a.label}</NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <label className="site-select">
          <span className="muted">Site</span>
          <select value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} disabled={sites.length === 0} aria-label="Site">
            {sites.length === 0 && <option value="">No sites</option>}
            {sites.map((s) => <option key={refId(s.id)} value={refId(s.id)}>{displayName(s)}</option>)}
          </select>
        </label>
        <span className="user muted">{user}</span>
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      {down && (
        <div className="banner" role="alert">
          {down.kind === 'unreachable' ? 'Haxall is not responding. Retrying every few seconds…' : down.message}
          <button className="link" onClick={() => void health.refetch()}>Retry now</button>
        </div>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
