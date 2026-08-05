import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import { buildContinuationTokenRef, generateTokenId, hashTokenId } from './sign'
import {
  ContinuationServiceError,
  issueContinuationToken,
  resolveContinuationToken,
} from './service'
import type { ContinuationTokenRow } from './tokens'

const secret = 'test-signing-secret'

const baseRow: ContinuationTokenRow = {
  id: 'token-1',
  account_id: 'acct-1',
  tenant_id: 'tenant-1',
  brand_id: 'brand-1',
  token_hash: 'placeholder',
  purpose: 'ig_to_web',
  origin_channel: 'instagram',
  origin_conversation_id: 'conv-1',
  origin_contact_id: 'contact-1',
  origin_handle_id: 'handle-1',
  campaign_id: 'camp-1',
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

/**
 * A genuinely stateful fake: `.update()` only applies when the row's
 * current use_count matches the `.eq('use_count', X)` filter, mirroring
 * real Postgres compare-and-swap semantics. This is what makes the CAS
 * retry-loop tests below meaningful rather than just canned responses —
 * the fake can actually lose a race and the service has to really retry.
 */
function fakeDbWithRow(initialRow: ContinuationTokenRow) {
  let row: ContinuationTokenRow | null = { ...initialRow }
  let fromCalls = 0
  const db = {
    from: (table: string) => {
      fromCalls++
      if (table !== 'continuation_tokens') throw new Error(`unexpected table: ${table}`)
      let pendingPatch: Record<string, unknown> | null = null
      let expectedUseCount: number | undefined
      let hashFilter: string | undefined
      const builder = {
        insert: (payload: Record<string, unknown>) => {
          row = { ...row, ...payload } as ContinuationTokenRow
          return builder
        },
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          pendingPatch = patch
          return builder
        },
        eq: (col: string, val: unknown) => {
          if (col === 'use_count') expectedUseCount = val as number
          if (col === 'token_hash') hashFilter = val as string
          return builder
        },
        single: () => builder.maybeSingle(),
        maybeSingle: () => {
          // Compare-and-swap update path.
          if (pendingPatch) {
            if (!row || row.use_count !== expectedUseCount) {
              return Promise.resolve({ data: null, error: null })
            }
            row = { ...row, ...pendingPatch } as ContinuationTokenRow
            return Promise.resolve({ data: row, error: null })
          }
          // Hash-lookup path — must actually respect the filter, or a
          // "wrong hash" test would silently pass against any row.
          if (hashFilter !== undefined) {
            if (!row || row.token_hash !== hashFilter) {
              return Promise.resolve({ data: null, error: null })
            }
            return Promise.resolve({ data: row, error: null })
          }
          // insert().select().single() read-back path.
          return Promise.resolve({ data: row, error: null })
        },
      }
      return builder
    },
    __fromCalls: () => fromCalls,
    /** Simulate a concurrent redemption landing between our read and write. */
    __externallyIncrementUseCount: () => {
      if (row) row = { ...row, use_count: row.use_count + 1 }
    },
  }
  return db as unknown as AnySupabaseClient & { __fromCalls: () => number; __externallyIncrementUseCount: () => void }
}

/** For "must not hit the DB at all" assertions. */
function neverCalledDb(): AnySupabaseClient & { __fromCalls: () => number } {
  let calls = 0
  return {
    from: () => {
      calls++
      throw new Error('db.from() should never be called for this input')
    },
    __fromCalls: () => calls,
  } as unknown as AnySupabaseClient & { __fromCalls: () => number }
}

describe('issueContinuationToken', () => {
  it('throws when no signing key is available anywhere', async () => {
    const db = fakeDbWithRow(baseRow)
    await expect(
      issueContinuationToken(db, {
        accountId: 'acct-1',
        tenantId: 'tenant-1',
        brandId: 'brand-1',
        purpose: 'ig_to_web',
        originChannel: 'instagram',
      })
    ).rejects.toBeInstanceOf(ContinuationServiceError)
  })

  it('returns a ref that resolves back through the same secret', async () => {
    const db = fakeDbWithRow(baseRow)
    const issued = await issueContinuationToken(
      db,
      {
        accountId: 'acct-1',
        tenantId: 'tenant-1',
        brandId: 'brand-1',
        purpose: 'ig_to_web',
        originChannel: 'instagram',
      },
      { secret }
    )
    expect(issued.ref.startsWith('v1.')).toBe(true)
    expect(issued.id).toBe('token-1')
  })
})

