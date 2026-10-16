import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listEquipSpecs, listPointSpecs } from '@ssl/haystack'
import { client } from '../../../lib/client.ts'

/** After any change, everything on screen that came from Haxall is re-read (except big history downloads). */
export function useRefreshAll() {
  const qc = useQueryClient()
  return useCallback(
    () => qc.invalidateQueries({ predicate: (q) => !['his', 'latest', 'specs'].includes(String(q.queryKey[0])) }),
    [qc],
  )
}

export const usePointSpecs = () =>
  useQuery({ queryKey: ['specs', 'points'], queryFn: () => listPointSpecs(client), staleTime: Infinity, retry: false })

export const useEquipSpecs = () =>
  useQuery({ queryKey: ['specs', 'equips'], queryFn: () => listEquipSpecs(client), staleTime: Infinity, retry: false })
