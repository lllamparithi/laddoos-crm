import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initYaliWebSdk } from './index'
import { __resetWebSdkIdentityForTests } from './identity'

beforeEach(() => {
  __resetWebSdkIdentityForTests()
})

describe('initYaliWebSdk', () => {
  it('returns stable ids across calls on the same instance', () => {
    const sdk = initYaliWebSdk()
    expect(sdk.getVisitorId()).toBe(sdk.getVisitorId())
    expect(sdk.getSessionId()).toBe(sdk.getSessionId())
  })

  it('threads apiBaseUrl and fetchImpl through to trackPageView', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    const sdk = initYaliWebSdk({ apiBaseUrl: 'https://admin.laddoosdotcom.in', fetchImpl })

    await sdk.trackPageView({ path: '/products/x' })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.laddoosdotcom.in/api/web-events',
      expect.anything()
    )
  })

  it('threads config through to resolveContinuationFromUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    const sdk = initYaliWebSdk({ apiBaseUrl: 'https://admin.laddoosdotcom.in', fetchImpl })

    const result = await sdk.resolveContinuationFromUrl({ url: 'https://laddoos.com/?yali_ref=v1.a.b' })

    expect(result).toEqual({ present: true, resolved: false })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('https://admin.laddoosdotcom.in/api/continuation-tokens/resolve')
    // The SDK supplies the visitor id by default so linking works without
    // the integrator having to know about it — in the header, not the URL.
    const sentHeaders = (init as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined
    expect(sentHeaders?.['x-yali-visitor-id']).toBeTruthy()
    expect(url).not.toContain('x-yali-visitor-id')
    expect(url).not.toContain(sentHeaders?.['x-yali-visitor-id'] ?? '__never__')
  })

  it('exposes trackCtaClick as the same documented stub', async () => {
    const sdk = initYaliWebSdk()
    await expect(sdk.trackCtaClick()).resolves.toBe(false)
  })
})
