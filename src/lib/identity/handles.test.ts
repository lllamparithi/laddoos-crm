import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  IdentityHandleError,
  recordIdentityHandle,
  getIdentityHandleByHash,
  listIdentityHandlesForContact,
  touchIdentityHandleLastSeen,
  updateIdentityHandleGovernance,
} from './handles'

const baseRow = {
  id: 'handle-1',
  account_id: 'acct-1',
  handle_type: 'instagram_scoped_id',
  channel: 'instagram',
  handle_value: null,
  handle_hash: 'hash-abc',
  contact_id: null,
  confidence: 'unknown',
  verified_at: null,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  last_seen_at: '2026-01-01T00:00:00.000Z',
  metadata: {},
}

/**
 * Each test queues one response per `.from('identity_handles')` call it
 * expects, consumed in order. Mirrors the sequential nature of
 * recordIdentityHandle's race path (insert, then select, then update)
 * without building a general-purpose mock the rest of the codebase
 * doesn't use — see tag-write.test.ts / dedupe.test.ts for the same
 * per-file inline-stub convention.
 */
function fakeDb(
  responses: Array<{ data: unknown; error: unknown }>
): AnySupabaseClient {
  let call = 0
  return {
    from(table: string) {
      if (table !== 'identity_handles') {
        throw new Error(`unexpected table in test stub: ${table}`)
      }
      const response = responses[call++] ?? { data: null, error: null }
      const builder = {
        insert: () => builder,
        update: () => builder,
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(response),
        single: () => Promise.resolve(response),
        then: (
          resolve: (v: { data: unknown; error: unknown }) => void
        ) => Promise.resolve(response).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const input = {
  accountId: 'acct-1',
  handleType: 'instagram_scoped_id',
  channel: 'instagram',
  handleHash: 'hash-abc',
}

describe('recordIdentityHandle', () => {
  it('returns the newly inserted row on the happy path', async () => {
    const db = fakeDb([{ data: baseRow, error: null }])
    await expect(recordIdentityHandle(db, input)).resolves.toMatchObject({
      id: 'handle-1',
      handle_hash: 'hash-abc',
    })
  })

  it('re-resolves and bumps last_seen_at on a concurrent duplicate insert', async () => {
    const db = fakeDb([
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert races
      { data: baseRow, error: null }, // getIdentityHandleByHash re-fetch
      { data: { ...baseRow, last_seen_at: '2026-01-02T00:00:00.000Z' }, error: null }, // touch
    ])
    const result = await recordIdentityHandle(db, input)
    expect(result.last_seen_at).toBe('2026-01-02T00:00:00.000Z')
  })

  it('throws if the race re-fetch finds nothing', async () => {
    const db = fakeDb([
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: null, error: null }, // re-fetch finds nothing — should not happen, but must not hang
    ])
    await expect(recordIdentityHandle(db, input)).rejects.toBeInstanceOf(
      IdentityHandleError
    )
  })

  it('surfaces non-duplicate insert errors', async () => {
    const db = fakeDb([
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ])
    await expect(recordIdentityHandle(db, input)).rejects.toThrow(
      'Failed to record identity handle: permission denied'
    )
  })
})

describe('getIdentityHandleByHash', () => {
  it('returns the row when found', async () => {
    const db = fakeDb([{ data: baseRow, error: null }])
    await expect(
      getIdentityHandleByHash(db, 'acct-1', 'instagram_scoped_id', 'hash-abc')
    ).resolves.toMatchObject({ id: 'handle-1' })
  })

  it('returns null when not found', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(
      getIdentityHandleByHash(db, 'acct-1', 'instagram_scoped_id', 'missing')
    ).resolves.toBeNull()
  })

  it('throws on a query error', async () => {
    const db = fakeDb([{ data: null, error: { message: 'boom' } }])
    await expect(
      getIdentityHandleByHash(db, 'acct-1', 'instagram_scoped_id', 'hash-abc')
    ).rejects.toBeInstanceOf(IdentityHandleError)
  })
})

describe('listIdentityHandlesForContact', () => {
  it('returns the array of handles', async () => {
    const db = fakeDb([{ data: [baseRow], error: null }])
    await expect(
      listIdentityHandlesForContact(db, 'acct-1', 'contact-1')
    ).resolves.toHaveLength(1)
  })

  it('returns an empty array rather than null', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(
      listIdentityHandlesForContact(db, 'acct-1', 'contact-1')
    ).resolves.toEqual([])
  })
})

describe('touchIdentityHandleLastSeen', () => {
  it('updates last_seen_at and returns the row', async () => {
    const db = fakeDb([{ data: { ...baseRow, last_seen_at: 'now' }, error: null }])
    await expect(touchIdentityHandleLastSeen(db, 'handle-1')).resolves.toMatchObject({
      last_seen_at: 'now',
    })
  })

  it('throws when the handle no longer exists', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(touchIdentityHandleLastSeen(db, 'missing')).rejects.toBeInstanceOf(
      IdentityHandleError
    )
  })
})

describe('updateIdentityHandleGovernance', () => {
  it('accepts a governance-only patch shape', async () => {
    const db = fakeDb([
      { data: { ...baseRow, confidence: 'strong', contact_id: 'contact-1' }, error: null },
    ])
    const result = await updateIdentityHandleGovernance(db, 'handle-1', {
      confidence: 'strong',
      contactId: 'contact-1',
    })
    expect(result.confidence).toBe('strong')
    expect(result.contact_id).toBe('contact-1')
  })

  it('throws when the handle no longer exists', async () => {
    const db = fakeDb([{ data: null, error: null }])
    await expect(
      updateIdentityHandleGovernance(db, 'missing', { confidence: 'rejected' })
    ).rejects.toBeInstanceOf(IdentityHandleError)
  })
})
