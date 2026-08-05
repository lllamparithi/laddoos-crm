# Phase 1 — Deployment Runbook

> ## ⛔ DO NOT RUN `supabase db push` FROM `laddoos-crm` AGAINST PRODUCTION.
>
> This repo shares one Supabase project — and therefore one
> `supabase_migrations.schema_migrations` ledger — with the YALI brain
> repo. A `db push` from here would compare local numeric versions
> (`001`–`042`) against the brain's timestamp-versioned rows and either
> refuse, or invite a `supabase migration repair` that rewrites ledger
> entries belonging to the other repository.
>
> The CLI is for **local development only** (`supabase start`,
> `npm run db:test:reset`). See
> `docs/PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`. **A1 is now resolved:
> MCP `apply_migration` is the approved method** (2026-08-01) — which
> makes the `db push` prohibition above binding, not advisory.

> ## ⚠️ SCOPE: this runbook now covers `001`–`047`, not `001`–`042`.
>
> It was written for Phase 1 (`001`–`042`); Phase 2A added `043`–`046`
> (`identity_handles`, `identity_evidence`, `timeline_events`,
> `continuation_tokens`), and the post-exposure security audit added
> `047` (`revoke_claim_ai_reply_slot_public`). Sections 2, 4 and 5 have
> been updated. **Anyone following an older copy would apply 42 of 47
> migrations and leave the Phase 2A tables missing** — with the app
> deployed against them.

## ✅ PRODUCTION APPLY: **COMPLETE** — `001`–`047` applied 2026-08-04

> **All 47 CRM migrations are applied to `ugjishankutgfegplrgq`.**
> Founder-approved, backup/restore gate satisfied, applied one file at a
> time via Supabase MCP `apply_migration` in strict numeric order.
> **Zero errors. Zero rollbacks. No `supabase db push` was ever run.**
> The `000_public_schema_fixture.sql` test stub was never applied.
>
> `001`–`046` were applied first. `crm` was then exposed in PostgREST,
> a read-only audit found the `claim_ai_reply_slot` hole, and **`047`
> was applied the same day to close it** — so `047` lands *after*
> exposure in the timeline, not alongside the Phase 1/2A batch.
>
> | | |
> |---|---|
> | Ledger rows for CRM | **47**, `001_initial_schema` .. `047_revoke_claim_ai_reply_slot_public`, no gaps, no duplicates |
> | `crm` base tables | **44** |
> | Phase 2A tables | all **6** present |
> | `timeline_events` PK | **composite `(id, occurred_at)`** — partitioning-ready, as designed |
> | `public` base tables | **29** — unchanged from pre-apply |
> | Brain data (customers/leads/orders) | **21 / 62 / 0** — unchanged |
> | wacrm tables leaked into `public` | **NONE** |
> | Realtime publication | `crm.*` only (6 tables), no `public.*` |
> | `auth.users` triggers | `on_auth_user_created_wacrm` only |
>
> **`047` — the security hotfix, and why it exists as a file.**
> `crm.claim_ai_reply_slot(uuid, integer)` is SECURITY DEFINER and was
> executable by `anon` over PostgREST RPC the moment `crm` went live:
> `029`/`031` granted `service_role` but never revoked PostgreSQL's
> default EXECUTE-to-PUBLIC, and `041`'s enumerated revoke list omitted
> it. `047` closes it. **It is already applied to production** (ledger
> name `047_revoke_claim_ai_reply_slot_public`); the local file at
> `supabase/migrations/047_revoke_claim_ai_reply_slot_public.sql` was
> written to *match* that applied change, so a from-zero local run
> reproduces production instead of silently rebuilding the vulnerable
> state. **Do not apply it again** — it is idempotent, but it is already
> there. `047` also consumed the number `PHASE2_CANONICAL_PLAN.md` §2 had
> reserved for Phase 2B; **Phase 2B starts at `048`+** unless a new
> canonical plan supersedes that.
>
> **Two safety findings worth carrying forward:**
>
> 1. **`SET search_path` persistence was verified before applying.** Every
>    migration uses *unqualified* `CREATE TABLE` and relies on
>    `SET search_path = crm, public`. Had MCP not preserved that across
>    statements, `CREATE TABLE IF NOT EXISTS messages` would have silently
>    bound to the brain's pre-existing `public.messages` — a silent,
>    destructive no-op. Confirmed safe with a zero-write probe first.
> 2. **`public.messages` already existed** and is the *brain's* table
>    (`tenant_id/brand_id/role/content`, 0 rows) — not a wacrm object.
>    Verified before proceeding, and confirmed unchanged afterwards.
>
> ### ⛔ STILL NOT DONE — do not skip these
>
> - ~~**`crm` is NOT exposed in PostgREST** (§3).~~ **Done 2026-08-04** —
>   exposed, then audited read-only, which is what surfaced `047`.
>   Anon table reads all return `42501`, verified live.
> - **The app is NOT deployed** (§9). ← **this is now the next step**
> - **§6's `workspace_brand_map` seed has NOT been run** — it cannot be,
>   until the first admin signs up (`crm.accounts` is empty). Without it,
>   `link_contact_to_customer()` silently no-ops and every Phase 2A
>   anonymous endpoint returns "Service not configured".

