import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.tsx'
import { LoginPage } from './auth/LoginPage.tsx'
import { SiteOrganization } from './apps/SiteOrganization.tsx'
import { Shell } from './shell/Shell.tsx'
import { SiteProvider } from './shell/SiteContext.tsx'
import { Loading } from './components/Status.tsx'

// the Trend Viewer brings the chart library with it, so it is only downloaded when someone opens it
const TrendViewer = lazy(() => import('./apps/TrendViewer.tsx').then((m) => ({ default: m.TrendViewer })))

/** Old links (/builder, /historian) keep working: same page and query, new address. */
function Moved({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export function App() {
  const { status } = useAuth()
  if (status === 'checking') return <Loading label="Checking your session…" />
  if (status === 'signedOut') return <LoginPage />
  return (
    <SiteProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/site-organization/*" element={<SiteOrganization />} />
          <Route path="/trend-viewer/*" element={<Suspense fallback={<Loading label="Loading Trend Viewer…" />}><TrendViewer /></Suspense>} />
          <Route path="/builder/*" element={<Moved to="/site-organization" />} />
          <Route path="/historian/*" element={<Moved to="/trend-viewer" />} />
          <Route path="*" element={<Navigate to="/site-organization" replace />} />
        </Route>
      </Routes>
    </SiteProvider>
  )
}
