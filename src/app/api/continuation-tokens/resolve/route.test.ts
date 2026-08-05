import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(() => ({ name: 'admin-client' })),
  resolveSingleAccountWorkspaceContext: vi.fn(),
  resolveContinuationToken: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.supabaseAdmin }))

vi.mock('@/lib/identity/workspace-context', () => ({
  resolveSingleAccountWorkspaceContext: mocks.resolveSingleAccountWorkspaceContext,
  WorkspaceContextError: class WorkspaceContextError extends Error {
    status: number
    constructor(message: string, status = 503) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('@/lib/continuation/service', () => ({
  resolveContinuationToken: mocks.resolveContinuationToken,
  ContinuationServiceError: class ContinuationServiceError extends Error {
    status: number
    constructor(message: string, status = 500) {
      super(message)
      this.status = status
    }
  },
}))

import { GET, OPTIONS } from './route'

function request(query: string, origin?: string) {
  return new Request(`http://localhost/api/continuation-tokens/resolve${query}`, {
    headers: {
      'x-forwarded-for': '203.0.113.7',
      ...(origin ? { origin } : {}),
    },
  })
}

beforeEach(() => {
  __resetRateLimitForTests()
  mocks.resolveSingleAccountWorkspaceContext.mockReset()
  mocks.resolveContinuationToken.mockReset()
  mocks.resolveSingleAccountWorkspaceContext.mockResolvedValue({
    accountId: 'account-1',
    tenantId: 'tenant-1',
    brandId: 'brand-1',
  })
})

describe('GET /api/continuation-tokens/resolve', () => {
  it('returns 400 when ref is missing, without calling the service', async () => {
    const response = await GET(request(''))
    expect(response.status).toBe(400)
    expect(mocks.resolveContinuationToken).not.toHaveBeenCalled()
  })

  it('returns a uniform 404 { ok: false } for any failed resolution', async () => {
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    const response = await GET(request('?ref=v1.bad.ref'))
    const body = await response.json()
    expect(response.status).toBe(404)
    expect(body).toEqual({ ok: false })
  })

  it('returns 200 with the token fields, and never token_hash, on success', async () => {
    mocks.resolveContinuationToken.mockResolvedValue({
      ok: true,
      token: {
        id: 'token-1',
        purpose: 'ig_to_web',
        originChannel: 'instagram',
        originConversationId: 'conv-1',
        originContactId: null,
        originHandleId: 'handle-1',
        campaignId: 'camp-1',
        adId: null,
        creativeId: null,
        bindsIdentity: true,
        isFirstUse: true,
      },
    })

    const response = await GET(request('?ref=v1.good.ref'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.is_first_use).toBe(true)
    expect(body.campaign_id).toBe('camp-1')
    expect(body.token_hash).toBeUndefined()
    expect(body.id).toBeUndefined() // internal row id is not exposed either
  })

  it('rejects after the per-IP rate limit is exhausted', async () => {
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    let last: Response | undefined
    for (let i = 0; i < 31; i++) {
      last = await GET(request('?ref=v1.x.y'))
    }
    expect(last?.status).toBe(429)
  })

  it('maps a workspace-context error to its own status without touching token validity', async () => {
    const { WorkspaceContextError } = await import('@/lib/identity/workspace-context')
    mocks.resolveSingleAccountWorkspaceContext.mockRejectedValue(
      new WorkspaceContextError('not configured', 503)
    )
    const response = await GET(request('?ref=v1.a.b'))
    expect(response.status).toBe(503)
    expect(mocks.resolveContinuationToken).not.toHaveBeenCalled()
  })
})

describe('GET /api/continuation-tokens/resolve — CORS', () => {
  const ALLOWED = 'https://laddoos.com'

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows a cross-origin GET from an allow-listed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    const response = await GET(request('?ref=v1.a.b', ALLOWED))

    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('withholds the CORS header from a disallowed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    const response = await GET(request('?ref=v1.a.b', 'https://evil.example'))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('leaves same-origin behaviour unchanged — the uniform 404 is byte-identical', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    const response = await GET(request('?ref=v1.a.b'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ ok: false })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('does not leak WHY a resolution failed through the CORS headers', async () => {
    // The whole point of this endpoint is that every failure looks
    // identical on the wire. Adding CORS must not create a new signal:
    // an allowed origin's headers must be the same for a failed
    // resolution and a service-unconfigured error.
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)

    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    const failed = await GET(request('?ref=v1.a.b', ALLOWED))

    const { ContinuationServiceError } = await import('@/lib/continuation/service')
    mocks.resolveContinuationToken.mockRejectedValue(
      new ContinuationServiceError('signing key missing', 503)
    )
    const unconfigured = await GET(request('?ref=v1.c.d', ALLOWED))

    expect(failed.headers.get('access-control-allow-origin')).toBe(
      unconfigured.headers.get('access-control-allow-origin')
    )
    expect(failed.headers.get('vary')).toBe(unconfigured.headers.get('vary'))
  })

  it('carries the CORS header on the 429', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    mocks.resolveContinuationToken.mockResolvedValue({ ok: false })
    let last: Response | undefined
    for (let i = 0; i < 31; i++) {
      last = await GET(request('?ref=v1.x.y', ALLOWED))
    }

    expect(last?.status).toBe(429)
    expect(last?.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('answers the preflight with 204 and GET, OPTIONS for an allowed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await OPTIONS(
      new Request('http://localhost/api/continuation-tokens/resolve', {
        method: 'OPTIONS',
        headers: { origin: ALLOWED },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
  })

  it('403s the preflight for a disallowed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await OPTIONS(
      new Request('http://localhost/api/continuation-tokens/resolve', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      })
    )

    expect(response.status).toBe(403)
  })
})
