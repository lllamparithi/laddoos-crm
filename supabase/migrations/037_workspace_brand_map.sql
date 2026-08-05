-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 037_workspace_brand_map
--
-- Explicit scope mapping between a wacrm "account" (crm workspace) and
-- the Yali brain's (tenant_id, brand_id) identity space. Required before
-- any crm.contacts <-> public.customers linking: identity matching must
-- always go workspace -> tenant/brand -> normalized phone hash -> customer,
-- never a bare cross-database phone_hash match (a phone hash could
-- theoretically collide across two different brands' customer bases).
--
-- One active mapping per workspace by default (idx below) — this repo's
-- own account is single-tenant (Laddoos only, see docs/
-- crm-dashboard-build-handoff.md), so "one workspace, ambiguously many
-- tenant/brands" is deliberately not supported yet.
--
-- NOTE: no row is seeded here. The wacrm account this maps doesn't exist
-- until the first user signs up (crm.handle_wacrm_user_created creates it).
-- Seeding the actual Laddoos row (tenant_id 7a1a52f2-1bc0-444c-b6b3-
-- 6ec44c51e39b, brand_id cce781df-c17f-4791-a183-5a9683a93ad1) is a
-- documented manual step in docs/PHASE1_DEPLOYMENT_RUNBOOK.md, run once
-- the account exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_brand_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_workspace_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  brand_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_brand_map_active_workspace
  ON workspace_brand_map (crm_workspace_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_workspace_brand_map_tenant_brand
  ON workspace_brand_map (tenant_id, brand_id);

ALTER TABLE workspace_brand_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_brand_map_account_read ON workspace_brand_map;
CREATE POLICY workspace_brand_map_account_read ON workspace_brand_map
  FOR SELECT USING (is_account_member(crm_workspace_id));

-- High-stakes mapping — only admins/owners may change it, not every agent.
DROP POLICY IF EXISTS workspace_brand_map_account_write ON workspace_brand_map;
CREATE POLICY workspace_brand_map_account_write ON workspace_brand_map
  FOR ALL USING (is_account_member(crm_workspace_id, 'admin'))
  WITH CHECK (is_account_member(crm_workspace_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON workspace_brand_map;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_brand_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
