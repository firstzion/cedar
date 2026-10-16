import { useEffect, useState } from 'react'

/** True when the page is showing its dark theme (follows the operating system setting). */
export function useDark(): boolean {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => (typeof matchMedia === 'function' ? matchMedia(q).matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}
