import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveWorkspaceBrandForAccount: vi.fn(),
  issueContinuationToken: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/identity/workspace-context', () => ({
  resolveWorkspaceBrandForAccount: mocks.resolveWorkspaceBrandForAccount,
  WorkspaceContextError: class WorkspaceContextError extends Error {
    status: number
    constructor(message: string, status = 503) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('@/lib/continuation/service', () => ({
  issueContinuationToken: mocks.issueContinuationToken,
  ContinuationServiceError: class ContinuationServiceError extends Error {
    status: number
    constructor(message: string, status = 500) {
      super(message)
      this.status = status
    }
  },
}))

import { POST } from './route'

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
}

function request(body: unknown) {
  return new Request('http://localhost/api/continuation-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.resolveWorkspaceBrandForAccount.mockReset()
  mocks.issueContinuationToken.mockReset()
  mocks.requireRole.mockResolvedValue(context)
  mocks.resolveWorkspaceBrandForAccount.mockResolvedValue({
    tenantId: 'tenant-1',
    brandId: 'brand-1',
  })
})

describe('POST /api/continuation-tokens', () => {
  it('requires an authenticated agent', async () => {
    await POST(request({}))
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
  })

  it('always issues with purpose "ig_to_web", regardless of what the body asks for', async () => {
    mocks.issueContinuationToken.mockResolvedValue({
      ref: 'v1.abc.def',
      id: 'token-1',
      expiresAt: '2026-01-08T00:00:00.000Z',
    })

    await POST(request({ purpose: 'web_to_wa', campaign_id: 'camp-1' }))

    expect(mocks.issueContinuationToken).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        accountId: 'account-1',
        tenantId: 'tenant-1',
        brandId: 'brand-1',
        purpose: 'ig_to_web',
        originChannel: 'instagram',
        campaignId: 'camp-1',
      })
    )
  })

  it('returns 201 with the ref and expiry, never the token_hash', async () => {
    mocks.issueContinuationToken.mockResolvedValue({
      ref: 'v1.abc.def',
      id: 'token-1',
      expiresAt: '2026-01-08T00:00:00.000Z',
    })

    const response = await POST(request({}))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual({ ref: 'v1.abc.def', expires_at: '2026-01-08T00:00:00.000Z' })
    expect(body.token_hash).toBeUndefined()
  })

  it('maps a WorkspaceContextError to its own status', async () => {
    const { WorkspaceContextError } = await import('@/lib/identity/workspace-context')
    mocks.resolveWorkspaceBrandForAccount.mockRejectedValue(
      new WorkspaceContextError('not configured', 503)
    )

    const response = await POST(request({}))
    expect(response.status).toBe(503)
  })
})
