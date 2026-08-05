-- Phase 1 crm-schema isolation: see docs/PHASE1_SCHEMA_OWNERSHIP.md.
SET search_path = crm, public, extensions;

-- ============================================================
-- 041_crm_schema_grants
--
-- WHY THIS EXISTS
-- Found by REAL PostgREST testing against a fresh local Supabase stack
-- (docs/PHASE1_TEST_REPORT.md), not by static review. The `public` schema
-- gets USAGE granted to anon/authenticated/service_role by default in
-- every Supabase project; a newly-created schema like `crm` does NOT.
-- Nothing in 001-040 granted it, so every PostgREST request against
-- `crm.*` — including service-role — failed with 42501 even though
-- table-level RLS policies were all correctly in place.
--
-- REVISION (review round 2) — the first version of this migration had two
-- real privilege defects, both fixed below:
--
--   1. `GRANT SELECT ON ALL TABLES IN SCHEMA crm TO anon` (+ the matching
--      default privilege). Unnecessary: the only pre-auth entry point is
--      crm.peek_invitation(TEXT), a SECURITY DEFINER function that reads
--      its tables as the function OWNER, not as the caller. Anonymous
--      users need no direct table privileges at all. Removed.
--
--   2. `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA crm TO authenticated`.
--      This ran AFTER migrations 007/012/039 had deliberately done
--      `REVOKE ALL ... FROM authenticated` on specific functions, so it
--      silently RE-GRANTED execute on exactly the functions those
--      migrations locked down — e.g. increment_automation_execution_count,
--      whose own migration comment reads "Explicitly lock anon /
--      authenticated out so an authenticated user can't juice someone
--      else's counter via RPC." A blanket grant here defeats every
--      per-function decision made earlier in the chain. Removed.
--
-- PRIVILEGE MODEL (authoritative statement for the crm schema)
--   * Every function's intended grants are declared in ITS OWN migration.
--     This file must never issue a blanket function grant, or it will
--     override those decisions again. Future migrations that add a
--     function must declare that function's own REVOKE/GRANT.
--   * RLS remains the authorization boundary for table access. The table
--     grants below are the prerequisite PostgREST needs before RLS is
--     ever evaluated, not a replacement for it.
--   * anon gets USAGE + exactly one function. Nothing else.
-- ============================================================

-- ── Schema usage ────────────────────────────────────────────
GRANT USAGE ON SCHEMA crm TO anon, authenticated, service_role;

-- ── Table + sequence privileges (RLS gates the rows) ────────
-- Deliberately NOT granted to anon: no anonymous flow reads a crm table
-- directly (see peek_invitation note above).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crm
  TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crm
  TO authenticated, service_role;

-- ── Anonymous surface: exactly one function ─────────────────
-- Re-asserted here (019 already grants it) so this file is a complete,
-- readable statement of what anon can reach. peek_invitation lets an
-- unauthenticated visitor see "you've been invited to <account>" on
-- /join/<token> before signing in.
--
-- NOTE: crm.redeem_invitation(TEXT) is deliberately NOT granted to anon.
-- It assigns the invitation to auth.uid(), which an anonymous session
-- does not have — anonymous redemption is impossible by design, not an
-- oversight. Do not "fix" this by granting anon.
GRANT EXECUTE ON FUNCTION crm.peek_invitation(TEXT) TO anon;

-- ── Function hardening: close the PUBLIC default ────────────
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. Migrations
-- 007/012/018/019/022/025/029/030/031/032/036/039 already revoke that for
-- the functions they create. The functions below were created WITHOUT an
-- explicit revoke, so PUBLIC (and therefore anon) can currently execute
-- them. Each is SECURITY DEFINER with real data access, so that default
-- is a genuine hole. Closed individually with exact signatures.

-- Reads public.customers by (tenant, brand, phone hash). Left open, this
-- is a customer-enumeration oracle for anyone who can guess a phone
-- number. Only ever called from link_contact_to_customer(), which is
-- SECURITY DEFINER and runs as the owner — so no role grant is needed.
REVOKE ALL ON FUNCTION crm.resolve_customer_candidates(TEXT, UUID, UUID) FROM PUBLIC;

-- Mutates crm.contacts' customer linkage. Service-role only (the
-- reconciliation path); the trigger calls it as the owner.
REVOKE ALL ON FUNCTION crm.link_contact_to_customer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.link_contact_to_customer(UUID) TO service_role;

-- Trigger functions: only ever invoked by the trigger, as the table
-- owner. No role needs a direct grant.
REVOKE ALL ON FUNCTION crm.contacts_link_customer_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.handle_wacrm_user_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.notify_conversation_assigned() FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.broadcast_recipient_aggregate_trigger() FROM PUBLIC;

-- Arbitrary ±1 on any broadcast counter column, for any broadcast id —
-- cross-account counter tampering if left executable. Trigger-internal only.
REVOKE ALL ON FUNCTION crm._bcast_bump(UUID, TEXT, INT) FROM PUBLIC;

-- Ops safety-net (recompute counters after manual DB surgery).
REVOKE ALL ON FUNCTION crm.recompute_broadcast_counts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.recompute_broadcast_counts(UUID) TO service_role;

-- Writes webhook_endpoints failure state. Flagged as a pre-existing gap
-- in docs/PHASE1_MIGRATION_AUDIT.md §2 — 028 creates it with no revoke.
REVOKE ALL ON FUNCTION crm.record_webhook_failure(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.record_webhook_failure(uuid, integer) TO service_role;

-- Presence heartbeat — legitimately called by signed-in users, never anon.
REVOKE ALL ON FUNCTION crm.touch_presence(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.touch_presence(TEXT) TO authenticated;

-- Membership probe. 017 grants authenticated+service_role but never
-- revoked the PUBLIC default, leaving anon able to probe account ids.
REVOKE ALL ON FUNCTION crm.is_account_member(UUID, crm.account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.is_account_member(UUID, crm.account_role_enum)
  TO authenticated, service_role;

-- ── Default privileges for FUTURE objects ───────────────────
-- Tables/sequences only, and only for authenticated/service_role. This
-- mirrors how Supabase treats the `public` schema, so a future migration
-- that adds a crm table behaves the way a developer expects (reachable,
-- gated by RLS).
--
-- Deliberately NOT included:
--   * anon — no anonymous flow reads crm tables directly.
--   * EXECUTE ON FUNCTIONS — a default function grant would re-create
--     defect #2 above for every future function, silently overriding
--     any deliberate lockout. New functions declare their own grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA crm
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
