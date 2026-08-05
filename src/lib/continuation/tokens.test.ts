import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  ContinuationTokenError,
  insertContinuationToken,
  getContinuationTokenByHash,
  recordContinuationTokenUse,
  revokeContinuationToken,
} from './tokens'

const baseRow = {
  id: 'token-1',
  account_id: 'acct-1',
  tenant_id: 'tenant-1',
  brand_id: 'brand-1',
  token_hash: 'hash-1',
  purpose: 'ig_to_web',
  origin_channel: 'instagram',
  origin_conversation_id: null,
  origin_contact_id: null,
  origin_handle_id: 'handle-1',
  campaign_id: null,
  ad_id: null,
  creative_id: null,
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2026-01-08T00:00:00.000Z',
  max_uses: 5,
  use_count: 0,
  first_used_at: null,
  binds_identity: true,
  revoked_at: null,
  revoked_reason: null,
}

function fakeDb(response: { data: unknown; error: unknown }): AnySupabaseClient {
  return {
    from: () => {
      const builder = {
        insert: () => builder,
        update: () => builder,
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const insertInput = {
  accountId: 'acct-1',
  tenantId: 'tenant-1',
  brandId: 'brand-1',
  tokenHash: 'hash-1',
  purpose: 'ig_to_web' as const,
  originChannel: 'instagram',
  expiresAt: new Date('2026-01-08T00:00:00.000Z'),
}

describe('insertContinuationToken', () => {
  it('inserts and returns the row', async () => {
    const db = fakeDb({ data: baseRow, error: null })
    await expect(insertContinuationToken(db, insertInput)).resolves.toMatchObject({
      id: 'token-1',
      purpose: 'ig_to_web',
    })
  })

  it('throws on a DB error', async () => {
    const db = fakeDb({ data: null, error: { message: 'boom' } })
    await expect(insertContinuationToken(db, insertInput)).rejects.toBeInstanceOf(
      ContinuationTokenError
    )
  })
})

describe('getContinuationTokenByHash', () => {
  it('returns null when not found (expired/invalid/exhausted is indistinguishable at this layer)', async () => {
    const db = fakeDb({ data: null, error: null })
    await expect(getContinuationTokenByHash(db, 'missing')).resolves.toBeNull()
  })
})

describe('recordContinuationTokenUse', () => {
  it('sets first_used_at when expectedCurrentUseCount is 0', async () => {
    const db = fakeDb({
      data: { ...baseRow, use_count: 1, first_used_at: '2026-01-02T00:00:00.000Z' },
      error: null,
    })
    const result = await recordContinuationTokenUse(db, 'token-1', 0)
    expect(result?.use_count).toBe(1)
    expect(result?.first_used_at).not.toBeNull()
  })

  it('returns null on a lost compare-and-swap race (concurrent redemption)', async () => {
    // .eq('use_count', expectedCurrentUseCount) matched nothing because
    // another request already incremented it — maybeSingle() sees 0 rows.
    const db = fakeDb({ data: null, error: null })
    await expect(recordContinuationTokenUse(db, 'token-1', 0)).resolves.toBeNull()
  })
})

describe('revokeContinuationToken', () => {
  it('sets revoked_at and revoked_reason', async () => {
    const db = fakeDb({
      data: { ...baseRow, revoked_at: '2026-01-02T00:00:00.000Z', revoked_reason: 'campaign ended' },
      error: null,
    })
    const result = await revokeContinuationToken(db, 'token-1', 'campaign ended')
    expect(result.revoked_reason).toBe('campaign ended')
  })

  it('throws when the token does not exist', async () => {
    const db = fakeDb({ data: null, error: null })
    await expect(revokeContinuationToken(db, 'missing', 'x')).rejects.toBeInstanceOf(
      ContinuationTokenError
    )
  })
})
