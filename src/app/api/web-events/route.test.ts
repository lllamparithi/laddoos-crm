import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(() => ({ name: 'admin-client' })),
  resolveSingleAccountWorkspaceContext: vi.fn(),
  recordIdentityHandle: vi.fn(),
  recordWebEvent: vi.fn(),
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

vi.mock('@/lib/identity/handles', () => ({
  recordIdentityHandle: mocks.recordIdentityHandle,
  IdentityHandleError: class IdentityHandleError extends Error {
    status: number
    constructor(message: string, status = 500) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('@/lib/timeline/ingest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timeline/ingest')>(
    '@/lib/timeline/ingest'
  )
  return { ...actual, recordWebEvent: mocks.recordWebEvent }
})

vi.mock('@/lib/timeline/events', () => ({
  TimelineEventError: class TimelineEventError extends Error {
    status: number
    constructor(message: string, status = 500) {
      super(message)
      this.status = status
    }
  },
}))

import { OPTIONS, POST } from './route'

function request(body: unknown, origin?: string) {
  return new Request('http://localhost/api/web-events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  })
}

const validBody = {
  event_type: 'web.visit',
  web_visitor_id: 'visitor-abc',
  web_session_id: 'session-abc',
  summary: 'First visit',
}

beforeEach(() => {
  __resetRateLimitForTests()
  mocks.resolveSingleAccountWorkspaceContext.mockReset()
  mocks.recordIdentityHandle.mockReset()
  mocks.recordWebEvent.mockReset()
  mocks.resolveSingleAccountWorkspaceContext.mockResolvedValue({
    accountId: 'account-1',
    tenantId: 'tenant-1',
    brandId: 'brand-1',
  })
  mocks.recordIdentityHandle.mockResolvedValue({ id: 'handle-1' })
  mocks.recordWebEvent.mockResolvedValue({ id: 'event-1' })
})

describe('POST /api/web-events', () => {
  it('rejects an unknown event_type before touching the database', async () => {
    const response = await POST(request({ ...validBody, event_type: 'web.made_up' }))
    expect(response.status).toBe(400)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('rejects a missing web_visitor_id', async () => {
    const response = await POST(request({ ...validBody, web_visitor_id: undefined }))
    expect(response.status).toBe(400)
  })

  it('records the handle then the event, in that order, and returns 201', async () => {
    const response = await POST(request(validBody))
    const body = await response.json()

    expect(response.status).toBe(201)
    // Exactly `{ ok: true }` — toEqual, not objectContaining, so any future
    // change that starts leaking internal ids back to this anonymous caller
    // fails here instead of shipping. The ids are still asserted below, but
    // on the SERVICE calls, which is where they legitimately belong.
    expect(body).toEqual({ ok: true })
    expect(mocks.recordIdentityHandle).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ accountId: 'account-1', handleType: 'web_visitor_id' })
    )
    expect(mocks.recordWebEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ handleId: 'handle-1', eventType: 'web.visit' })
    )
  })

  it('never sends the raw web_visitor_id as handleHash — it is sha256-hashed', async () => {
    await POST(request(validBody))
    const call = mocks.recordIdentityHandle.mock.calls[0][1]
    expect(call.handleHash).not.toBe('visitor-abc')
    expect(call.handleHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects after the per-IP rate limit is exhausted', async () => {
    let last: Response | undefined
    for (let i = 0; i < 121; i++) {
      last = await POST(request(validBody))
    }
    expect(last?.status).toBe(429)
  })
})

describe('POST /api/web-events — CORS', () => {
  const ALLOWED = 'https://laddoos.com'

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows a cross-origin POST from an allow-listed origin and still writes the event', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await POST(request(validBody, ALLOWED))

    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(mocks.recordWebEvent).toHaveBeenCalled()
  })

  it('withholds the CORS header from a disallowed origin — the browser blocks the read', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await POST(request(validBody, 'https://evil.example'))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('leaves same-origin behaviour unchanged — no Origin header, no CORS header, still 201', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await POST(request(validBody))

    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual({ ok: true })
  })

  it('still works same-origin when the allow-list is unset entirely', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', '')
    const response = await POST(request(validBody))

    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('carries the CORS header on the 429, so a throttled cross-origin caller sees the 429', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    let last: Response | undefined
    for (let i = 0; i < 121; i++) {
      last = await POST(request(validBody, ALLOWED))
    }

    expect(last?.status).toBe(429)
    expect(last?.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('carries the CORS header on a 400, so a validation error is readable cross-origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await POST(request({ ...validBody, event_type: 'web.made_up' }, ALLOWED))

    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('answers the preflight with 204 for an allowed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await OPTIONS(
      new Request('http://localhost/api/web-events', {
        method: 'OPTIONS',
        headers: { origin: ALLOWED, 'access-control-request-method': 'POST' },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    // preflightResponse advertises one fixed list for both Phase 2A
    // endpoints. This route only sends Content-Type; the visitor-id entry
    // is there for continuation-resolve. Advertising it is inert — an
    // allow-list permits a header, it does not require or read one.
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Content-Type, x-yali-visitor-id'
    )
  })

  it('403s the preflight for a disallowed origin', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOWED)
    const response = await OPTIONS(
      new Request('http://localhost/api/web-events', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