The build is finished and verified in isolation, and the **method**
question (blocker 3 / A1) is now settled. What remains is entirely human:
a commit, a reviewer, a real backup with verified restore, a dashboard
change, and an approved window.

### Production-readiness checklist

```text
[ ] Phase 1 + 2A changes committed
[ ] Independent PR review completed
[x] Anonymous grants narrowed and tested
[x] Shared migration-ledger application method approved  ← A1 RESOLVED 2026-08-01:
                                                           MCP apply_migration only
[x] Public-schema ownership confirmed
[x] Generated-type follow-up documented
[x] Test fixture source commit recorded
[x] Realtime update/delete behavior verified
[x] Full 001-046 chain re-verified from zero (2026-08-01, 0 errors)
                                                     (047 postdates this run)
[x] Backup/restore gate package prepared             ← PHASE1_BACKUP_RESTORE_GATE.md
[x] Production backup created                        (2026-08-04, pg_dump)
[x] Backup reference recorded                        (SHA-256 verified, 2 copies)
[x] Restore procedure verified BY TESTING            (pgvector scratch, counts matched)
[x] Migration apply APPROVED by founder              (2026-08-04)
[x] MIGRATIONS 001-046 APPLIED TO PRODUCTION         (2026-08-04, 0 errors)
[x] crm added to hosted PostgREST exposed schemas    (2026-08-04, audited)
[x] MIGRATION 047 APPLIED TO PRODUCTION              (2026-08-04, security
                                                      hotfix from that audit)
[ ] Application deployed                             ← NEXT STEP
[ ] workspace_brand_map seeded (§6)                  ← after first admin signup
[x] Deployment and rollback window approved
[x] Exact migration command reviewed
[x] Post-apply smoke-test script ready
[x] Rollback procedure ready
[x] Immediately pre-deploy: re-confirmed no wacrm-owned objects or
    conflicting CRM migration records existed (2026-08-04 preflight)
```

**Four items remain open:** commit, PR review, application deploy, and
the `workspace_brand_map` seed. None is a migration blocker — every
database step is done, `001`–`047` inclusive. (An earlier revision of
this line read "fifteen of eighteen"; the checklist has grown since and
the tally was stale, so it is stated qualitatively now.)

**A1 (blocker 3) is closed.** Production applies from this repo go
through the Supabase MCP `apply_migration` tool only; `supabase db push`
against production is forbidden. Options B (renumber), C (move to the
shared repo) and D (reviewed bundle) are closed. Note that B is no longer
a free fallback — renumbering had to happen before the first apply.

