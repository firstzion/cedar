// The one Haxall client the whole UI shares. The login token lives in sessionStorage:
// it survives a page refresh but disappears when the tab closes.
import { HaystackClient, type TokenStore } from '@ssl/haystack'

const KEY = 'ssl.token'
const safe = <T,>(f: () => T, fallback: T): T => {
  try { return f() } catch { return fallback }
}

const tokenStore: TokenStore = {
  get: () => safe(() => sessionStorage.getItem(KEY), null),
  set: (t) => safe(() => sessionStorage.setItem(KEY, t), undefined),
  clear: () => safe(() => sessionStorage.removeItem(KEY), undefined),
}

let authLost: () => void = () => {}
/** Register what happens when Haxall rejects our token. */
export const onAuthLost = (fn: () => void) => { authLost = fn }

export const client = new HaystackClient({ origin: '', tokenStore, onAuthLost: () => authLost() })
