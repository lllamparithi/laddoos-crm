import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  TimelineEventError,
  recordTimelineEvent,
  listTimelineEventsForContact,
  listTimelineEventsForAccount,
  listTimelineEventsForContactViaHandles,
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

/**
 * Records the PostgREST chain a query builds, so these tests can assert
 * what was actually SENT rather than only what came back. `fakeDb` above
 * returns a canned response and swallows every filter, which cannot tell
 * "scoped to this account" apart from "no filter at all" — the
 * false-pass shape this project has been bitten by before. The database
 * does the real filtering; what is pinned here is the predicate.
 */
function recordingDb(rows: unknown[]) {
  const calls = {
    table: '',
    eq: [] as Array<[string, unknown]>,
    order: [] as Array<[string, boolean | undefined]>,
    limit: undefined as number | undefined,
  }
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      calls.eq.push([column, value])
      return builder
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      calls.order.push([column, options?.ascending])
      return builder
    },
    limit: (n: number) => {
      calls.limit = n
      return builder
    },
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  const db = {
    from: (table: string) => {
      calls.table = table
      return builder
    },
  } as unknown as SupabaseClient
  return { db: db as AnySupabaseClient, calls }
}

describe('listTimelineEventsForAccount', () => {
  it('scopes the query to the given account', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    expect(calls.table).toBe('timeline_events')
    expect(calls.eq).toContainEqual(['account_id', 'acct-1'])
  })

  it('filters to team visibility, so system/restricted/sensitive events never reach the feed', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    expect(calls.eq).toContainEqual(['visibility', 'team'])
  })

  it('does NOT filter by contact_id — the live web events all have contact_id NULL', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    expect(calls.eq.map(([column]) => column)).not.toContain('contact_id')
  })

  it('orders newest first', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    expect(calls.order).toEqual([['occurred_at', false]])
  })

  it('defaults to a limit of 50', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    expect(calls.limit).toBe(50)
  })

  it('honours an explicit limit', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1', 10)
    expect(calls.limit).toBe(10)
  })

  it('returns the rows it receives', async () => {
    const { db } = recordingDb([baseRow])
    await expect(listTimelineEventsForAccount(db, 'acct-1')).resolves.toHaveLength(1)
  })

  it('returns an empty array rather than null', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(listTimelineEventsForAccount(db, 'acct-1')).resolves.toEqual([])
  })

  it('surfaces query errors', async () => {
    const db = fakeDb([{ data: null, error: { message: 'timeout' } }])
    await expect(listTimelineEventsForAccount(db, 'acct-1')).rejects.toBeInstanceOf(
      TimelineEventError
    )
  })
})

/**
 * Two-table stub: the contact timeline reads identity_handles first, then
 * timeline_events. Records the predicates sent to each so the tests can
 * assert what was ASKED for. The database does the actual filtering; what
 * is pinned here is the query contract.
 */
