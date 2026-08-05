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

-- PROPOSAL, not an applied migration from this repo.
--
-- public schema is owned by D:\SAAS Project\Yali 2.0\Yali Build 2.0's own
-- supabase/migrations/ (see docs/PHASE1_SCHEMA_OWNERSHIP.md). This file is
-- Phase 1's committed, ready-to-apply SQL for that repo's migration
-- history — copy it into that repo as the next-numbered file
-- (its own convention: YYYYMMDDHHMMSS_NNN_description.sql, last used
-- 20260726100000_017_realtime_turns.sql) and apply it from there via the
-- Supabase MCP apply_migration tool, the same mechanism that repo already
-- uses for its own schema. Do not apply this file directly from laddoos-crm.
--
-- Mirrors public.orders' actual shape/RLS/index conventions exactly
-- (Yali Build 2.0/supabase/migrations/20260604120100_yali_extensions.sql:
-- 32-92) rather than a guessed shape — tenant_id/brand_id NOT NULL,
-- unique index scoped to (brand_id, natural-key), tenant_isolation RLS
-- policy keyed on auth.jwt() ->> 'tenant_id'.
--
-- comez_cart_token is the natural idempotency key (Comez's cart.abandoned
-- payload always carries it, per docs/crm-dashboard-build-handoff.md).
-- No recovered_order_id column yet — deliberately deferred, see that same
-- handoff doc: the "abandoned cart recovery" dashboard metric is Phase 3
-- scope and its join shape isn't designed; a cheap ALTER TABLE ADD COLUMN
-- later beats guessing the shape now.

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  comez_cart_token TEXT NOT NULL,
  is_guest BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  products JSONB NOT NULL DEFAULT '[]'::jsonb,
  abandoned_at TIMESTAMPTZ NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abandoned_carts_brand_abandoned_idx
  ON abandoned_carts(brand_id, abandoned_at DESC);

-- Matches orders_comez_unique's exact convention: brand_id scoped (not
-- tenant_id+brand_id — brand_id already implies tenant via its own FK),
-- so a retried Comez webhook delivery upserts the same row instead of
-- duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_comez_token_unique
  ON abandoned_carts(brand_id, comez_cart_token);

ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_abandoned_carts ON abandoned_carts
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