**Approving the method is not approving the deploy.** Every remaining
unticked box above is still a hard gate. The backup/restore gate in §1 is
the immediate one and cannot be satisfied from an engineering session —
it needs the founder to actually take and verify a backup. Do not fake a
field to make this look green.

---

## FOUNDER INPUTS REQUIRED — nothing proceeds without these

Every item below needs a human. None can be produced from an engineering
session, and none should be ticked from memory. **Answer them in order —
1 gates everything else.**

### 1 + 2. Backup and tested restore ← THE SINGLE NEXT BLOCKER

**→ `docs/PHASE1_BACKUP_RESTORE_GATE.md`** — fill that in. It is the
single authoritative, fillable evidence record for this gate, and it
covers both branches (paid plan with automatic backups/PITR, versus Free
where a manual `pg_dump` is mandatory), the exact `pg_dump` command
template, and the exact restore-test pass criteria.

Deliberately not duplicated here — this runbook previously carried its
own partial copy of these fields in two separate places, which is exactly
how two versions of a safety checklist drift apart.

Summary of what it demands, so nobody skips it thinking it is a
formality: project ref + plan/tier, backup method, backup reference,
UTC timestamp under one hour old, who created it, where it is stored, a
written restore procedure, **a restore that was actually executed against
a scratch target**, where that happened, and a named human approving the
proceed.

### 3. Exposed schemas

- [ ] Confirm you can add `crm` in Supabase Dashboard → Settings → API →
      Exposed schemas, and that doing so is acceptable on this shared
      project (the brain repo also uses it).
- [ ] Confirm nobody objects to `crm` becoming PostgREST-reachable.

### 4. Migration window approval

| Field | Needed |
|---|---|
| Window (UTC start–end) | |
| Rollback decision owner | Who can call an abort mid-apply |
| Who is on call during it | |

Applying 46 migrations one at a time is not instant. Pick a window when
real WhatsApp/voice traffic is low — the brain repo shares this database.

### 5. DNS + deploy plan for `admin.laddoosdotcom.in`

Verified 2026-08-01: **the hostname does not resolve.** There is no CRM
deployment anywhere yet.

- [ ] Decide the host (Vercel, Hostinger Managed Node.js, the existing VPS…)
      — §9 records this was never decided.
- [ ] Create the DNS record and confirm TLS.
- [ ] Confirm the deploy method. Note the website repo's own CLAUDE.md
      records that Vercel Hobby blocks GitHub auto-deploy for this account
      ("commit author does not have contributing access") and that the
      working path was the **Vercel CLI** — expect the same here.

This is needed for the *app*, not the migrations. Migrations can be
applied before the app exists; the app just cannot serve until §3 is done.

### 6. Not required for this apply

- Committing/PR-review of Phase 1+2A is still open, but it gates *your*
  process, not the database.
- `admin.laddoosdotcom.in` and the website's
  `NEXT_PUBLIC_YALI_CRM_API_BASE_URL` are Phase 2A *staging* concerns —
  see `PHASE2A_STAGING_RUNBOOK.md`. Do not conflate them with this apply.

---

### Verified in isolation (the engineering gate)

- [x] Full migration chain (`000` fixture + `001`-`046`, **47 files**)
      applies from zero — clean run, zero errors, 2026-08-01,
      `docs/phase1-test-logs/db-reset-clean-run-001-046.log`
      *(the older `db-reset-clean-run.log` stops at `042` / 43 files and
      is the Phase 1 record only — do not cite it for this chain)*
