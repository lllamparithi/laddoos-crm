// ============================================================
// Safe browser storage — Phase 2A web SDK.
//
// Every call is wrapped so a page embedding this SDK never crashes from
// it: server-side rendering has no `window` at all, and even where
// `window` exists, storage access can throw (Safari private browsing
// historically threw on `setItem`, some embedded/in-app browsers block
// storage entirely). "Unavailable" and "throws" are treated the same —
// both degrade to null/false, never an exception reaching the caller.
// ============================================================

export type StorageKind = 'local' | 'session'

function getBrowserStorage(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    const storage = kind === 'local' ? window.localStorage : window.sessionStorage
    // Access alone can throw in some private-browsing modes before any
    // read/write is attempted — probe with a real operation, not just a
    // property read, so this catches that case too.
    const probeKey = '__yali_storage_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

export function safeGetItem(kind: StorageKind, key: string): string | null {
  const storage = getBrowserStorage(kind)
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** Returns whether the write actually succeeded — never throws. */
export function safeSetItem(kind: StorageKind, key: string, value: string): boolean {
  const storage = getBrowserStorage(kind)
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}
