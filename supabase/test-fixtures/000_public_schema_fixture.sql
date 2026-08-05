-- ============================================================
-- TEST FIXTURE ONLY — NEVER APPLY TO PRODUCTION
--
-- Source repository:  D:\SAAS Project\Yali 2.0\Yali Build 2.0
--                     (the YALI brain app — canonical owner of the
--                     `public` schema, see docs/PHASE1_SCHEMA_OWNERSHIP.md)
-- Source files:       supabase/migrations/20260604120000_core_schema.sql
--                       → tenants, brands
--                     supabase/migrations/20260604120100_yali_extensions.sql
--                       → customers (base), orders  [lines 32-92]
--                     supabase/migrations/20260614160000_011_customers.sql
--                       → customers phone_hash/email_hash + unique index
-- Source commits:     44da263 (2026-06-07) — yali_extensions.sql
--                     0a04ef8 (2026-06-10) — 011_customers.sql
--                     repo HEAD at transcription: e54bba2 (2026-07-30)
-- Date transcribed:   2026-07-31
--
-- PURPOSE
-- A fresh local Postgres has no `public` schema tables, but the real
-- deployment target does. Migrations 038-040 FK to public.customers, so
-- without this fixture a from-zero local run fails with
-- `relation "public.customers" does not exist` (SQLSTATE 42P01) — which
-- is a defect in the TEST's realism, not in the migration. This fixture
-- reproduces the minimum real contract so the isolated run represents
-- the actual target instead of an unrealistically empty database.
--
-- COLUMNS AND INDEXES INCLUDED (the load-bearing contract for 038-042)
--   public.tenants(id)                        — FK target
--   public.brands(id, tenant_id)              — FK target
--   public.customers(id, tenant_id, brand_id,
--                    phone_hash, ...)         — FK + identity-link lookup
--   public.customers  unique (brand_id, phone_hash) WHERE phone_hash NOT NULL
--                                             — makes the many-match
--                                               branch unreachable; see
--                                               039/040 for why that
--                                               branch is still retained
--   public.orders(..., comez_order_id, ...)   — Comez idempotency test
--   public.orders    unique (brand_id, comez_order_id) WHERE NOT NULL
--                                             — ON CONFLICT target
--
-- COLUMNS INTENTIONALLY OMITTED
--   Every brain-only column with no CRM dependency: customers'
--   language_preference / bike_model / riding_style / home_state /
--   lifetime_value_inr / lead_score / sentiment / notify_subscriptions /
--   total_* counters, and orders' razorpay_* fields are present only
--   because they sit inside the copied CREATE TABLE, not because any
--   CRM migration reads them.
--   Entire brain tables with no CRM dependency are absent: sessions,
--   messages, leads, kb_*, chat_turns, realtime_turns, events_outbox,
--   commerce_connections, and ~15 others.
--
-- KNOWN LIMITATIONS — read before trusting a green local run
--   1. This is NOT a replica of the brain database. It is a stub of one
--      contract surface. A local pass does not prove the migration will
--      behave identically against the real project.
--   2. Transcribed by hand from the source DDL. If the brain repo alters
--      public.customers or public.orders, this fixture goes stale
--      SILENTLY — nothing detects the drift automatically. The structural
--      contract test in this file's companion (see the DO block at the
--      end) catches a MISSING element, not a CHANGED one upstream.
--   3. RLS policies here are copies of the brain's tenant_isolation_*
--      pattern, present so local RLS behaviour is representative — they
--      are not authoritative and must never be pushed to production.
--   4. Row counts / real data are not reproduced. Production has real
--      customers (16 at last read) and leads (46); this starts empty.
--
-- USAGE
-- Copied into supabase/migrations/ as `000_...` for a local test run,
-- then REMOVED. Never committed as a numbered migration, never applied
-- to production — production already has the real versions of these
-- tables, owned by the brain repo's own migration history.
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches Yali Build 2.0/supabase/migrations/20260604120100_yali_extensions.sql:32-61
-- plus 20260614160000_011_customers.sql's phone_hash/email_hash additions.
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  full_name TEXT,
  phone_hash TEXT,
  email_hash TEXT,
  lifetime_value NUMERIC NOT NULL DEFAULT 0,
  dormant_flag BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_brand_phone_hash_idx
  ON customers (brand_id, phone_hash) WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_brand_phone_hash_unique
  ON customers (brand_id, phone_hash) WHERE phone_hash IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customers ON customers
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Matches Yali Build 2.0/supabase/migrations/20260604120100_yali_extensions.sql:66-92
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  comez_order_id TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  total NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','fulfilled','cancelled','refunded','failed')),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  shipping_address JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_comez_unique
  ON orders(brand_id, comez_order_id) WHERE comez_order_id IS NOT NULL;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orders ON orders
  FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ============================================================
