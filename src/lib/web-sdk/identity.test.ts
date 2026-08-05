import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateVisitorId, getOrCreateSessionId, __resetWebSdkIdentityForTests } from './identity'

function fakeStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => store.delete(key) as unknown as void,
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

function withWindow() {
  ;(globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } }).window = {
    localStorage: fakeStorage(),
    sessionStorage: fakeStorage(),
  }
}

beforeEach(() => {
  __resetWebSdkIdentityForTests()
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('getOrCreateVisitorId — storage available', () => {
  it('persists a generated id and returns the same one on a later call', () => {
    withWindow()
    const first = getOrCreateVisitorId()
    const second = getOrCreateVisitorId()
    expect(first).toBe(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it('writes to localStorage, not sessionStorage', () => {
    withWindow()
    const id = getOrCreateVisitorId()
    const win = (globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } }).window
    expect(win.localStorage.getItem('yali_visitor_id')).toBe(id)
    expect(win.sessionStorage.getItem('yali_visitor_id')).toBeNull()
  })
})

describe('getOrCreateSessionId — storage available', () => {
  it('is independent from the visitor id', () => {
    withWindow()
    const visitor = getOrCreateVisitorId()
    const session = getOrCreateSessionId()
    expect(session).not.toBe(visitor)
  })

  it('writes to sessionStorage, not localStorage', () => {
    withWindow()
    const id = getOrCreateSessionId()
    const win = (globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } }).window
    expect(win.sessionStorage.getItem('yali_session_id')).toBe(id)
    expect(win.localStorage.getItem('yali_session_id')).toBeNull()
  })
})

describe('no storage available (SSR / Node, no window)', () => {
  it('still returns a usable id rather than throwing', () => {
    expect(() => getOrCreateVisitorId()).not.toThrow()
    expect(typeof getOrCreateVisitorId()).toBe('string')
  })

  it('keeps returning the SAME id across calls within one page load via the in-memory fallback', () => {
    const first = getOrCreateVisitorId()
    const second = getOrCreateVisitorId()
    expect(first).toBe(second)
  })

  it('does not persist across a fresh in-memory reset (simulating a new page load with no storage)', () => {
    const first = getOrCreateVisitorId()
    __resetWebSdkIdentityForTests()
    const second = getOrCreateVisitorId()
    expect(first).not.toBe(second)
  })
})

describe('generateId fallback when crypto.randomUUID is unavailable', () => {
  it('still produces a non-empty, unique-looking id', () => {
    // globalThis.crypto is a getter-only property in this Node runtime —
    // a direct assignment throws. vi.stubGlobal is the vitest-provided
    // way to override a read-only global for one test.
    vi.stubGlobal('crypto', {}) // simulates an older browser: crypto exists, randomUUID does not
    try {
      const id = getOrCreateVisitorId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
