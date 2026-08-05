import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseAllowedOrigins, allowedOriginFor, withCors, preflightResponse } from './cors'

const ALLOW = 'https://laddoos.com,https://www.laddoos.com'

function req(origin?: string): Request {
  return new Request('http://localhost/api/web-events', {
    method: 'POST',
    headers: origin ? { origin } : {},
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseAllowedOrigins', () => {
  it('is empty when the env var is unset or blank — fail closed by default', () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0)
    expect(parseAllowedOrigins('').size).toBe(0)
    expect(parseAllowedOrigins('   ').size).toBe(0)
  })

  it('parses a comma-separated list and tolerates whitespace', () => {
    const origins = parseAllowedOrigins(' https://a.com , https://b.com ')
    expect([...origins]).toEqual(['https://a.com', 'https://b.com'])
  })

  it('normalises trailing slashes, paths, and host casing to a bare origin', () => {
    const origins = parseAllowedOrigins('https://laddoos.com/,https://WWW.Laddoos.com/some/path')
    expect([...origins]).toEqual(['https://laddoos.com', 'https://www.laddoos.com'])
  })

  it('keeps the port as part of the origin', () => {
    expect([...parseAllowedOrigins('http://localhost:3000')]).toEqual(['http://localhost:3000'])
  })

  it('drops unparseable entries instead of throwing, keeping the valid ones', () => {
    const origins = parseAllowedOrigins('not-a-url,https://good.com,,://also-bad')
    expect([...origins]).toEqual(['https://good.com'])
  })
})

describe('allowedOriginFor', () => {
  it('returns the origin when it is on the allow-list', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(allowedOriginFor(req('https://laddoos.com'))).toBe('https://laddoos.com')
  })

  it('returns null for an origin that is not on the allow-list', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(allowedOriginFor(req('https://evil.example'))).toBeNull()
  })

  it('returns null when no Origin header is present (same-origin GET, curl, server-side)', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(allowedOriginFor(req())).toBeNull()
  })

  it('never trusts the literal "null" origin, even if someone lists it', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', 'null')
    expect(allowedOriginFor(req('null'))).toBeNull()
  })

  it('returns null for every origin when the env var is unset — fail closed', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', '')
    expect(allowedOriginFor(req('https://laddoos.com'))).toBeNull()
  })

  it('does not match a different scheme or port on an allowed host', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', 'https://laddoos.com')
    expect(allowedOriginFor(req('http://laddoos.com'))).toBeNull()
    expect(allowedOriginFor(req('https://laddoos.com:8443'))).toBeNull()
  })

  it('does not match a subdomain or a suffix of an allowed origin', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', 'https://laddoos.com')
    expect(allowedOriginFor(req('https://evil.laddoos.com'))).toBeNull()
    expect(allowedOriginFor(req('https://laddoos.com.evil.example'))).toBeNull()
  })
})

describe('withCors', () => {
  it('sets Access-Control-Allow-Origin to the exact origin, never "*"', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = withCors(req('https://laddoos.com'), new Response('{}', { status: 201 }))
    expect(response.headers.get('access-control-allow-origin')).toBe('https://laddoos.com')
  })

  it('omits Access-Control-Allow-Origin for a disallowed origin but still returns the response', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = withCors(req('https://evil.example'), new Response('{}', { status: 201 }))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    // Fail-closed means the browser can't READ it — not that we reject
    // the request. Rejecting would break same-origin POSTs, which also
    // carry an Origin header. See src/lib/cors.ts's header comment.
    expect(response.status).toBe(201)
  })

  it('leaves a same-origin request (no Origin header) completely unchanged apart from Vary', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = withCors(req(), new Response('{}', { status: 201 }))
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.status).toBe(201)
  })

  it('always sets Vary: Origin, allowed or not, so caches never cross the two responses', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(withCors(req('https://laddoos.com'), new Response()).headers.get('vary')).toContain(
      'Origin'
    )
    expect(withCors(req('https://evil.example'), new Response()).headers.get('vary')).toContain(
      'Origin'
    )
    expect(withCors(req(), new Response()).headers.get('vary')).toContain('Origin')
  })

  it('never sets Access-Control-Allow-Credentials', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = withCors(req('https://laddoos.com'), new Response())
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('preserves the status and body of whatever it wraps (e.g. a 429)', async () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const rateLimited = new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Retry-After': '42' },
    })
    const response = withCors(req('https://laddoos.com'), rateLimited)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(response.headers.get('access-control-allow-origin')).toBe('https://laddoos.com')
    expect(await response.json()).toEqual({ error: 'Rate limit exceeded' })
  })
})

describe('preflightResponse', () => {
  it('returns 204 with the full CORS header set for an allowed origin', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = preflightResponse(req('https://laddoos.com'), 'POST')
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://laddoos.com')
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type')
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('reflects the route method it was given', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(
      preflightResponse(req('https://laddoos.com'), 'GET').headers.get('access-control-allow-methods')
    ).toBe('GET, OPTIONS')
  })

  it('403s a disallowed origin — a preflight can only ever be cross-origin', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const response = preflightResponse(req('https://evil.example'), 'POST')
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('403s a preflight with no Origin header at all', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    expect(preflightResponse(req(), 'POST').status).toBe(403)
  })

  it('403s every origin when the allow-list is unconfigured — fail closed', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', '')
    expect(preflightResponse(req('https://laddoos.com'), 'POST').status).toBe(403)
  })

  it('does not allow arbitrary request headers through', () => {
    vi.stubEnv('YALI_WEB_SDK_ALLOWED_ORIGINS', ALLOW)
    const request = new Request('http://localhost/api/web-events', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://laddoos.com',
        'access-control-request-headers': 'x-api-key, authorization',
      },
    })
    // The allowed set is fixed, never a reflection of what was asked for.
    expect(preflightResponse(request, 'POST').headers.get('access-control-allow-headers')).toBe(
      'Content-Type'
    )
  })
})
