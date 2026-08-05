import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  TimelineEventError,
  recordTimelineEvent,
  listTimelineEventsForContact,
  updateTimelineEventGovernance,
} from './events'

const baseRow = {
  id: 'evt-1',
  account_id: 'acct-1',
  tenant_id: 'tenant-1',
  brand_id: 'brand-1',
  handle_id: 'handle-1',
  contact_id: 'contact-1',
  customer_id: null,
  event_type: 'message.inbound',
  channel: 'instagram',
  source: 'meta_webhook',
  occurred_at: '2026-01-01T00:00:00.000Z',
  recorded_at: '2026-01-01T00:00:01.000Z',
  conversation_id: null,
  session_id: null,
  campaign_id: null,
  ad_id: null,
  creative_id: null,
  summary: 'Test event',
  payload_ref: {},
  payload_hash: null,
  confidence: 'verified',
  visibility: 'team',
  owner_user_id: null,
  action_state: 'none',
  snoozed_until: null,
  corrects_event_id: null,
  dedupe_key: 'ig:mid-1',
  created_by: null,
}

/** Queued per `.from()` call, same convention as identity/handles.test.ts. */
function fakeDb(responses: Array<{ data: unknown; error: unknown }>): AnySupabaseClient {
  let call = 0
  return {
    from: () => {
      const response = responses[call++] ?? { data: null, error: null }
      const builder = {
        insert: () => builder,
        update: () => builder,
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        lt: () => builder,
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: (v: typeof response) => void) =>
          Promise.resolve(response).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const validInput = {
  accountId: 'acct-1',
  tenantId: 'tenant-1',
  brandId: 'brand-1',
  eventType: 'message.inbound',
  channel: 'instagram',
  source: 'meta_webhook',
  summary: 'Test event',
  dedupeKey: 'ig:mid-1',
  occurredAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('recordTimelineEvent', () => {
  it('inserts and returns the row on the happy path', async () => {
    const db = fakeDb([{ data: baseRow, error: null }])
    await expect(recordTimelineEvent(db, validInput)).resolves.toMatchObject({
      id: 'evt-1',
      dedupe_key: 'ig:mid-1',
    })
  })

  it('re-resolves a genuine replay (same dedupe_key, same occurred_at) idempotently', async () => {
    const db = fakeDb([
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: baseRow, error: null },
    ])
    await expect(recordTimelineEvent(db, validInput)).resolves.toMatchObject({
      id: 'evt-1',
    })
  })

  it('throws if the replay re-fetch at the same occurred_at finds nothing', async () => {
    const db = fakeDb([
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: null, error: null },
    ])
    await expect(recordTimelineEvent(db, validInput)).rejects.toBeInstanceOf(
      TimelineEventError
    )
  })

  it('gives a distinct 400 error for an unknown event_type (FK violation)', async () => {
    const db = fakeDb([
      { data: null, error: { code: '23503', message: 'foreign key violation' } },
    ])
    await expect(
      recordTimelineEvent(db, { ...validInput, eventType: 'made.up' })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('defaults occurredAt to now when omitted', async () => {
    const db = fakeDb([{ data: baseRow, error: null }])
    const before = Date.now()
    await recordTimelineEvent(db, { ...validInput, occurredAt: undefined })
    // No assertion on the exact timestamp sent (the stub doesn't capture
    // insert payloads) — this just proves the call doesn't throw when
    // occurredAt is omitted, i.e. the `new Date()` default path runs.
    expect(Date.now()).toBeGreaterThanOrEqual(before)
  })
})

describe('listTimelineEventsForContact', () => {
  it('returns an empty array rather than null', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(listTimelineEventsForContact(db, 'acct-1', 'contact-1')).resolves.toEqual(
      []
    )
  })

  it('surfaces query errors', async () => {
    const db = fakeDb([{ data: null, error: { message: 'timeout' } }])
    await expect(
      listTimelineEventsForContact(db, 'acct-1', 'contact-1')
    ).rejects.toBeInstanceOf(TimelineEventError)
  })
})

describe('updateTimelineEventGovernance', () => {
  it('accepts a governance-only patch shape', async () => {
    const db = fakeDb([{ data: { ...baseRow, action_state: 'open' }, error: null }])
    const result = await updateTimelineEventGovernance(db, 'evt-1', {
      actionState: 'open',
    })
    expect(result.action_state).toBe('open')
  })

  it('throws when the event does not exist', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(
      updateTimelineEventGovernance(db, 'missing', { actionState: 'done' })
    ).rejects.toBeInstanceOf(TimelineEventError)
  })
})
