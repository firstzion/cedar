import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { refId, type HDict } from '@ssl/haystack'
import { client } from '../lib/client.ts'

interface SiteValue {
  sites: HDict[]
  site: HDict | undefined
  siteId: string | undefined
  setSiteId(id: string): void
  loading: boolean
  error: unknown
  refetch(): void
}

const Ctx = createContext<SiteValue | null>(null)
const KEY = 'ssl.site'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }

export function SiteProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['sites'], queryFn: () => client.read('site'), retry: false })
  const [chosen, setChosen] = useState<string | null>(read)
  const { data, isLoading, error, refetch } = q
  const sites = useMemo(() => data ?? [], [data])
  // fall back to the first site if the remembered one no longer exists
  const site = sites.find((s) => refId(s.id) === chosen) ?? sites[0]

  const value = useMemo<SiteValue>(() => ({
    sites, site, siteId: refId(site?.id),
    setSiteId: (id) => { setChosen(id); try { localStorage.setItem(KEY, id) } catch { /* private mode: just don't remember */ } },
    loading: isLoading, error, refetch: () => void refetch(),
  }), [sites, site, isLoading, error, refetch])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSite(): SiteValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSite must be used inside SiteProvider')
  return v
}
