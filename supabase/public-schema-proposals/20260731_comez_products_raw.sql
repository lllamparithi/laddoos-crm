-- PROPOSAL ONLY
-- DO NOT APPLY FROM laddoos-crm
-- Canonical owner: YALI brain/public-schema migration repository
--   (D:\SAAS Project\Yali 2.0\Yali Build 2.0, supabase/migrations/)
-- Requires real Comez payload verification before adoption
--
-- This file lives OUTSIDE supabase/migrations/ on purpose: the Supabase
-- CLI only executes files inside that directory, so `supabase db reset`
-- and `supabase db push` will never run this. Do not move it in.
--
-- See docs/PHASE1_SCHEMA_OWNERSHIP.md for why public-schema objects are
-- not part of this repo's migration chain.

-- PROPOSAL, not an applied migration from this repo. See the header of
-- 20260731_abandoned_carts.sql in this same folder for how/where to apply.
--
-- Per this phase's explicit instruction: do NOT create a guessed
-- normalized products/variants/inventory model until at least one real
-- getallproducts/inventory payload has been captured (the Comez adapter
-- in Yali Build 2.0's src/channels/commerce/index.ts is confirmed
-- unimplemented — "Comez adapter not yet implemented — blocked on Nutz
-- API spec" — so no real payload exists yet to design against). This is
-- a raw staging table only; the eventual normalized model (products,
-- product_variants, inventory_locations, inventory_levels, prices,
-- bundles) is future work once a real payload is captured.

CREATE TABLE IF NOT EXISTS comez_products_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  comez_product_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, brand_id, comez_product_id)
);

CREATE INDEX IF NOT EXISTS comez_products_raw_brand_idx
  ON comez_products_raw(brand_id, fetched_at DESC);

ALTER TABLE comez_products_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_comez_products_raw ON comez_products_raw
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