-- FIXTURE CONTRACT TEST
--
-- Fails the migration run immediately if any element migrations 038-042
-- depend on is missing. Without this, a silently-incomplete fixture
-- produces a confusing downstream failure (or worse, a false pass) far
-- from its real cause.
--
-- This asserts the fixture provides what the CRM needs. It does NOT
-- detect upstream drift in the brain repo (see KNOWN LIMITATIONS #2).
--
-- ROUND-2 BUG IN THIS TEST, for the record: the first version used
--   missing := missing || 'some text';
-- In PL/pgSQL `text[] || text` resolves ambiguously — Postgres tried to
-- parse the string as an array literal, so a genuine contract violation
-- reported `malformed array literal` instead of naming the missing
-- element. It was found only by writing a NEGATIVE CONTROL for this test
-- (dropping customers_brand_phone_hash_unique inside a rolled-back
-- transaction to confirm the test actually fails). Corrected to
-- array_append below, then re-verified in both directions: the intended
-- `FIXTURE CONTRACT VIOLATION — missing: ...` exception when an element
-- is absent, and the `Fixture contract OK` notice when present.
--
-- A test that has never been observed failing is not known to work.
-- ============================================================
DO $fixture_contract$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Required columns (identity linking, 038-040)
  IF to_regclass('public.customers') IS NULL THEN
    missing := array_append(missing, 'table public.customers');
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='customers' AND column_name='id')
      THEN missing := array_append(missing, 'public.customers.id'); END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='customers' AND column_name='tenant_id')
      THEN missing := array_append(missing, 'public.customers.tenant_id'); END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='customers' AND column_name='brand_id')
      THEN missing := array_append(missing, 'public.customers.brand_id'); END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='customers' AND column_name='phone_hash')
      THEN missing := array_append(missing, 'public.customers.phone_hash'); END IF;
  END IF;

  -- Scoped phone-hash uniqueness: the invariant that makes the
  -- identity-link many-match branch unreachable (039/040).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='customers'
      AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%brand_id%' AND indexdef ILIKE '%phone_hash%'
  ) THEN
    missing := array_append(missing, 'unique index on public.customers(brand_id, phone_hash)');
  END IF;

  -- Commerce contract (Comez idempotency test)
  IF to_regclass('public.orders') IS NULL THEN
    missing := array_append(missing, 'table public.orders');
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='orders'
      AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%brand_id%' AND indexdef ILIKE '%comez_order_id%'
  ) THEN
    missing := array_append(missing, 'unique index on public.orders(brand_id, comez_order_id)');
  END IF;

  -- FK targets
  IF to_regclass('public.tenants') IS NULL THEN missing := array_append(missing, 'table public.tenants'); END IF;
  IF to_regclass('public.brands')  IS NULL THEN missing := array_append(missing, 'table public.brands');  END IF;

  -- Required extension: pgcrypto supplies digest() for phone hashing.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN
    missing := array_append(missing, 'extension pgcrypto (digest() for phone_hash)');
  END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'FIXTURE CONTRACT VIOLATION — migrations 038-042 require these, and they are missing: %',
      array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'Fixture contract OK — all public-schema dependencies present.';
END
$fixture_contract$;
