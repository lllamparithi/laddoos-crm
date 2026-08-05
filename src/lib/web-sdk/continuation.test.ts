import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readContinuationRefFromUrl,
  stripContinuationRefFromUrl,
  resolveContinuationFromUrl,
} from './continuation'

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

function fakeWindow(href: string) {
  const state = { href }
  const win = {
    location: {
      get href() {
        return state.href
      },
    },
    history: {
      state: null,
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        state.href = url
      }),
    },
  }
  ;(globalThis as unknown as { window: typeof win }).window = win
  return win
}

describe('readContinuationRefFromUrl', () => {
  it('reads yali_ref from an explicit url', () => {
    expect(
      readContinuationRefFromUrl({ url: 'https://laddoos.com/products/x?yali_ref=v1.abc.def' })
    ).toBe('v1.abc.def')
  })

  it('returns null when the param is absent', () => {
    expect(readContinuationRefFromUrl({ url: 'https://laddoos.com/products/x' })).toBeNull()
  })

  it('returns null with neither an explicit url nor a window', () => {
    expect(readContinuationRefFromUrl()).toBeNull()
  })

  it('falls back to window.location.href when no explicit url is given', () => {
    fakeWindow('https://laddoos.com/?yali_ref=v1.from-window.sig')
    expect(readContinuationRefFromUrl()).toBe('v1.from-window.sig')
  })

  it('supports a custom param name', () => {
    expect(
      readContinuationRefFromUrl({
        url: 'https://laddoos.com/?custom_ref=v1.x.y',
        paramName: 'custom_ref',
      })
    ).toBe('v1.x.y')
  })

  it('returns null for a malformed url rather than throwing', () => {
    expect(() => readContinuationRefFromUrl({ url: 'not a url' })).not.toThrow()
    expect(readContinuationRefFromUrl({ url: 'not a url' })).toBeNull()
  })
})

describe('stripContinuationRefFromUrl', () => {
  it('does nothing when there is no window', () => {
    expect(() => stripContinuationRefFromUrl()).not.toThrow()
  })

  it('removes the param via history.replaceState when present', () => {
    const win = fakeWindow('https://laddoos.com/products/x?yali_ref=v1.abc.def&other=1')
    stripContinuationRefFromUrl()
    expect(win.history.replaceState).toHaveBeenCalledTimes(1)
    expect(win.location.href).not.toContain('yali_ref')
    expect(win.location.href).toContain('other=1')
  })

  it('is a no-op when the param is not present', () => {
    const win = fakeWindow('https://laddoos.com/products/x')
    stripContinuationRefFromUrl()
    expect(win.history.replaceState).not.toHaveBeenCalled()
  })
})

describe('resolveContinuationFromUrl', () => {
  it('returns { present: false } and never calls fetch when no ref is in the URL', async () => {
    const fetchImpl = vi.fn()
    const result = await resolveContinuationFromUrl({
      url: 'https://laddoos.com/products/x',
      fetchImpl,
    })
    expect(result).toEqual({ present: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns { present: true, resolved: false } on a non-ok HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const result = await resolveContinuationFromUrl({
      url: 'https://laddoos.com/x?yali_ref=v1.bad.ref',
      fetchImpl,
    })
    expect(result).toEqual({ present: true, resolved: false })
  })

  it('returns { present: true, resolved: false } when the body says ok: false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    const result = await resolveContinuationFromUrl({
      url: 'https://laddoos.com/x?yali_ref=v1.bad.ref',
      fetchImpl,
    })
    expect(result).toEqual({ present: true, resolved: false })
  })

  it('returns { present: true, resolved: false } on a network error, never throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      resolveContinuationFromUrl({ url: 'https://laddoos.com/x?yali_ref=v1.a.b', fetchImpl })
    ).resolves.toEqual({ present: true, resolved: false })
  })

  it('returns the scoped data on success, and never leaks token_hash/id even if the server response contained them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        id: 'token-1', // must never appear in the outcome
        token_hash: 'super-secret-hash', // must never appear in the outcome
        purpose: 'ig_to_web',
        origin_conversation_id: 'conv-1',
        origin_contact_id: null,
        origin_handle_id: 'handle-1',
        campaign_id: 'camp-1',
        ad_id: null,
        creative_id: null,
        binds_identity: true,
        is_first_use: true,
      }),
    })
    const result = await resolveContinuationFromUrl({
      url: 'https://laddoos.com/x?yali_ref=v1.good.ref',
      fetchImpl,
    })
    expect(result.present).toBe(true)
    if (result.present && result.resolved) {
      expect(result.data.purpose).toBe('ig_to_web')
      expect(result.data.isFirstUse).toBe(true)
      expect(JSON.stringify(result.data)).not.toContain('super-secret-hash')
      expect(JSON.stringify(result.data)).not.toContain('token-1')
    } else {
      throw new Error('expected resolved: true')
    }
  })

  it('calls the resolve endpoint with the ref URL-encoded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    await resolveContinuationFromUrl({
      url: 'https://laddoos.com/x?yali_ref=v1.a%2Fb.sig',
      fetchImpl,
      apiBaseUrl: 'https://admin.laddoosdotcom.in',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('https://admin.laddoosdotcom.in/api/continuation-tokens/resolve?ref=')
    )
  })

  it('strips the ref from the address bar by default when a window is present', async () => {
    const win = fakeWindow('https://laddoos.com/x?yali_ref=v1.a.b')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    await resolveContinuationFromUrl({ fetchImpl })
    expect(win.history.replaceState).toHaveBeenCalledTimes(1)
  })

  it('does not strip the ref when stripFromUrl is explicitly false', async () => {
    const win = fakeWindow('https://laddoos.com/x?yali_ref=v1.a.b')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    await resolveContinuationFromUrl({ fetchImpl, stripFromUrl: false })
    expect(win.history.replaceState).not.toHaveBeenCalled()
  })
})