describe('resolveContinuationToken', () => {
  const now = new Date('2026-01-02T00:00:00.000Z')

  it('rejects a malformed ref without touching the database', async () => {
    const db = neverCalledDb()
    const result = await resolveContinuationToken(db, 'not-a-ref', 'tenant-1', 'brand-1', {
      secret,
      now,
    })
    expect(result.ok).toBe(false)
    expect(db.__fromCalls()).toBe(0)
  })

  it('rejects a ref signed with the wrong secret without touching the database', async () => {
    const db = neverCalledDb()
    const ref = buildContinuationTokenRef(generateTokenId(), 'a-different-secret')
    const result = await resolveContinuationToken(db, ref, 'tenant-1', 'brand-1', {
      secret,
      now,
    })
    expect(result.ok).toBe(false)
    expect(db.__fromCalls()).toBe(0)
  })

  it('rejects when the hash is not found in the database', async () => {
    const db = fakeDbWithRow(baseRow)
    const ref = buildContinuationTokenRef(generateTokenId(), secret) // different id -> different hash
    const result = await resolveContinuationToken(db, ref, 'tenant-1', 'brand-1', {
      secret,
      now,
    })
    expect(result.ok).toBe(false)
  })

  async function resolveWithMatchingRow(
    row: ContinuationTokenRow,
    tenantId = 'tenant-1',
    brandId = 'brand-1'
  ) {
    const tokenId = generateTokenId()
    const ref = buildContinuationTokenRef(tokenId, secret)
    const db = fakeDbWithRow({ ...row, token_hash: hashTokenId(tokenId) })
    const result = await resolveContinuationToken(db, ref, tenantId, brandId, { secret, now })
    return { result, db }
  }

  it('rejects a revoked token', async () => {
    const { result } = await resolveWithMatchingRow({
      ...baseRow,
      revoked_at: '2026-01-01T12:00:00.000Z',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an expired token', async () => {
    const { result } = await resolveWithMatchingRow({
      ...baseRow,
      expires_at: '2026-01-01T00:00:00.000Z', // before `now`
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an exhausted token (use_count >= max_uses)', async () => {
    const { result } = await resolveWithMatchingRow({
      ...baseRow,
      use_count: 5,
      max_uses: 5,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a token issued for a different tenant/brand (cross-tenant use)', async () => {
    const { result } = await resolveWithMatchingRow(baseRow, 'some-other-tenant', 'brand-1')
    expect(result.ok).toBe(false)
  })

  it('accepts a valid first use and reports isFirstUse: true', async () => {
    const { result } = await resolveWithMatchingRow({ ...baseRow, use_count: 0 })
    expect(result.ok).toBe(true)
    expect(result.token?.isFirstUse).toBe(true)
  })

  it('accepts a valid repeat use — the forwarding-defense case — and reports isFirstUse: false', async () => {
    // This is the load-bearing case for Thesis B: a token good for
    // multiple uses (max_uses defaults to 5) still resolves successfully
    // on a second redemption — attribution survives — but must NEVER
    // claim isFirstUse, because identity only binds once. See
    // docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.3.
    const { result } = await resolveWithMatchingRow({ ...baseRow, use_count: 1 })
    expect(result.ok).toBe(true)
    expect(result.token?.isFirstUse).toBe(false)
  })

  it('retries and succeeds after losing one compare-and-swap race', async () => {
    const tokenId = generateTokenId()
    const ref = buildContinuationTokenRef(tokenId, secret)
    const db = fakeDbWithRow({ ...baseRow, token_hash: hashTokenId(tokenId), use_count: 0 })

    // Simulate a concurrent redemption landing between our initial read
    // (use_count: 0) and our first write attempt, so the first CAS
    // attempt (eq use_count=0) fails against the fake's real state.
    db.__externallyIncrementUseCount()

    const result = await resolveContinuationToken(db, ref, 'tenant-1', 'brand-1', {
      secret,
      now,
    })
    expect(result.ok).toBe(true)
    // The row was already at use_count 1 when our retry succeeded, so
    // this redemption is correctly NOT the first use.
    expect(result.token?.isFirstUse).toBe(false)
  })
})
