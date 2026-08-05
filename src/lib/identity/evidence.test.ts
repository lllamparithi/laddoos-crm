import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  IdentityEvidenceError,
  recordIdentityEvidence,
  getEvidencePolicy,
  listEvidenceForHandle,
} from './evidence'

const evidenceRow = {
  id: 'ev-1',
  account_id: 'acct-1',
  handle_id: 'handle-1',
  contact_id: null,
  evidence_type: 'agent_manual_link',
  confidence: 'verified',
  observed_at: '2026-01-01T00:00:00.000Z',
  source_event_id: null,
  actor_type: 'agent',
  actor_user_id: 'user-1',
  notes: null,
  expires_at: null,
}

function fakeDb(response: { data: unknown; error: unknown }): AnySupabaseClient {
  return {
    from: () => {
      const builder = {
        insert: () => builder,
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: (v: typeof response) => void) =>
          Promise.resolve(response).then(resolve),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('recordIdentityEvidence', () => {
  const validInput = {
    accountId: 'acct-1',
    handleId: 'handle-1',
    evidenceType: 'agent_manual_link',
    confidence: 'verified' as const,
    actorType: 'agent' as const,
    actorUserId: 'user-1',
  }

  it('inserts and returns the row on the happy path', async () => {
    const db = fakeDb({ data: evidenceRow, error: null })
    await expect(recordIdentityEvidence(db, validInput)).resolves.toMatchObject({
      id: 'ev-1',
      evidence_type: 'agent_manual_link',
    })
  })

  it('rejects an agent-attributed evidence row with no actorUserId, before hitting the DB', async () => {
    const db = fakeDb({ data: evidenceRow, error: null })
    await expect(
      recordIdentityEvidence(db, { ...validInput, actorUserId: undefined })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('gives a distinct error for an unknown evidence_type (FK violation)', async () => {
    const db = fakeDb({
      data: null,
      error: { code: '23503', message: 'foreign key violation' },
    })
    await expect(
      recordIdentityEvidence(db, { ...validInput, evidenceType: 'made_up' })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('surfaces other errors generically', async () => {
    const db = fakeDb({ data: null, error: { message: 'connection lost' } })
    await expect(recordIdentityEvidence(db, validInput)).rejects.toBeInstanceOf(
      IdentityEvidenceError
    )
  })
})

describe('getEvidencePolicy', () => {
  it('returns the policy row when found', async () => {
    const db = fakeDb({
      data: {
        evidence_type: 'agent_manual_link',
        max_confidence: 'verified',
        auto_link: true,
        description: 'x',
      },
      error: null,
    })
    await expect(getEvidencePolicy(db, 'agent_manual_link')).resolves.toMatchObject({
      auto_link: true,
    })
  })

  it('returns null for an unseeded evidence type', async () => {
    const db = fakeDb({ data: null, error: null })
    await expect(getEvidencePolicy(db, 'device_fingerprint')).resolves.toBeNull()
  })
})

describe('listEvidenceForHandle', () => {
  it('returns an empty array rather than null', async () => {
    const db = fakeDb({ data: null, error: null })
    await expect(listEvidenceForHandle(db, 'acct-1', 'handle-1')).resolves.toEqual([])
  })
})