function contactTimelineDb(
  handles: Array<{ id: string }>,
  events: unknown[],
  opts: { handlesError?: { message: string }; eventsError?: { message: string } } = {}
) {
  const calls = {
    tables: [] as string[],
    handleEq: [] as Array<[string, unknown]>,
    eventEq: [] as Array<[string, unknown]>,
    or: null as string | null,
    order: [] as Array<[string, boolean | undefined]>,
    limit: undefined as number | undefined,
  }
  const db = {
    from: (table: string) => {
      calls.tables.push(table)
      const isHandles = table === 'identity_handles'
      const response = isHandles
        ? { data: opts.handlesError ? null : handles, error: opts.handlesError ?? null }
        : { data: opts.eventsError ? null : events, error: opts.eventsError ?? null }
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          ;(isHandles ? calls.handleEq : calls.eventEq).push([column, value])
          return builder
        },
        or: (expression: string) => {
          calls.or = expression
          return builder
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          calls.order.push([column, options?.ascending])
          return builder
        },
        limit: (n: number) => {
          calls.limit = n
          return builder
        },
        then: (resolve: (v: typeof response) => void) =>
          Promise.resolve(response).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { db: db as AnySupabaseClient, calls }
}

const handleEvent = { ...baseRow, id: 'evt-handle', contact_id: null, handle_id: 'handle-1' }
const directEvent = { ...baseRow, id: 'evt-direct', contact_id: 'contact-1', handle_id: null }

describe('listTimelineEventsForContactViaHandles', () => {
  it('returns empty for a contact with no linked handles and no direct events', async () => {
    const { db, calls } = contactTimelineDb([], [])
    await expect(
      listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    ).resolves.toEqual([])
    // With no handles there is nothing to union — it must fall back to the
    // direct contact_id filter rather than sending an empty `in.()` list.
    expect(calls.or).toBeNull()
    expect(calls.eventEq).toContainEqual(['contact_id', 'contact-1'])
  })

  it('unions handle-associated events when the contact has linked handles', async () => {
    const { db, calls } = contactTimelineDb(
      [{ id: 'handle-1' }, { id: 'handle-2' }],
      [handleEvent]
    )
    const rows = await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(rows).toHaveLength(1)
    expect(calls.or).toBe(
      'contact_id.eq.contact-1,handle_id.in.(handle-1,handle-2)'
    )
  })

  it('includes an event associated directly through contact_id', async () => {
    const { db } = contactTimelineDb([{ id: 'handle-1' }], [directEvent])
    const rows = await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(rows.map((r) => r.id)).toContain('evt-direct')
  })

  it('scopes both reads to the account, so another account cannot leak in', async () => {
    const { db, calls } = contactTimelineDb([{ id: 'handle-1' }], [handleEvent])
    await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(calls.handleEq).toContainEqual(['account_id', 'acct-1'])
    expect(calls.eventEq).toContainEqual(['account_id', 'acct-1'])
    // Handles are resolved account-scoped, so a foreign account's handle id
    // can never reach the events query in the first place.
    expect(calls.handleEq).toContainEqual(['contact_id', 'contact-1'])
  })

  it('filters to team visibility', async () => {
    const { db, calls } = contactTimelineDb([{ id: 'handle-1' }], [handleEvent])
    await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(calls.eventEq).toContainEqual(['visibility', 'team'])
  })

  it('orders newest first', async () => {
    const { db, calls } = contactTimelineDb([], [])
    await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(calls.order).toEqual([['occurred_at', false]])
  })

  it('defaults to a limit of 50 and honours an explicit limit', async () => {
    const a = contactTimelineDb([], [])
    await listTimelineEventsForContactViaHandles(a.db, 'acct-1', 'contact-1')
    expect(a.calls.limit).toBe(50)

    const b = contactTimelineDb([], [])
    await listTimelineEventsForContactViaHandles(b.db, 'acct-1', 'contact-1', 10)
    expect(b.calls.limit).toBe(10)
  })

  it('reads identity_handles before timeline_events', async () => {
    const { db, calls } = contactTimelineDb([{ id: 'handle-1' }], [handleEvent])
    await listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    expect(calls.tables).toEqual(['identity_handles', 'timeline_events'])
  })

  it('never writes — only select/filter/order/limit are used', async () => {
    const writes: string[] = []
    const db = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          or: () => builder,
          order: () => builder,
          limit: () => builder,
          insert: () => { writes.push('insert'); return builder },
          update: () => { writes.push('update'); return builder },
          delete: () => { writes.push('delete'); return builder },
          upsert: () => { writes.push('upsert'); return builder },
          then: (resolve: (v: { data: unknown; error: null }) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        }
        return builder
      },
    } as unknown as SupabaseClient
    await listTimelineEventsForContactViaHandles(db as AnySupabaseClient, 'acct-1', 'contact-1')
    expect(writes).toEqual([])
  })

  it('surfaces query errors', async () => {
    const { db } = contactTimelineDb([], [], { eventsError: { message: 'timeout' } })
    await expect(
      listTimelineEventsForContactViaHandles(db, 'acct-1', 'contact-1')
    ).rejects.toBeInstanceOf(TimelineEventError)
  })
})

describe('listTimelineEventsForAccount is unaffected by the contact helper', () => {
  it('still filters by account + visibility only, with no contact or handle predicate', async () => {
    const { db, calls } = recordingDb([baseRow])
    await listTimelineEventsForAccount(db, 'acct-1')
    const columns = calls.eq.map(([column]) => column)
    expect(columns).toContain('account_id')
    expect(columns).toContain('visibility')
    expect(columns).not.toContain('contact_id')
    expect(columns).not.toContain('handle_id')
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