- [x] Schema isolation — `public` contains only the 4 fixture tables, no
      wacrm object; `crm` has **44 tables** (38 at Phase 1, +6 from
      Phase 2A's `043`-`046`), 0 views, 0 sequences
- [x] Function privilege audit — 13 sensitive functions checked
      individually; `authenticated` correctly denied on service-role-only
      functions, `anon` denied on all but `peek_invitation`
- [x] Anonymous surface — `peek_invitation` succeeds; direct table
      SELECT/INSERT, `redeem_invitation`, and internal functions all
      correctly denied (4 negative controls + 1 positive)
- [x] Invitation flow end-to-end — anon peek → authenticated redeem →
      user actually joins the workspace with the right role
- [x] RLS read + write isolation across two real workspaces, with a
      positive control and a literal-ID cross-tenant write rejection
- [x] Realtime — 10/10 event families incl. all three `REPLICA IDENTITY
      FULL` DELETE paths, plus cross-workspace isolation
- [x] Auth trigger on a real `auth.users` insert
- [x] Comez order idempotency (6× duplicate delivery → 1 row)
- [x] Identity linking — exact/none/unlinkable/late-arrival/manual-link
      protection/reconciliation idempotency/`ON DELETE SET NULL`
- [x] Phone normalization + linkability against the applied functions
- [x] `npm run typecheck` / `build` / `test` — **839/839** as of
      2026-08-01 (654/654 was the Phase 1 baseline; Phase 2A's
      repository/service, API and web-SDK tests took it to 839)
- [x] Phase 2A specifics — all six `043`-`046` tables present after a
      from-zero run; `timeline_events` primary key is the composite
      `(id, occurred_at)`; `crm.messages` unaffected

**Known non-blocking gaps**, both documented rather than hidden:

- Abandoned-cart idempotency is untested — that table belongs to the
  brain repo's migration set, not this chain
  (`supabase/public-schema-proposals/`).
- The app is verified against `AnySupabaseClient`, not the real generated
  types. Adopting them surfaces 58 pre-existing mismatches — tracked as
  `docs/PHASE1_1_GENERATED_TYPES_ADOPTION.md`, deliberately out of scope.

**Do not run this runbook's apply steps yet.** Re-verify against
production immediately before applying — a local pass does not certify
the real target's current state.

## 0. Prerequisite: fresh-database test — SATISFIED

Done. Reproduce with:

```bash
npx supabase start
npm run db:test:reset
```

`db:test:reset` stages `supabase/test-fixtures/000_public_schema_fixture.sql`
into `migrations/`, runs `supabase db reset` (full chain from zero), then
removes the fixture copy. Latest clean-run log:
`docs/phase1-test-logs/db-reset-clean-run.log`.

**`supabase db push` against production is FORBIDDEN from this repo** —
see `docs/PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`. Production applies go
through the Supabase MCP `apply_migration` tool only (§4).

## 1. Production backup — MANDATORY

> ### ⛔ THE GATE LIVES IN ITS OWN FILE NOW
>
> **→ `docs/PHASE1_BACKUP_RESTORE_GATE.md`**
>
> Backup method/reference/timestamp/owner, the branch for Free-plan
> projects with no automatic backups, the exact `pg_dump` template, the
> exact restore-test pass criteria, and the sign-off all live there. Fill
> it in and keep it as the evidence record.
>
> **Do not proceed past this section until that file is complete.** An
> unfilled field is a blocked deploy, not a formality.

The fields below are the *apply-time* captures, still done here as part
of the deploy — they are separate from the backup gate itself:

```text
Production project:              ugjishankutgfegplrgq
Pre-migration schema snapshot:   ________________________________
Pre-migration row counts:        customers ____  leads ____  orders ____
                                 (an earlier session saw 16 / 46 / 0 —
                                  STALE, the brain writes continuously,
                                  so re-measure rather than compare)
Maintenance window (UTC):        ________________________________
Rollback decision owner:         ________________________________
```

**Capture the pre-migration schema snapshot and row counts** — these are
the only way to prove afterwards that `public` was untouched:

```sql
-- Schema snapshot
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema IN ('public','crm') ORDER BY 1,2;

-- Row counts
SELECT 'customers' t, count(*) FROM public.customers
UNION ALL SELECT 'leads', count(*) FROM public.leads
UNION ALL SELECT 'orders', count(*) FROM public.orders;

-- Existing auth.users triggers (must not change)
SELECT tgname FROM pg_trigger
WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal;
```

### Rollback triggers — any ONE of these aborts and rolls back

| # | Trigger condition | How you'd see it |
|---|---|---|
| 1 | Any migration in the chain errors | apply step fails |
| 2 | PostgREST requests to `crm.*` fail | §5 smoke test returns 42501/404 |
| 3 | Auth signup trigger fails | new signup produces no `crm.profiles` row |
| 4 | Realtime subscriptions receive no events | inbox doesn't live-update |
| 5 | Cross-workspace RLS leakage | §5 isolation check returns other-account rows |
| 6 | WhatsApp webhook writes fail | webhook 5xx / no new `crm.messages` |
| 7 | App cannot read CRM records | dashboard empty or erroring |
| 8 | **Any unexpected change in `public`** | schema snapshot / row counts differ |

### Rollback commands (all Phase 1-owned changes)

Phase 1 is schema-isolated by design, so rollback is narrow:

```sql
-- 1. Drop the CRM schema and everything in it.
DROP SCHEMA IF EXISTS crm CASCADE;

-- 2. The auth trigger lives on auth.users, OUTSIDE the crm schema —
--    CASCADE above will NOT remove it. Must be explicit.
DROP TRIGGER IF EXISTS on_auth_user_created_wacrm ON auth.users;

-- 3. Realtime publication entries for crm tables disappear with the
--    schema drop, but verify:
SELECT schemaname, tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='crm';   -- expect 0 rows

-- 4. Verify public is untouched — compare against the §1 snapshot.
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema='public' ORDER BY 2;
```

Then: remove `crm` from Settings → API → Exposed schemas, and redeploy
the previous application commit.

**Nothing in Phase 1's chain writes to `public`.** The only `public`
interaction is a read-only `SELECT` on `public.customers` inside
`crm.resolve_customer_candidates()`. If a rollback finds `public`
changed, something outside this runbook did it — investigate before
restoring, don't assume the backup is the fix.

## 2. Confirm migrations 001-047 are still unapplied

> **Historical for `ugjishankutgfegplrgq`.** All 47 are applied as of
> 2026-08-04, so these checks will now *fail by design* against
> production. They apply to a fresh environment only.

Re-run before applying, don't trust this doc's staleness:

```sql
-- No wacrm-owned relation has appeared in public
SELECT table_name FROM information_schema.tables
WHERE table_schema IN ('public') AND table_name IN
  ('contacts','conversations','accounts','profiles','pipelines');

-- The crm schema does not exist yet at all
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'crm';

-- No CRM migration has been recorded in the shared ledger
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
-- Expect ONLY the brain repo's 14-digit timestamp rows. Any row whose name
-- matches a file in this repo means a partial apply already happened — STOP.
```

Expect zero rows from the first two. If any exist, STOP — something
changed since this phase's audit, don't proceed until you understand why.

## 3. Add `crm` to PostgREST exposed schemas (manual, dashboard)

Supabase Dashboard → Settings → API → Exposed schemas → add `crm`. Must
happen before or atomically with step 5's app deploy — PostgREST 404s
`crm`-scoped requests otherwise. (Local: `supabase/config.toml`'s
`[api].schemas` already includes `crm` — see that file's own header for
why it's unvalidated against a real `supabase start` in this repo.)

## 4. Apply migrations 001-047, in order

> ⛔ **GATE CHECK — do not start this section until
> `docs/PHASE1_BACKUP_RESTORE_GATE.md` §D is signed.** If §B or §C has a
> blank field or "restore tested = no", stop here. This is the last point
> at which stopping is free.

**Method (A1, approved 2026-08-01): Supabase MCP `apply_migration` only.**
One file at a time, strict numeric order, `001` → `047`. `supabase db
push` is forbidden — see the banner at the top of this file.

> **This section is now historical for `ugjishankutgfegplrgq`** — all 47
> are applied (2026-08-04). It remains here as the procedure for a
> from-zero rebuild or a new environment. If you are rebuilding, **`047`
> is not optional**: stopping at `046` recreates the `claim_ai_reply_slot`
> privilege hole the moment `crm` is exposed in PostgREST.

For each file, in this exact order:

```text
001_initial_schema                  024_member_presence
002_pipelines_enhancements          025_filter_contacts_by_tags
003_broadcast_recipient_wamid       026_api_keys
004_contact_delete_set_null         027_notifications
005_broadcast_counts_incremental    028_webhook_endpoints
006_automations                     029_ai_reply
007_automations_increment_counter   030_ai_knowledge
008_profile_avatars_storage         031_ai_reply_slot_grant
009_message_actions                 032_fix_ai_knowledge_membership
010_flows                           033_ai_reply_polish
011_profile_beta_features           034_fix_profiles_update_rls
012_flows_increment_counter         035_interactive_messages
013_whatsapp_config_phone_number…   036_conversation_contact_dedup
014_message_templates_meta_integ…   037_workspace_brand_map
015_whatsapp_config_registration    038_phone_normalization
016_flow_media                      039_identity_linking
017_account_sharing                 040_phone_linkability_guard
018_account_member_rpcs             041_crm_schema_grants
019_invitation_rpcs                 042_realtime_replica_identity
020_account_sharing_followups       ── Phase 2A ──────────────────
021_account_default_currency        043_identity_handles
022_contact_phone_dedup             044_identity_evidence
023_chat_media                      045_timeline_events
                                    046_continuation_tokens
                                    ── security hotfix ───────────
                                    047_revoke_claim_ai_reply_slot_public
```

`047` was authored *after* `crm` was exposed and the audit found the
hole, so on the production timeline it followed §3, not §4. On a
from-zero rebuild just apply it in numeric order with the rest — it is
order-independent (a `REVOKE`/`GRANT` on a function `029` already
created) and idempotent.

Rules while applying:

- **Pass the migration `name` matching the filename** (without `.sql`).
  MCP assigns its own 14-digit timestamp version at apply time — that is
  exactly why this method was chosen, so CRM rows sort and format
  consistently with the brain repo's existing ledger rows.
- **Stop on the first error.** Do not continue past a failure and do not
  retry a partially-applied file blind — diagnose it. Rollback trigger 1
  applies.
- **Do NOT apply `000_public_schema_fixture.sql`.** It is a local test
  stub for the brain's `public` tables and must never reach production.
  It is gitignored inside `migrations/` and only staged during
  `npm run db:test:reset`. Confirm `supabase/migrations/` contains exactly
  46 files and no `000_` before starting.
- Expect `NOTICE ... does not exist, skipping` lines from the
  `DROP ... IF EXISTS` guards. Those are normal on a fresh database and
  are not errors.

### Evidence this chain applies cleanly from zero

`docs/phase1-test-logs/db-reset-clean-run-001-046.log` — the full
`000` fixture + `001`–`046` (47 files) run against a from-zero local
stack on 2026-08-01: **0 errors**, resulting in 44 `crm` tables, all six
Phase 2A tables present, and `public` containing only the 4 fixture
tables. The older `db-reset-clean-run.log` stops at `042` and is retained
as the Phase 1 record only — do not use it as evidence for this chain.

## 5. Verify grants, RLS, Realtime

```sql
-- No wacrm relation exists in public
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_name IN ('contacts','conversations','accounts') AND table_schema = 'public';
-- expect 0 rows

-- crm objects exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm' ORDER BY 1;
-- expect 44 base tables (measured on the 2026-08-01 from-zero run), including
-- contacts, conversations, accounts, workspace_brand_map, identity_link_conflicts

-- Phase 2A's six tables specifically (043-046) — the ones an old copy of this
-- runbook would have silently skipped
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'crm' AND table_name IN
  ('identity_handles','identity_evidence','identity_evidence_policy',
   'timeline_events','timeline_event_types','continuation_tokens')
ORDER BY 1;
-- expect exactly 6 rows

-- timeline_events must have the COMPOSITE primary key (id, occurred_at) —
-- partitioning readiness, see PHASE2_CANONICAL_PLAN.md §3
SELECT a.attname FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
WHERE i.indrelid = 'crm.timeline_events'::regclass AND i.indisprimary;
-- expect two rows: id, occurred_at

-- Realtime publication is schema-correct
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- expect crm.messages, crm.conversations, crm.message_reactions, crm.flow_runs,
-- crm.member_presence, crm.notifications — NOT public.* versions of these names

-- Auth trigger is namespaced, doesn't collide
SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
-- expect on_auth_user_created_wacrm only (plus any future YALI-side trigger, which
-- must use a different name — see PHASE1_MIGRATION_AUDIT.md §9)
```

Then run `get_advisors(type: "security")` via the Supabase MCP and review
anything new against `crm.*` objects.

## 6. Seed the Laddoos workspace_brand_map row

`037_workspace_brand_map.sql` deliberately seeds nothing (the wacrm
`accounts` row doesn't exist until the first user signs up). After the
first Laddoos admin signs up:

> ### ⚠️ The previous version of this step did not work. Do not use it.
>
> It read the account via `auth.uid()`:
>
> ```sql
> (SELECT account_id FROM crm.profiles WHERE user_id = auth.uid())  -- BROKEN
> ```
>
> **`auth.uid()` returns NULL in the Supabase SQL editor.** The editor
> runs as `postgres`, not as an end user, so there is no JWT and
> `request.jwt.claims` is unset. The subquery then matches no row,
> yields NULL, and `crm_workspace_id` is `NOT NULL` — so the statement
> **fails outright**:
>
> ```text
> ERROR: null value in column "crm_workspace_id" of relation
>        "workspace_brand_map" violates not-null constraint
> ```
>
> Reproduced against the local stack on 2026-08-02, not reasoned about.
> It fails loudly rather than seeding the wrong row, which is the good
> outcome — but it fails at a point in the deploy where you do not want
> to be debugging. `auth.uid()` is only valid from a request carrying a
> user JWT (PostgREST, the app, an RLS policy) — never from dashboard SQL.

Run these three statements in order, from the Supabase SQL editor.

**6a — find the account. Read the output; don't guess the id.**

```sql
SELECT a.id AS account_id, a.name, u.email AS owner_email, a.created_at
FROM crm.accounts a
JOIN auth.users u ON u.id = a.owner_user_id
ORDER BY a.created_at;
```

Expect **exactly one row** at this stage. If you see none, the first
admin has not signed up yet — stop and do that first. If you see more
than one, stop: Phase 2A's anonymous endpoints call
`resolveSingleAccountWorkspaceContext()`, which deliberately fails loudly
when more than one `crm.accounts` row exists.

**6b — insert the mapping, pasting the id from 6a.**

```sql
INSERT INTO crm.workspace_brand_map (crm_workspace_id, tenant_id, brand_id, is_active)
VALUES (
  '<paste account_id from 6a>',
  '7a1a52f2-1bc0-444c-b6b3-6ec44c51e39b', -- Laddoos tenant_id
  'cce781df-c17f-4791-a183-5a9683a93ad1', -- Laddoos brand_id
  true
);
```

If you would rather not copy-paste a UUID by hand, this single statement
is equivalent and was verified working — substitute the real owner email:

```sql
INSERT INTO crm.workspace_brand_map (crm_workspace_id, tenant_id, brand_id, is_active)
SELECT a.id,
       '7a1a52f2-1bc0-444c-b6b3-6ec44c51e39b',
       'cce781df-c17f-4791-a183-5a9683a93ad1',
       true
FROM crm.accounts a
JOIN auth.users u ON u.id = a.owner_user_id
WHERE u.email = '<the Laddoos admin email>';
```

Check it reports `INSERT 0 1`. `INSERT 0 0` means the email matched
nothing — no row was created, and the mapping is still missing.

**6c — verify.**

```sql
SELECT a.name, m.crm_workspace_id, m.tenant_id, m.brand_id, m.is_active
FROM crm.workspace_brand_map m
JOIN crm.accounts a ON a.id = m.crm_workspace_id;
```

Expect one row, `is_active = true`, with the two Laddoos UUIDs above.

> **Running 6b twice fails, by design.**
> `idx_workspace_brand_map_active_workspace` is a partial unique index on
> `crm_workspace_id WHERE is_active`, so a second active mapping for the
> same workspace is rejected:
> `duplicate key value violates unique constraint`. That is the
> constraint working — deactivate the old row rather than inserting a
> second one.

Without this row, `link_contact_to_customer()` silently no-ops for every
contact (documented behavior — "no workspace mapping yet" — not a bug),
and every Phase 2A anonymous endpoint returns "Service not configured".

## 7. Apply the public-schema commerce proposals (separate repo action)

`supabase/public-schema-proposals/20260731_abandoned_carts.sql` and
`20260731_comez_products_raw.sql` are **not** applied from this repo —
copy them into `Yali Build 2.0`'s own `supabase/migrations/` (next
sequence number after `20260726100000_017_realtime_turns.sql`) and apply
from there, per `PHASE1_SCHEMA_OWNERSHIP.md`'s ownership split. Do this
in a session scoped to that repo, not bundled into a `crm` deploy.

## 8. Run database smoke tests

Repeat the 11 phone-normalization fixture cases from
`PHASE1_TEST_REPORT.md` against the now-real `crm.normalise_phone_e164`
(not `pg_temp`) to confirm the applied version behaves identically.
Insert one throwaway `crm.contacts` row with a known phone, confirm the
`trg_contacts_link_customer` trigger fires and either links, stays
unlinked, or records a conflict as expected — then delete the test row.

## 9. Deploy schema-aware application code

Standard wacrm deploy (Hostinger Managed Node.js per its own README, or
wherever this fork ends up hosted — not yet decided, see the original
`crm-dashboard-build-handoff.md`). Set env vars per `.env.local.example`
(unchanged by Phase 1) plus nothing new — the schema selection is in code
(`db: { schema: 'crm' }`), not an env var.

**Do not deploy before step 3** (PostgREST exposing `crm`) — the deployed
app's `createClient()` calls will 400/404 on every query otherwise.

## 10. Regenerate and deploy TypeScript types

```bash
npm run gen:types:crm
```

Then update `src/lib/supabase/database.types.ts` to import the real
generated `crm` types instead of leaving it public-only (see that file's
own header comment — this is the point where that comment becomes
outdated and should be deleted). Re-run `npm run typecheck` — expect some
of the `AnySupabaseClient`/cast workarounds from Phase 1
(`src/lib/supabase/any-client.ts`, the `as unknown as` cast in
`src/app/api/whatsapp/webhook/route.ts`) to become tightenable now that
real row types exist; tightening them is optional follow-up work, not
required for this deploy.

## 11. Monitoring

Watch for the first hour post-deploy: webhook failures
(`webhook_endpoints` table's `consecutive_failures`), PostgREST errors in
Supabase's own logs (`get_logs(service: "postgrest")` via the MCP),
Realtime connection errors in the browser console on `/inbox`.

## 12. Rollback

- **App code**: standard redeploy of the previous commit.
- **Database**: schema-isolated by design — `crm.*` objects can be
  dropped (`DROP SCHEMA crm CASCADE;`) without touching a single `public`
  table, since nothing in Phase 1 altered `public` except adding the two
  proposal tables (step 7, a separate repo's decision to roll back or
  not) and nothing in `crm`'s migrations ever writes to `public` except
  the identity-linking functions' read-only `SELECT`s on
  `public.customers`. The one cross-cutting object: the
  `on_auth_user_created_wacrm` trigger on `auth.users` — drop it
  explicitly (`DROP TRIGGER on_auth_user_created_wacrm ON auth.users;`)
  as part of any full rollback, since it lives outside the `crm` schema
  and `DROP SCHEMA CASCADE` won't touch it.
