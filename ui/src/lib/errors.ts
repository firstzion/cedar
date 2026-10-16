import { ApiError, AuthError, ConflictError, RuleError, UnreachableError } from '@ssl/haystack'

export interface ErrorInfo { title: string; message: string; detail?: string; kind: 'unreachable' | 'auth' | 'api' | 'other' }

/** Turn any error into something we can show to a person. */
export function describeError(e: unknown): ErrorInfo {
  if (e instanceof UnreachableError) return { kind: 'unreachable', title: 'Haxall is unreachable', message: e.message }
  if (e instanceof AuthError) return { kind: 'auth', title: 'Sign-in problem', message: e.message }
  if (e instanceof ConflictError) return { kind: 'api', title: 'Changed by someone else', message: e.message }
  if (e instanceof RuleError) return { kind: 'api', title: 'That cannot be done', message: e.message }
  if (e instanceof ApiError) return { kind: 'api', title: 'Haxall rejected the request', message: e.message, detail: e.trace || undefined }
  return { kind: 'other', title: 'Something went wrong', message: e instanceof Error ? e.message : String(e) }
}
