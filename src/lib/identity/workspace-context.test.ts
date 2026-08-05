import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnySupabaseClient } from '@/lib/supabase/any-client'

import {
  WorkspaceContextError,
  resolveSingleAccountWorkspaceContext,
  resolveWorkspaceBrandForAccount,
} from './workspace-context'

function fakeDb(responses: {
  accounts: { data: unknown; error: unknown }
  mapping?: { data: unknown; error: unknown }
}): AnySupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'accounts') {
        const builder = {
          select: () => builder,
          then: (resolve: (v: typeof responses.accounts) => void) =>
            Promise.resolve(responses.accounts).then(resolve),
        }
        return builder
      }
      if (table === 'workspace_brand_map') {
        const response = responses.mapping ?? { data: null, error: null }
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve(response),
        }
        return builder
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('resolveSingleAccountWorkspaceContext', () => {
  it('resolves the account and its active workspace_brand_map row', async () => {
    const db = fakeDb({
      accounts: { data: [{ id: 'acct-1' }], error: null },
      mapping: { data: { tenant_id: 'tenant-1', brand_id: 'brand-1' }, error: null },
    })
    await expect(resolveSingleAccountWorkspaceContext(db)).resolves.toEqual({
      accountId: 'acct-1',
      tenantId: 'tenant-1',
      brandId: 'brand-1',
    })
  })

  it('throws when no account exists yet', async () => {
    const db = fakeDb({ accounts: { data: [], error: null } })
    await expect(resolveSingleAccountWorkspaceContext(db)).rejects.toBeInstanceOf(
      WorkspaceContextError
    )
  })

  it('fails loudly rather than picking one, when more than one account exists', async () => {
    const db = fakeDb({
      accounts: { data: [{ id: 'acct-1' }, { id: 'acct-2' }], error: null },
    })
    await expect(resolveSingleAccountWorkspaceContext(db)).rejects.toMatchObject({
      status: 500,
    })
  })

  it('throws a 503 when the account exists but has no active workspace_brand_map yet', async () => {
    const db = fakeDb({
      accounts: { data: [{ id: 'acct-1' }], error: null },
      mapping: { data: null, error: null },
    })
    await expect(resolveSingleAccountWorkspaceContext(db)).rejects.toMatchObject({
      status: 503,
    })
  })

  it('surfaces a query error resolving accounts', async () => {
    const db = fakeDb({ accounts: { data: null, error: { message: 'timeout' } } })
    await expect(resolveSingleAccountWorkspaceContext(db)).rejects.toBeInstanceOf(
      WorkspaceContextError
    )
  })
})

describe('resolveWorkspaceBrandForAccount', () => {
  it('resolves the mapping for an already-known account id', async () => {
    const db = fakeDb({
      accounts: { data: [], error: null }, // unused by this function
      mapping: { data: { tenant_id: 'tenant-1', brand_id: 'brand-1' }, error: null },
    })
    await expect(resolveWorkspaceBrandForAccount(db, 'acct-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      brandId: 'brand-1',
    })
  })

  it('throws a 503 when no active mapping exists for that account', async () => {
    const db = fakeDb({
      accounts: { data: [], error: null },
      mapping: { data: null, error: null },
    })
    await expect(resolveWorkspaceBrandForAccount(db, 'acct-1')).rejects.toMatchObject({
      status: 503,
    })
  })
})
