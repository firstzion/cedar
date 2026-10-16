// Error types the UI can tell apart. Plain classes (no parameter properties) so Node can run them directly.

/** Haxall cannot be reached at all (not running, network down, proxy cannot connect). */
export class UnreachableError extends Error {
  constructor(message = 'Cannot reach Haxall. Is it running? (try: make up)') {
    super(message)
    this.name = 'UnreachableError'
  }
}

/** Wrong username/password, or the session token is no longer valid. */
export class AuthError extends Error {
  constructor(message = 'Authentication failed') {
    super(message)
    this.name = 'AuthError'
  }
}

/** Haxall answered, but the operation failed (bad filter, unknown record, permission, ...). */
export class ApiError extends Error {
  readonly op: string
  readonly trace: string
  constructor(op: string, message: string, trace = '') {
    super(message)
    this.name = 'ApiError'
    this.op = op
    this.trace = trace
  }
}

/** Someone (or something) changed the record after it was read, so the edit was refused. Reload and try again. */
export class ConflictError extends Error {
  constructor(message = 'This record was changed by someone else since you opened it. Reload it and try again.') {
    super(message)
    this.name = 'ConflictError'
  }
}

/** The edit would break a rule (for example moving an equipment inside itself). Nothing was changed. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}
