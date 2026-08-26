import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(() => ({ name: 'admin-client' })),
  resolveSingleAccountWorkspaceContext: vi.fn(),
  recordIdentityHandle: vi.fn(),
  recordMessengerMessageEvent: vi.fn(),
  projectTimelineEventToThread: vi.fn(),
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
  recordMessengerMessageEvent: mocks.recordMessengerMessageEvent,
}))

vi.mock('@/lib/inbox/channel-threads', () => ({
  projectTimelineEventToThread: mocks.projectTimelineEventToThread,
}))

// verifyMetaWebhookSignature is deliberately NOT mocked — these POST
// tests exist to prove the route enforces a real signature.

import { GET, POST } from './route'

// Two distinct secrets, separated by purpose. APP_SECRET signs POST
// bodies (HMAC); VERIFY_TOKEN answers the GET handshake. The tests below
// assert neither can stand in for the other.
const APP_SECRET = process.env.META_APP_SECRET!
const VERIFY_TOKEN = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN!
const SENDER_ID = 'psid-123'
const TIMESTAMP = 1735689600000

// Guards the whole file: if these ever become the same literal, the
// separation tests would pass vacuously.
if (APP_SECRET === VERIFY_TOKEN) {
  throw new Error(
    'META_APP_SECRET and MESSENGER_WEBHOOK_VERIFY_TOKEN must differ in the ' +
      'test env, or the secret-separation assertions prove nothing'
  )
}

