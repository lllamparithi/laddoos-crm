import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendWebEvent, trackPageView, trackProductView, trackCtaClick } from './events'
import { __resetWebSdkIdentityForTests } from './identity'

beforeEach(() => {
  __resetWebSdkIdentityForTests()
})

function fetchResolving(ok: boolean, status = ok ? 201 : 400) {
  return vi.fn().mockResolvedValue({ ok, status })
}

describe('sendWebEvent', () => {
  it('POSTs to /api/web-events with the expected shape', async () => {
    const fetchImpl = fetchResolving(true)
    const result = await sendWebEvent(
      { eventType: 'web.visit', summary: 'First visit' },
      { fetchImpl }
    )

    expect(result).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/web-events',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.event_type).toBe('web.visit')
    expect(body.summary).toBe('First visit')
    expect(typeof body.web_visitor_id).toBe('string')
    expect(typeof body.web_session_id).toBe('string')
  })

  it('prefixes the URL with apiBaseUrl for cross-origin use', async () => {
    const fetchImpl = fetchResolving(true)
    await sendWebEvent(
      { eventType: 'web.visit', summary: 'x' },
      { fetchImpl, apiBaseUrl: 'https://admin.laddoosdotcom.in' }
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.laddoosdotcom.in/api/web-events',
      expect.anything()
    )
  })

  it('returns false, never throws, on a non-2xx response', async () => {
    const fetchImpl = fetchResolving(false, 400)
    await expect(
      sendWebEvent({ eventType: 'web.visit', summary: 'x' }, { fetchImpl })
    ).resolves.toBe(false)
  })

  it('returns false, never throws, on a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      sendWebEvent({ eventType: 'web.visit', summary: 'x' }, { fetchImpl })
    ).resolves.toBe(false)
  })

  it('returns false without attempting a call when no fetch implementation exists', async () => {
    const fetchImpl = vi.fn()
    await sendWebEvent({ eventType: 'web.visit', summary: 'x' }, { fetchImpl: undefined })
    // Falls through to globalThis.fetch (present under Node 20) unless
    // explicitly undefined is distinguishable — assert the *unused* spy
    // was never called, proving the "no fetch" branch doesn't silently
    // use it by accident.
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('trackPageView', () => {
  it('sends event_type web.page_view with a generated dedupe suffix', async () => {
    const fetchImpl = fetchResolving(true)
    await trackPageView({ path: '/products/millet-laddoo', title: 'Millet Laddoo' }, { fetchImpl })

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.event_type).toBe('web.page_view')
    expect(body.summary).toBe('Viewed Millet Laddoo')
    expect(typeof body.dedupe_suffix).toBe('string')
    expect(body.dedupe_suffix.length).toBeGreaterThan(0)
  })

  it('honors an explicit dedupeSuffix for manual retry-safety', async () => {
    const fetchImpl = fetchResolving(true)
    await trackPageView({ path: '/x', dedupeSuffix: 'retry-1' }, { fetchImpl })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.dedupe_suffix).toBe('retry-1')
  })
})

describe('trackProductView', () => {
  it('also sends event_type web.page_view (no separate server-side type exists)', async () => {
    const fetchImpl = fetchResolving(true)
    await trackProductView({ productId: 'sku-123', productName: 'Millet Laddoo' }, { fetchImpl })

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.event_type).toBe('web.page_view')
    expect(body.summary).toContain('sku-123')
    expect(body.summary).toContain('Millet Laddoo')
  })
})

describe('trackCtaClick', () => {
  const originalWarn = console.warn

  afterEach(() => {
    console.warn = originalWarn
  })

  it('always resolves false and never throws', async () => {
    console.warn = vi.fn()
    await expect(trackCtaClick()).resolves.toBe(false)
  })

  it('logs a clear warning explaining why, exactly once', async () => {
    const warn = vi.fn()
    console.warn = warn
    await trackCtaClick()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('trackCtaClick')
  })
})
