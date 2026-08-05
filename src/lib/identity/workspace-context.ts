// ============================================================
// Single-account workspace/tenant/brand resolution — Phase 2A.
//
// Every Phase 2A route that has no logged-in user (the Instagram
// webhook, the web event ingest endpoint, the token resolve endpoint)
// still needs to know which account/tenant/brand it's writing on
// behalf of. WhatsApp resolves this per-request via
// `whatsapp_config.phone_number_id`; Phase 2A has no equivalent
// per-channel config table yet (out of scope — no new migration), and
// doesn't need one: per CLAUDE.md's locked decision, "Laddoos is the
// only account. No multi-tenant scaffolding."
//
// This resolves the one account and its one active workspace_brand_map
// row (037), and fails LOUDLY — not by silently picking a row — if that
// single-account assumption is ever violated, so a future multi-account
// deployment breaks here first rather than misrouting data.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'

export class WorkspaceContextError extends Error {
  readonly status: number
  constructor(message: string, status = 503) {
    super(message)
    this.name = 'WorkspaceContextError'
    this.status = status
  }
}

export interface WorkspaceContext {
  accountId: string
  tenantId: string
  brandId: string
}

export async function resolveSingleAccountWorkspaceContext(
  db: AnySupabaseClient
): Promise<WorkspaceContext> {
  const { data: accounts, error: accountsError } = await db.from('accounts').select('id')

  if (accountsError) {
    throw new WorkspaceContextError(`Failed to resolve account: ${accountsError.message}`, 500)
  }
  if (!accounts || accounts.length === 0) {
    throw new WorkspaceContextError(
      'No account exists yet — sign up in the dashboard before Phase 2A endpoints can be used'
    )
  }
  if (accounts.length > 1) {
    // Deliberately not "pick the first one" — this locked assumption
    // (CLAUDE.md: single-tenant) has a schema-level escape hatch
    // (crm.accounts supports many rows for account-sharing), so if it
    // is ever violated, fail loudly rather than silently route Phase 2A
    // traffic to an arbitrary account.
    throw new WorkspaceContextError(
      `Expected exactly one account (single-tenant deployment); found ${accounts.length}. ` +
        'Phase 2A endpoints need per-account routing (out of scope for this pass) before this can work correctly.',
      500
    )
  }

  const accountId = accounts[0].id as string
  const { tenantId, brandId } = await resolveWorkspaceBrandForAccount(db, accountId)
  return { accountId, tenantId, brandId }
}

/**
 * The mapping half only, for routes that already have an authenticated
 * `accountId` (e.g. from `requireRole`) and shouldn't re-derive "the one
 * account" independently — using the account the caller actually
 * authenticated as is more correct than re-asserting single-tenancy, and
 * is what keeps this working unchanged if multi-account ever arrives for
 * authenticated routes before it does for the anonymous ones above.
 */
export async function resolveWorkspaceBrandForAccount(
  db: AnySupabaseClient,
  accountId: string
): Promise<Pick<WorkspaceContext, 'tenantId' | 'brandId'>> {
  const { data: mapping, error: mappingError } = await db
    .from('workspace_brand_map')
    .select('tenant_id, brand_id')
    .eq('crm_workspace_id', accountId)
    .eq('is_active', true)
    .maybeSingle()

  if (mappingError) {
    throw new WorkspaceContextError(
      `Failed to resolve workspace_brand_map: ${mappingError.message}`,
      500
    )
  }
  if (!mapping) {
    throw new WorkspaceContextError(
      'No active workspace_brand_map row for this account — run the one-time seed step ' +
        'in docs/PHASE1_DEPLOYMENT_RUNBOOK.md before using any Phase 2A endpoint'
    )
  }

  return {
    tenantId: mapping.tenant_id as string,
    brandId: mapping.brand_id as string,
  }
}
