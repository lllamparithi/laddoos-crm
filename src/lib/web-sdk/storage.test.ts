import { afterEach, describe, expect, it } from 'vitest'
import { safeGetItem, safeSetItem } from './storage'

/** Minimal in-memory Storage stand-in, matching the DOM Storage interface. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
    ...overrides,
  } as Storage
}

function throwingStorage(): Storage {
  return fakeStorage({
    setItem: () => {
      throw new DOMException('QuotaExceededError')
    },
  })
}

afterEach(() => {
  // Node has no `window` by default — this is exactly the environment
  // these functions must degrade safely in, so most tests need no
  // cleanup. Only remove it where a test added it.
  delete (globalThis as { window?: unknown }).window
})

describe('storage — no window (SSR / Node)', () => {
  it('safeGetItem returns null without throwing', () => {
    expect(safeGetItem('local', 'yali_visitor_id')).toBeNull()
  })

  it('safeSetItem returns false without throwing', () => {
    expect(safeSetItem('local', 'yali_visitor_id', 'abc')).toBe(false)
  })
})

describe('storage — window present, storage works', () => {
  function withWindow() {
    ;(globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } }).window = {
      localStorage: fakeStorage(),
      sessionStorage: fakeStorage(),
    }
  }

  it('round-trips a value through localStorage', () => {
    withWindow()
    expect(safeSetItem('local', 'k', 'v')).toBe(true)
    expect(safeGetItem('local', 'k')).toBe('v')
  })

  it('keeps local and session storage independent', () => {
    withWindow()
    safeSetItem('local', 'k', 'local-value')
    safeSetItem('session', 'k', 'session-value')
    expect(safeGetItem('local', 'k')).toBe('local-value')
    expect(safeGetItem('session', 'k')).toBe('session-value')
  })

  it('returns null for a key that was never set', () => {
    withWindow()
    expect(safeGetItem('local', 'never-set')).toBeNull()
  })
})

describe('storage — window present but storage throws (private browsing)', () => {
  it('degrades to false/null instead of throwing', () => {
    ;(globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } }).window = {
      localStorage: throwingStorage(),
      sessionStorage: throwingStorage(),
    }
    expect(() => safeSetItem('local', 'k', 'v')).not.toThrow()
    expect(safeSetItem('local', 'k', 'v')).toBe(false)
    expect(safeGetItem('local', 'k')).toBeNull()
  })
})