function signedHeader(body: string, secret: string = APP_SECRET): string {
  const hex = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hex}`
}

function postRequest(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signature) headers['x-hub-signature-256'] = signature
  return new Request('http://localhost/api/messenger/webhook', {
    method: 'POST',
    headers,
    body,
  })
}

/** A well-formed Page/Messenger delivery carrying one inbound text message. */
const messagingPayload = JSON.stringify({
  object: 'page',
  entry: [
    {
      id: 'page-1',
      time: TIMESTAMP,
      messaging: [
        {
          sender: { id: SENDER_ID },
          recipient: { id: 'page-1' },
          timestamp: TIMESTAMP,
          message: { mid: 'mid-1', text: 'Is the almond laddoo box available?' },
        },
      ],
    },
  ],
})

beforeEach(() => {
  mocks.supabaseAdmin.mockClear()
  mocks.resolveSingleAccountWorkspaceContext.mockReset()
  mocks.recordIdentityHandle.mockReset()
  mocks.recordMessengerMessageEvent.mockReset()
  mocks.resolveSingleAccountWorkspaceContext.mockResolvedValue({
    accountId: 'account-1',
    tenantId: 'tenant-1',
    brandId: 'brand-1',
  })
  mocks.projectTimelineEventToThread.mockReset()
  mocks.recordIdentityHandle.mockResolvedValue({ id: 'handle-1' })
  mocks.recordMessengerMessageEvent.mockResolvedValue({
    id: 'event-1',
    occurred_at: new Date(TIMESTAMP).toISOString(),
  })
  mocks.projectTimelineEventToThread.mockResolvedValue('thread-1')
})

// ── Handshake ────────────────────────────────────────────────

function verifyUrl(params: Record<string, string>) {
  const url = new URL('http://localhost/api/messenger/webhook')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/messenger/webhook — handshake', () => {
  it('echoes the challenge when the verify token matches MESSENGER_WEBHOOK_VERIFY_TOKEN', async () => {
    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': VERIFY_TOKEN,
      })
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

  it('rejects a verify token that only shares a prefix with the real one', async () => {
    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': VERIFY_TOKEN.slice(0, 4),
      })
    )
    expect(response.status).toBe(403)
  })

  it('rejects a request missing the verify token entirely', async () => {
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123' })
    )
    expect(response.status).toBe(400)
  })

  it('rejects an empty verify token', async () => {
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': '' })
    )
    expect(response.status).toBe(400)
  })

  it('rejects a request missing required params', async () => {
    const response = await GET(verifyUrl({ 'hub.mode': 'subscribe' }))
    expect(response.status).toBe(400)
  })

  it('rejects a mode other than subscribe', async () => {
    const response = await GET(
      verifyUrl({
        'hub.mode': 'unsubscribe',
        'hub.challenge': 'abc',
        'hub.verify_token': VERIFY_TOKEN,
      })
    )
    expect(response.status).toBe(400)
  })
})

// ── Secret separation (GET token vs POST HMAC key) ───────────

describe('GET /api/messenger/webhook — the App Secret is not a verify token', () => {
  it('rejects META_APP_SECRET presented as the verify token', async () => {
    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': APP_SECRET,
      })
    )
    expect(response.status).toBe(403)
  })

  // NOTE: these delete the variable with `undefined` rather than setting
  // it to ''. A `?? META_APP_SECRET` fallback is invisible to an
  // empty-string stub (nullish coalescing does not fire on ''), so an
  // '' stub would let the forbidden fallback pass undetected. Verified
  // by control: reintroducing the fallback fails the next test.
  it('does not fall back to META_APP_SECRET when the verify token variable is absent', async () => {
    vi.stubEnv('MESSENGER_WEBHOOK_VERIFY_TOKEN', undefined)
    expect(process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN).toBeUndefined()

    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': APP_SECRET,
      })
    )
    expect(response.status).toBe(403)
  })

  it('fails closed with a config error when the verify token variable is absent', async () => {
    vi.stubEnv('MESSENGER_WEBHOOK_VERIFY_TOKEN', undefined)
    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': VERIFY_TOKEN,
      })
    )
    expect(response.status).toBe(403)
    // Distinct from the mismatch case below — asserts the explicit
    // fail-closed branch ran, not that a comparison happened to fail.
    expect(await response.json()).toEqual({ error: 'Verification failed' })
  })

  it('reports a mismatch (not a config error) when the variable is set but the token is wrong', async () => {
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': 'wrong' })
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Verification token mismatch' })
  })

  it('fails closed when the verify token variable is set but empty', async () => {
    vi.stubEnv('MESSENGER_WEBHOOK_VERIFY_TOKEN', '')
    const response = await GET(
      verifyUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': 'x' })
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Verification failed' })
  })

  it('verifies the handshake without reading META_APP_SECRET at all', async () => {
    // GET must succeed with the App Secret removed entirely — the only
    // secret it may consult is the verify token.
    vi.stubEnv('META_APP_SECRET', undefined)
    const response = await GET(
      verifyUrl({
        'hub.mode': 'subscribe',
        'hub.challenge': 'abc123',
        'hub.verify_token': VERIFY_TOKEN,
      })
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc123')
  })
})

// ── Signature ────────────────────────────────────────────────

describe('POST /api/messenger/webhook — signature', () => {
  it('rejects an invalid signature and never calls the identity/timeline helpers', async () => {
    const response = await POST(postRequest(messagingPayload, 'sha256=deadbeef'))
    expect(response.status).toBe(403)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header', async () => {
    const response = await POST(postRequest(messagingPayload, null))
    expect(response.status).toBe(403)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const response = await POST(
      postRequest(messagingPayload, signedHeader(messagingPayload, 'not-the-app-secret'))
    )
    expect(response.status).toBe(403)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('rejects a body mutated after signing', async () => {
    const signature = signedHeader(messagingPayload)
    const tampered = messagingPayload.replace('mid-1', 'mid-tampered')
    const response = await POST(postRequest(tampered, signature))
    expect(response.status).toBe(403)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('rejects a body signed with the GET verify token instead of the App Secret', async () => {
    const response = await POST(
      postRequest(messagingPayload, signedHeader(messagingPayload, VERIFY_TOKEN))
    )
    expect(response.status).toBe(403)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('accepts an App-Secret-signed body while the GET verify token is absent', async () => {
    // POST must not depend on MESSENGER_WEBHOOK_VERIFY_TOKEN in any way.
    vi.stubEnv('MESSENGER_WEBHOOK_VERIFY_TOKEN', undefined)
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(1)
  })

  it('fails closed when META_APP_SECRET is absent, even with the verify token present', async () => {
    vi.stubEnv('META_APP_SECRET', undefined)
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    expect(response.status).toBe(403)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })
})

// ── Account mapping ──────────────────────────────────────────

describe('POST /api/messenger/webhook — account mapping', () => {
  it('derives account/tenant/brand server-side and passes them to both writes', async () => {
    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    expect(mocks.resolveSingleAccountWorkspaceContext).toHaveBeenCalledWith({
      name: 'admin-client',
    })
    expect(mocks.recordIdentityHandle).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ accountId: 'account-1' })
    )
    expect(mocks.recordMessengerMessageEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({
        accountId: 'account-1',
        tenantId: 'tenant-1',
        brandId: 'brand-1',
      })
    )
  })

  it('ignores any account/tenant/brand supplied in the request body', async () => {
    const hostile = JSON.stringify({
      object: 'page',
      account_id: 'attacker-account',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          account_id: 'attacker-account',
          messaging: [
            {
              sender: { id: SENDER_ID },
              timestamp: TIMESTAMP,
              account_id: 'attacker-account',
              tenant_id: 'attacker-tenant',
              channel: 'whatsapp',
              contact_id: 'attacker-contact',
              message: { mid: 'mid-1', text: 'hi' },
            },
          ],
        },
      ],
    })
    await POST(postRequest(hostile, signedHeader(hostile)))

    const handleArgs = mocks.recordIdentityHandle.mock.calls[0][1]
    const eventArgs = mocks.recordMessengerMessageEvent.mock.calls[0][1]

    expect(handleArgs.accountId).toBe('account-1')
    expect(handleArgs.channel).toBe('messenger')
    expect(eventArgs.accountId).toBe('account-1')
    expect(eventArgs.tenantId).toBe('tenant-1')
    expect(eventArgs.contactId).toBeUndefined()
  })

  it('acknowledges Meta without recording when workspace context is not configured', async () => {
    const { WorkspaceContextError } = await import('@/lib/identity/workspace-context')
    mocks.resolveSingleAccountWorkspaceContext.mockRejectedValue(
      new WorkspaceContextError('not configured', 503)
    )
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(0)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('records nothing if more than one account exists (resolver fails loudly)', async () => {
    const { WorkspaceContextError } = await import('@/lib/identity/workspace-context')
    mocks.resolveSingleAccountWorkspaceContext.mockRejectedValue(
      new WorkspaceContextError('Expected exactly one account; found 2', 500)
    )
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    expect(response.status).toBe(200)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })
})

// ── Write shape ──────────────────────────────────────────────

describe('POST /api/messenger/webhook — identity handle and timeline write shape', () => {
  it('records a messenger_scoped_id handle hashed from the sender id', async () => {
    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    expect(mocks.recordIdentityHandle).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({
        handleType: 'messenger_scoped_id',
        channel: 'messenger',
        handleValue: SENDER_ID,
        handleHash: crypto.createHash('sha256').update(SENDER_ID).digest('hex'),
      })
    )
  })

  it('never auto-links the handle to a contact', async () => {
    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    const handleArgs = mocks.recordIdentityHandle.mock.calls[0][1]
    expect(handleArgs.contactId).toBeUndefined()
    expect(handleArgs.confidence).toBeUndefined()
  })

  it('records an inbound timeline event carrying the handle and payload-derived time', async () => {
    const response = await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(1)
    expect(mocks.recordMessengerMessageEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({
        direction: 'inbound',
        messengerMessageId: 'mid-1',
        handleId: 'handle-1',
        summary: 'Is the almond laddoo box available?',
        occurredAt: new Date(TIMESTAMP),
        payloadRef: { messenger_sender_id: SENDER_ID },
      })
    )
  })

  it('projects the event into a messenger channel thread', async () => {
    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    expect(mocks.projectTimelineEventToThread).toHaveBeenCalledWith(
      { name: 'admin-client' },
      {
        accountId: 'account-1',
        channel: 'messenger',
        handleId: 'handle-1',
        occurredAt: new Date(TIMESTAMP),
      }
    )
  })

  it('projects AFTER the timeline write, so the canonical fact lands first', async () => {
    const order: string[] = []
    mocks.recordMessengerMessageEvent.mockImplementation(async () => {
      order.push('event')
      return { id: 'event-1', occurred_at: new Date(TIMESTAMP).toISOString() }
    })
    mocks.projectTimelineEventToThread.mockImplementation(async () => {
      order.push('projection')
      return 'thread-1'
    })

    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    expect(order).toEqual(['event', 'projection'])
  })

  it('never passes a contact to the projection', async () => {
    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))

    const args = mocks.projectTimelineEventToThread.mock.calls[0][1]
    expect(Object.keys(args)).not.toContain('contactId')
    expect(Object.keys(args)).not.toContain('contact_id')
  })

  it('does not project when the event is skipped (echo)', async () => {
    const echo = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            {
              sender: { id: 'page-1' },
              timestamp: TIMESTAMP,
              message: { mid: 'mid-echo', text: 'ours', is_echo: true },
            },
          ],
        },
      ],
    })
    await POST(postRequest(echo, signedHeader(echo)))
    expect(mocks.projectTimelineEventToThread).not.toHaveBeenCalled()
  })

  it('records the handle before the timeline event, so the event can carry handle_id', async () => {
    const order: string[] = []
    mocks.recordIdentityHandle.mockImplementation(async () => {
      order.push('handle')
      return { id: 'handle-1' }
    })
    mocks.recordMessengerMessageEvent.mockImplementation(async () => {
      order.push('event')
      return { id: 'event-1' }
    })

    await POST(postRequest(messagingPayload, signedHeader(messagingPayload)))
    expect(order).toEqual(['handle', 'event'])
  })

  it('summarises a non-text message rather than dropping it', async () => {
    const attachmentPayload = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            {
              sender: { id: SENDER_ID },
              timestamp: TIMESTAMP,
              message: { mid: 'mid-img', attachments: [{ type: 'image' }] },
            },
          ],
        },
      ],
    })
    const response = await POST(
      postRequest(attachmentPayload, signedHeader(attachmentPayload))
    )
    const body = await response.json()

    expect(body.recorded).toBe(1)
    expect(mocks.recordMessengerMessageEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ summary: '[non-text Messenger message]' })
    )
  })
})

// ── Replay / idempotency ─────────────────────────────────────

describe('POST /api/messenger/webhook — replay and idempotency', () => {
  it('derives occurred_at from the payload, so a replay is byte-identical', async () => {
    const signature = signedHeader(messagingPayload)
    await POST(postRequest(messagingPayload, signature))
    await POST(postRequest(messagingPayload, signature))

    const first = mocks.recordMessengerMessageEvent.mock.calls[0][1]
    const second = mocks.recordMessengerMessageEvent.mock.calls[1][1]

    // Same dedupe source AND same occurred_at — the composite unique key
    // (account_id, dedupe_key, occurred_at) therefore collides and the
    // second write is a no-op at the database. If occurred_at were
    // defaulted to now(), these would differ and a duplicate row would
    // be created under the same dedupe_key.
    expect(second.messengerMessageId).toBe(first.messengerMessageId)
    expect(second.occurredAt).toEqual(first.occurredAt)
    expect(second.accountId).toBe(first.accountId)
  })

  it('reuses the entry timestamp when the messaging event has none', async () => {
    const entryTimeOnly = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            { sender: { id: SENDER_ID }, message: { mid: 'mid-2', text: 'hello' } },
          ],
        },
      ],
    })
    const response = await POST(postRequest(entryTimeOnly, signedHeader(entryTimeOnly)))
    const body = await response.json()

    expect(body.recorded).toBe(1)
    expect(mocks.recordMessengerMessageEvent).toHaveBeenCalledWith(
      { name: 'admin-client' },
      expect.objectContaining({ occurredAt: new Date(TIMESTAMP) })
    )
  })

  it('skips an event with no usable timestamp rather than stamping it with the clock', async () => {
    const noTimestamp = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            { sender: { id: SENDER_ID }, message: { mid: 'mid-3', text: 'hello' } },
          ],
        },
      ],
    })
    const response = await POST(postRequest(noTimestamp, signedHeader(noTimestamp)))
    const body = await response.json()

    expect(body.recorded).toBe(0)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('skips an event whose timestamp is not a finite number', async () => {
    const badTimestamp = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: SENDER_ID },
              timestamp: 'not-a-number',
              message: { mid: 'mid-4', text: 'hello' },
            },
          ],
        },
      ],
    })
    const response = await POST(postRequest(badTimestamp, signedHeader(badTimestamp)))
    const body = await response.json()

    expect(body.recorded).toBe(0)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })
})

// ── Non-message / unsupported payloads ───────────────────────

describe('POST /api/messenger/webhook — non-message and unsupported payloads', () => {
  it('acknowledges but skips a payload for a different object type', async () => {
    const other = JSON.stringify({ object: 'instagram', entry: [] })
    const response = await POST(postRequest(other, signedHeader(other)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('skips echoes of our own outbound messages', async () => {
    const echoPayload = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            {
              sender: { id: 'page-1' },
              recipient: { id: SENDER_ID },
              timestamp: TIMESTAMP,
              message: { mid: 'mid-echo', text: 'Yes, in stock', is_echo: true },
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

  it('skips delivery/read receipts that carry no message body', async () => {
    const receipts = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            { sender: { id: SENDER_ID }, timestamp: TIMESTAMP, delivery: { watermark: 1 } },
            { sender: { id: SENDER_ID }, timestamp: TIMESTAMP, read: { watermark: 1 } },
            { sender: { id: SENDER_ID }, timestamp: TIMESTAMP, postback: { payload: 'X' } },
          ],
        },
      ],
    })
    const response = await POST(postRequest(receipts, signedHeader(receipts)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(0)
    expect(mocks.recordMessengerMessageEvent).not.toHaveBeenCalled()
  })

  it('skips a message with no sender id', async () => {
    const noSender = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [{ timestamp: TIMESTAMP, message: { mid: 'mid-5', text: 'hi' } }],
        },
      ],
    })
    const response = await POST(postRequest(noSender, signedHeader(noSender)))
    expect((await response.json()).recorded).toBe(0)
    expect(mocks.recordIdentityHandle).not.toHaveBeenCalled()
  })

  it('rejects a body that is not valid JSON', async () => {
    const notJson = 'this is not json'
    const response = await POST(postRequest(notJson, signedHeader(notJson)))
    expect(response.status).toBe(400)
  })

  it('acknowledges an empty entry list', async () => {
    const empty = JSON.stringify({ object: 'page', entry: [] })
    const response = await POST(postRequest(empty, signedHeader(empty)))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recorded).toBe(0)
  })

  it('records every valid message in a batched delivery', async () => {
    const batched = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: TIMESTAMP,
          messaging: [
            {
              sender: { id: SENDER_ID },
              timestamp: TIMESTAMP,
              message: { mid: 'mid-a', text: 'one' },
            },
            {
              sender: { id: 'psid-456' },
              timestamp: TIMESTAMP + 1,
              message: { mid: 'mid-b', text: 'two' },
            },
          ],
        },
      ],
    })
    const response = await POST(postRequest(batched, signedHeader(batched)))
    const body = await response.json()

    expect(body.recorded).toBe(2)
    expect(mocks.recordMessengerMessageEvent).toHaveBeenCalledTimes(2)
  })
})

// ── Transport-only boundary ──────────────────────────────────

describe('POST /api/messenger/webhook — stays out of the inbox tables', () => {
  it('imports no contacts/conversations/messages/automation module', async () => {
    // The route may depend on exactly ONE inbox module — the approved
    // Timeline-to-Inbox projection, which writes only channel_threads
    // (operational queue state) and never crm.messages/conversations.
    // Everything else stays forbidden, so a future change that reaches
    // for the WhatsApp inbox tables, automations, templates or AI still
    // fails here and forces an explicit decision.
    //
    // Narrowed (not deleted) when the projection landed: the original
    // blanket '@/lib/inbox' ban had done its job — it failed the moment
    // this route was wired to the inbox, which is precisely the review
    // conversation it existed to force.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    const importLines = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import '))
      .join('\n')

    const allowedInboxImport = '@/lib/inbox/channel-threads'
    const inboxImports = importLines
      .split('\n')
      .filter((line) => line.includes('@/lib/inbox'))
    expect(inboxImports.every((line) => line.includes(allowedInboxImport))).toBe(true)

    for (const forbidden of [
      '@/lib/contacts',
      '@/lib/automations',
      '@/lib/whatsapp/send-message',
      '@/lib/ai',
      '@/lib/inbox/conversations',
      'message-templates',
    ]) {
      expect(importLines).not.toContain(forbidden)
    }
  })
})
