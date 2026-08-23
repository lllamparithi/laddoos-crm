import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  TimelineIngestError,
  recordWebEvent,
  recordInstagramMessageEvent,
  recordMessengerMessageEvent,
} from './ingest'

const tenancy = { accountId: 'acct-1', tenantId: 'tenant-1', brandId: 'brand-1' }

/**
 * Captures the exact insert payload so dedupe_key / channel / event_type
 * conventions can be asserted precisely, not just "it didn't throw".
 */
function captureDb() {
  const inserts: Record<string, unknown>[] = []
  const db = {
    from: () => {
      const builder = {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return builder
        },
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: { id: 'evt-1', ...inserts[inserts.length - 1] }, error: null }),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { db: db as AnySupabaseClient, inserts }
}

describe('recordWebEvent', () => {
  it('uses a session-scoped dedupe_key with no suffix for web.visit', async () => {
    const { db, inserts } = captureDb()
    await recordWebEvent(db, {
      ...tenancy,
      eventType: 'web.visit',
      webSessionId: 'sess-abc',
      summary: 'First visit',
    })
    expect(inserts[0].dedupe_key).toBe('web:sess-abc:visit')
    expect(inserts[0].channel).toBe('web')
    expect(inserts[0].source).toBe('web_sdk')
  })

  it('requires a dedupeSuffix for repeatable event types', async () => {
    const { db } = captureDb()
    await expect(
      recordWebEvent(db, {
        ...tenancy,
        eventType: 'web.page_view',
        webSessionId: 'sess-abc',
        summary: 'Viewed /products',
      })
    ).rejects.toBeInstanceOf(TimelineIngestError)
  })

  it('builds a distinct dedupe_key per page view using the caller-supplied suffix', async () => {
    const { db, inserts } = captureDb()
    await recordWebEvent(db, {
      ...tenancy,
      eventType: 'web.page_view',
      webSessionId: 'sess-abc',
      dedupeSuffix: 'pv-1',
      summary: 'Viewed /products',
    })
    expect(inserts[0].dedupe_key).toBe('web:sess-abc:web.page_view:pv-1')
  })

  it('stores webSessionId in payload_ref, never in the session_id column', async () => {
    const { db, inserts } = captureDb()
    await recordWebEvent(db, {
      ...tenancy,
      eventType: 'web.visit',
      webSessionId: 'sess-abc',
      summary: 'First visit',
    })
    // recordTimelineEvent normalizes an omitted sessionId to null (the
    // correct value for the nullable DB column) — the point of this
    // assertion is that it's null, not the web session id.
    expect(inserts[0].session_id).toBeNull()
    expect((inserts[0].payload_ref as Record<string, unknown>).web_session_id).toBe(
      'sess-abc'
    )
  })
})

describe('recordInstagramMessageEvent', () => {
  it('maps inbound to message.inbound with meta_webhook as the default source', async () => {
    const { db, inserts } = captureDb()
    await recordInstagramMessageEvent(db, {
      ...tenancy,
      direction: 'inbound',
      igMessageId: 'mid-1',
      summary: 'Do you ship to Coimbatore?',
    })
    expect(inserts[0].event_type).toBe('message.inbound')
    expect(inserts[0].source).toBe('meta_webhook')
    expect(inserts[0].dedupe_key).toBe('ig:mid-1')
  })

  it('maps outbound to message.outbound with agent as the default source', async () => {
    const { db, inserts } = captureDb()
    await recordInstagramMessageEvent(db, {
      ...tenancy,
      direction: 'outbound',
      igMessageId: 'mid-2',
      summary: 'Yes, nationwide shipping.',
    })
    expect(inserts[0].event_type).toBe('message.outbound')
    expect(inserts[0].source).toBe('agent')
  })

  it('lets the caller override source (e.g. for a bot-sent reply)', async () => {
    const { db, inserts } = captureDb()
    await recordInstagramMessageEvent(db, {
      ...tenancy,
      direction: 'outbound',
      igMessageId: 'mid-3',
      summary: 'Automated reply',
      source: 'bot',
    })
    expect(inserts[0].source).toBe('bot')
  })
})

describe('recordMessengerMessageEvent', () => {
  const occurredAt = new Date('2026-01-01T00:00:00.000Z')

  it('maps inbound to message.inbound on the messenger channel', async () => {
    const { db, inserts } = captureDb()
    await recordMessengerMessageEvent(db, {
      ...tenancy,
      direction: 'inbound',
      messengerMessageId: 'mid-1',
      summary: 'Is the almond laddoo box available?',
      occurredAt,
    })
    expect(inserts[0].event_type).toBe('message.inbound')
    expect(inserts[0].channel).toBe('messenger')
    expect(inserts[0].source).toBe('meta_webhook')
    expect(inserts[0].dedupe_key).toBe('messenger:mid-1')
  })

  it('maps outbound to message.outbound with agent as the default source', async () => {
    const { db, inserts } = captureDb()
    await recordMessengerMessageEvent(db, {
      ...tenancy,
      direction: 'outbound',
      messengerMessageId: 'mid-2',
      summary: 'Yes, in stock.',
      occurredAt,
    })
    expect(inserts[0].event_type).toBe('message.outbound')
    expect(inserts[0].source).toBe('agent')
  })

  it('namespaces the dedupe key so an Instagram and Messenger mid never collide', async () => {
    const { db: igDb, inserts: igInserts } = captureDb()
    const { db: fbDb, inserts: fbInserts } = captureDb()

    await recordInstagramMessageEvent(igDb, {
      ...tenancy,
      direction: 'inbound',
      igMessageId: 'same-id',
      summary: 'from instagram',
    })
    await recordMessengerMessageEvent(fbDb, {
      ...tenancy,
      direction: 'inbound',
      messengerMessageId: 'same-id',
      summary: 'from messenger',
      occurredAt,
    })

    expect(igInserts[0].dedupe_key).toBe('ig:same-id')
    expect(fbInserts[0].dedupe_key).toBe('messenger:same-id')
    expect(igInserts[0].dedupe_key).not.toBe(fbInserts[0].dedupe_key)
  })

  it('writes the caller-supplied occurred_at verbatim, so a replay collides', async () => {
    const { db, inserts } = captureDb()
    await recordMessengerMessageEvent(db, {
      ...tenancy,
      direction: 'inbound',
      messengerMessageId: 'mid-3',
      summary: 'hello',
      occurredAt,
    })
    expect(inserts[0].occurred_at).toBe(occurredAt.toISOString())
  })

  it('records the messenger message id in payload_ref', async () => {
    const { db, inserts } = captureDb()
    await recordMessengerMessageEvent(db, {
      ...tenancy,
      direction: 'inbound',
      messengerMessageId: 'mid-4',
      summary: 'hello',
      occurredAt,
      payloadRef: { messenger_sender_id: 'psid-1' },
    })
    expect(inserts[0].payload_ref).toEqual({
      messenger_sender_id: 'psid-1',
      messenger_message_id: 'mid-4',
    })
  })

  it('never sets contact_id or conversation_id when the caller omits them', async () => {
    const { db, inserts } = captureDb()
    await recordMessengerMessageEvent(db, {
      ...tenancy,
      direction: 'inbound',
      messengerMessageId: 'mid-5',
      summary: 'hello',
      occurredAt,
    })
    expect(inserts[0].contact_id).toBeNull()
    expect(inserts[0].conversation_id).toBeNull()
  })
})

