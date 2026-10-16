// SCRAM-SHA-256 login for Haystack servers (Haxall / SkySpark).
// Uses only Web Crypto + fetch, so the same file works in Node and in the browser.

import { AuthError, UnreachableError } from './errors.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
// base64url without padding, as the Haystack auth spec requires for header data
const b64u = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function fromB64u(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return fromB64(s)
}

async function hmac(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg as BufferSource))
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}
async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, k, 256)
  return new Uint8Array(bits)
}

async function get(url: string, authorization: string): Promise<Response> {
  let res: Response
  try {
    // credentials: 'omit' keeps Haxall's session cookie out of it (see client.ts)
    res = await fetch(url, { headers: { Authorization: authorization }, credentials: 'omit' })
  } catch {
    throw new UnreachableError()
  }
  // a dev proxy answers 5xx when it cannot connect to Haxall
  if (res.status >= 500) throw new UnreachableError(`Haxall is not answering (HTTP ${res.status}). Is it running?`)
  return res
}

/** Parse `SCRAM hash=SHA-256, handshakeToken=abc, data=xyz` style header values. */
function parseAuthHeader(h: string): { scheme: string; attrs: Record<string, string> } {
  const sp = h.indexOf(' ')
  const scheme = sp < 0 ? h : h.slice(0, sp)
  const attrs: Record<string, string> = {}
  if (sp >= 0) {
    for (const part of h.slice(sp + 1).split(',')) {
      const i = part.indexOf('=')
      if (i > 0) attrs[part.slice(0, i).trim()] = part.slice(i + 1).trim()
    }
  }
  return { scheme, attrs }
}


/**
 * Log in and return the bearer auth token.
 * `url` is any protected URL on the server, normally `<origin>/api/<proj>/about`.
 */
export async function scramLogin(url: string, username: string, password: string): Promise<string> {
  // 1. HELLO
  let res = await get(url, `HELLO username=${b64u(enc.encode(username))}`)
  if (res.status !== 401) throw new AuthError(`Unexpected status ${res.status} to HELLO`)
  let www = parseAuthHeader(res.headers.get('www-authenticate') ?? '')
  if (www.scheme.toUpperCase() !== 'SCRAM') throw new AuthError(`Server does not offer SCRAM (offers ${www.scheme})`)
  if ((www.attrs.hash ?? 'SHA-256') !== 'SHA-256') throw new AuthError(`Unsupported hash ${www.attrs.hash}`)
  let handshake = www.attrs.handshakeToken

  // 2. client-first
  const nonce = b64(crypto.getRandomValues(new Uint8Array(18)))
  const clientFirstBare = `n=${username},r=${nonce}`
  res = await get(url, `SCRAM handshakeToken=${handshake}, data=${b64u(enc.encode('n,,' + clientFirstBare))}`)
  if (res.status !== 401) throw new AuthError(`Unexpected status ${res.status} to client-first`)
  www = parseAuthHeader(res.headers.get('www-authenticate') ?? '')
  handshake = www.attrs.handshakeToken
  const serverFirst = dec.decode(fromB64u(www.attrs.data))
  const sf = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]))
  if (!sf.r?.startsWith(nonce)) throw new AuthError('Server nonce mismatch')

  // 3. client-final
  const salted = await pbkdf2(password, fromB64(sf.s), parseInt(sf.i, 10))
  const clientKey = await hmac(salted, enc.encode('Client Key'))
  const storedKey = await sha256(clientKey)
  const clientFinalNoProof = `c=biws,r=${sf.r}`
  const authMessage = enc.encode(`${clientFirstBare},${serverFirst},${clientFinalNoProof}`)
  const clientSig = await hmac(storedKey, authMessage)
  const proof = clientKey.map((b, i) => b ^ clientSig[i])
  const clientFinal = `${clientFinalNoProof},p=${b64(proof)}`
  res = await get(url, `SCRAM handshakeToken=${handshake}, data=${b64u(enc.encode(clientFinal))}`)
  if (res.status === 403 || res.status === 401) throw new AuthError('Login failed: wrong username or password')
  if (!res.ok) throw new AuthError(`Unexpected status ${res.status} to client-final`)

  // 4. verify server + read token
  const info = parseAuthHeader('X ' + (res.headers.get('authentication-info') ?? ''))
  const token = info.attrs.authToken
  if (!token) throw new AuthError('Server did not return an authToken')
  const serverKey = await hmac(salted, enc.encode('Server Key'))
  const expected = b64(await hmac(serverKey, authMessage))
  const serverFinal = dec.decode(fromB64u(info.attrs.data ?? ''))
  if (serverFinal !== `v=${expected}`) throw new AuthError('Server signature check failed')
  return token
}
