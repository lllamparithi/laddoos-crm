import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import { linkVisitorOnFirstUse } from './link-visitor'

const VISITOR_ID = 'visitor-abc-123'
const VISITOR_HASH = createHash('sha256').update(VISITOR_ID).digest('hex')

const ACCOUNT = 'acct-1'
const OTHER_ACCOUNT = 'acct-2'
const CONTACT = 'contact-1'

const unlinkedHandle = {
  id: 'handle-1',
  account_id: ACCOUNT,
  handle_type: 'web_visitor_id',
  channel: 'web',
  handle_value: VISITOR_ID,
  handle_hash: VISITOR_HASH,
  contact_id: null as string | null,
  confidence: 'unknown',
  verified_at: null,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  last_seen_at: '2026-01-01T00:00:00.000Z',
  metadata: {},
}

/**
 * Records every table written and the payload sent, so a test can assert
 * BOTH that the right rows were written and — more importantly — that
 * nothing else was. A stub that only returns canned rows cannot tell
 * "wrote one evidence row" apart from "wrote evidence and also stamped
 * timeline_events", which is the exact regression this feature must
 * never introduce.
 */
function trackingDb(handle: typeof unlinkedHandle | null) {
  const writes: Array<{ table: string; op: string; payload?: unknown }> = []
  const reads: string[] = []
  const db = {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        insert: (payload: unknown) => {
          writes.push({ table, op: 'insert', payload })
          return builder
        },
        update: (payload: unknown) => {
          writes.push({ table, op: 'update', payload })
          return builder
        },
        delete: () => {
          writes.push({ table, op: 'delete' })
          return builder
        },
        upsert: (payload: unknown) => {
          writes.push({ table, op: 'upsert', payload })
          return builder
        },
        single: () => {
          if (table === 'identity_evidence') return Promise.resolve({ data: { id: 'ev-1' }, error: null })
          return Promise.resolve({ data: { ...handle, contact_id: CONTACT }, error: null })
        },
        maybeSingle: () => {
          reads.push(table)
          if (table === 'identity_handles') return Promise.resolve({ data: handle, error: null })
          return Promise.resolve({ data: { id: 'ev-1' }, error: null })
        },
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { db: db as AnySupabaseClient, writes, reads }
}

const validInput = {
  accountId: ACCOUNT,
  originContactId: CONTACT,
  bindsIdentity: true,
  isFirstUse: true,
  visitorId: VISITOR_ID,
}

describe('linkVisitorOnFirstUse — the happy path', () => {
  it('writes exactly one evidence row and one handle update', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await expect(linkVisitorOnFirstUse(db, validInput)).resolves.toBe('linked')

    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ table: 'identity_evidence', op: 'insert' })
    expect(writes[1]).toMatchObject({ table: 'identity_handles', op: 'update' })
  })

  it('records the approved evidence type, strong confidence and a system actor', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)

    expect(writes[0].payload).toMatchObject({
      evidence_type: 'continuation_token_first_use',
      confidence: 'strong',
      actor_type: 'system',
      account_id: ACCOUNT,
      handle_id: 'handle-1',
      contact_id: CONTACT,
    })
  })

  it('links the handle to the origin contact at strong — never verified', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)

    expect(writes[1].payload).toMatchObject({
      contact_id: CONTACT,
      confidence: 'strong',
    })
    expect(JSON.stringify(writes[1].payload)).not.toContain('verified')
  })

  it('writes evidence BEFORE the link, so a partial failure leaves a trail', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)
    expect(writes.map((w) => w.table)).toEqual(['identity_evidence', 'identity_handles'])
  })

  it('never writes timeline_events', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)
    expect(writes.map((w) => w.table)).not.toContain('timeline_events')
  })

  it('never creates a handle — /api/web-events owns that', async () => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)
    const handleInserts = writes.filter(
      (w) => w.table === 'identity_handles' && w.op !== 'update',
    )
    expect(handleInserts).toEqual([])
  })
})

describe('linkVisitorOnFirstUse — every guard is a silent no-op', () => {
  it.each([
    ['repeat use', { isFirstUse: false }, 'not_first_use'],
    ['binds_identity false', { bindsIdentity: false }, 'binds_identity_false'],
    ['no origin contact', { originContactId: null }, 'no_origin_contact'],
    ['missing visitor id', { visitorId: null }, 'no_visitor_id'],
    ['blank visitor id', { visitorId: '   ' }, 'no_visitor_id'],
  ])('%s → %s, with zero writes', async (_label, override, expected) => {
    const { db, writes } = trackingDb(unlinkedHandle)
    await expect(
      linkVisitorOnFirstUse(db, { ...validInput, ...override }),
    ).resolves.toBe(expected)
    expect(writes).toEqual([])
  })

  it('missing handle → no writes, and no handle is created', async () => {
    const { db, writes } = trackingDb(null)
    await expect(linkVisitorOnFirstUse(db, validInput)).resolves.toBe('handle_not_found')
    expect(writes).toEqual([])
  })

  it('already-linked handle is never relinked, even to the same contact', async () => {
    const { db, writes } = trackingDb({ ...unlinkedHandle, contact_id: CONTACT })
    await expect(linkVisitorOnFirstUse(db, validInput)).resolves.toBe('already_linked')
    expect(writes).toEqual([])
  })

  it.each(['verified', 'rejected'])(
    'handle at %s confidence is a human decision and is left alone',
    async (confidence) => {
      const { db, writes } = trackingDb({ ...unlinkedHandle, confidence })
      await expect(linkVisitorOnFirstUse(db, validInput)).resolves.toBe('human_decided')
      expect(writes).toEqual([])
    },
  )

  it('cross-account handle is never written', async () => {
    const { db, writes } = trackingDb({ ...unlinkedHandle, account_id: OTHER_ACCOUNT })
    await expect(linkVisitorOnFirstUse(db, validInput)).resolves.toBe('account_mismatch')
    expect(writes).toEqual([])
  })

  it('looks the handle up scoped to the account, by hash not raw id', async () => {
    const { db, reads } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, validInput)
    expect(reads).toContain('identity_handles')
  })
})

describe('linkVisitorOnFirstUse — guard ordering', () => {
  it('checks first-use before touching the database at all', async () => {
    const { db, reads, writes } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, { ...validInput, isFirstUse: false })
    expect(reads).toEqual([])
    expect(writes).toEqual([])
  })

  it('a missing visitor id short-circuits before any lookup', async () => {
    const { db, reads } = trackingDb(unlinkedHandle)
    await linkVisitorOnFirstUse(db, { ...validInput, visitorId: null })
    expect(reads).toEqual([])
  })
})
