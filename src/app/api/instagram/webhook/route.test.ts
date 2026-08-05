import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(() => ({ name: 'admin-client' })),
  resolveSingleAccountWorkspaceContext: vi.fn(),
  recordIdentityHandle: vi.fn(),
  recordInstagramMessageEvent: vi.fn(),
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
}))

vi.mock('@/lib/timeline/ingest', () => ({
  recordInstagramMessageEvent: mocks.recordInstagramMessageEvent,
}))

// verifyMetaWebhookSignature itself is NOT mocked — the whole point of
// these POST tests is proving the route enforces a real signature.

import { GET, POST } from './route'

const SECRET = process.env.META_APP_SECRET!

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hex}`
}

function postRequest(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signature) headers['x-hub-signature-256'] = signature
  return new Request('http://localhost/api/instagram/webhook', {
    method: 'POST',
    headers,
    body,
  })
}

beforeEach(() => {
  mocks.supabaseAdmin.mockClear()
  mocks.resolveSingleAccountWorkspaceContext.mockReset()
  mocks.recordIdentityHandle.mockReset()
  mocks.recordInstagramMessageEvent.mockReset()
  mocks.resolveSingleAccountWorkspaceContext.mockResolvedValue({
    accountId: 'account-1',
    tenantId: 'tenant-1',
    brandId: 'brand-1',
  })
  mocks.recordIdentityHandle.mockResolvedValue({ id: 'handle-1' })
  mocks.recordInstagramMessageEvent.mockResolvedValue({ id: 'event-1' })
})

describe('GET /api/instagram/webhook', () => {
  function verifyUrl(params: Record<string, string>) {
    const url = new URL('http://localhost/api/instagram/webhook')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return new Request(url)
  }

  it('echoes the challenge when the verify token matches META_APP_SECRET', async () => {
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': SECRET })
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc123')
  })

  it('rejects a wrong verify token', async () => {
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': 'wrong' })
    )
    expect(response.status).toBe(403)
  })

  it('rejects a request missing required params', async () => {
    const response = await GET(verifyUrl({ 'hub.mode': 'subscribe' }))
    expect(response.status).toBe(400)
  })
})

describe('POST /api/instagram/webhook', () => {
  const messagingPayload = JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: 'ig-account-1',
        time: 1735689600000,
        messaging: [
          {
            sender: { id: 'igsid-123' },
            recipient: { id: 'ig-account-1' },
            timestamp: 1735689600000,
            message: { mid: 'mid-1', text: 'Do you ship to Coimbatore?' },
          },
        ],
      },
    ],
  })

  it('rejects an invalid signature and never calls the identity/timeline helpers', async () => {
    const response = await POST(postRequest(messagingPayload, 'sha256=deadbeef'))
    expect(response.status).toBe(403)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header', async () => {
    const response = await POST(postRequest(messagingPayload, null))
    expect(response.status).toBe(403)
  })

  it('records a handle then an inbound message event for a validly-signed message', async () => {
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(1)
    expect(mocks.recordIdentityHandle).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ handleType: 'instagram_scoped_id', handleValue: 'igsid-123' })
    )
    expect(mocks.recordInstagramMessageEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({
        direction: 'inbound',
        igMessageId: 'mid-1',
        handleId: 'handle-1',
        summary: 'Do you ship to Coimbatore?',
      })
    )
  })

  it('acknowledges but skips a payload for a different object type', async () => {
    const other = JSON.stringify({ object: 'page', entry: [] })
    const response = await POST(postRequest(other, signedHeader(other)))
    expect(response.status).toBe(200)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('skips echoes of our own outbound messages', async () => {
    const echoPayload = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-account-1' },
              recipient: { id: 'igsid-123' },
              message: { mid: 'mid-2', text: 'Yes we ship nationwide', is_echo: true },
            },
          ],
        },
      ],
    })
    const response = await POST(postRequest(echoPayload, signedHeader(echoPayload)))
    const body = await response.json()
    expect(body.recorded).toBe(0)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('acknowledges Meta even when workspace context is not configured, rather than causing a retry storm', async () => {
    const { WorkspaceContextError } = await import('@/lib/identity/workspace-context')
    mocks.resolveSingleAccountWorkspaceContext.mockRejectedValue(
      new WorkspaceContextError('not configured', 503)
    )
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    expect(response.status).toBe(200)
  })
})
