@AGENTS.md

# Laddoos Founder CRM + Dashboard

Fork of [wacrm](https://github.com/ArnasDon/wacrm) (Next.js 16 + Supabase
WhatsApp CRM), being extended into a founder operations dashboard.
Companion repo: `../laddoos-website` (public site + Yali brain + voice
agent — separate deployment, separate domain).

## 📍 Current status — Phase 2A proven locally, Phase 1 still uncommitted

**Phase 1 (Core Data Foundation) is implemented and verified. Phase 2A
(Instagram → Website → Timeline: schema, backend, web SDK) is also
implemented and verified, including a real browser-driven proof against
a live local Postgres. Nothing from either phase is committed, pushed,
or deployed. No production migration has been applied.**

```text
Phase 1 implementation:    complete, uncommitted
Phase 2A implementation:   complete, uncommitted — migrations 043-046,
                            repo/service/API layers, web SDK, real
                            browser proof (2 rows confirmed in
                            crm.timeline_events, 0 in crm.messages)
Full test suite:           839/839, typecheck clean, build clean
Migration chain:           001-046 re-verified from zero 2026-08-01,
                            0 errors — docs/phase1-test-logs/
                            db-reset-clean-run-001-046.log
A1 (ledger method):        RESOLVED 2026-08-01 — MCP apply_migration
                            only; supabase db push forbidden
Backup/restore gate:       SATISFIED 2026-08-04 (pg_dump + verified
                            restore into a pgvector scratch target)
PRODUCTION MIGRATIONS:     ✅ APPLIED 2026-08-04 — all 47 (001-047),
                            zero errors, ledger clean, public untouched
                            (29 tables, brain data 21/62/0 unchanged)
PostgREST:                 ✅ `crm` EXPOSED 2026-08-04. Anon table reads
                            all blocked (42501). Audited live.
047 (security hotfix):     REVOKE claim_ai_reply_slot FROM PUBLIC — it
                            was anon-callable once crm went live. Found
                            by the post-exposure audit, fixed same day.
Next steps (NOT done):     1. deploy the CRM app + DNS for
                              admin.laddoosdotcom.in (does NOT resolve)
                           2. first admin signup -> seed
                              workspace_brand_map (runbook §6)
                           3. verify `authenticated` RLS with a real JWT
                              — NEVER tested, auth.users is empty
                            B1 and a brain-repo fix still gate Phase 2B/2C
```

**Nothing is committed in either repo.** 80 modified / 64 untracked here;
the website's SDK integration is likewise uncommitted. Commit + PR review
remain open production blockers.

Branch: `phase1/fresh-migration-validation`.

**New session? Read `docs/SESSION_HANDOFF_2026-08-04.md` first** — it
covers the production migration apply and supersedes every earlier
handoff as the starting point. Doc index:

| Doc | What it's for |
|---|---|
| `SESSION_HANDOFF_2026-08-04.md` | **START HERE.** Production apply, PostgREST exposure, the 047 hotfix, exact next steps |
| `SESSION_HANDOFF_2026-08-01.md` | Phase 2A build detail (historical — superseded as the entry point) |
| `PHASE2_CANONICAL_PLAN.md` | Authoritative migration order (`043`-`046`) and the partitioning decision |
| `PHASE2_READINESS_CHECKLIST.md` | Consolidated go/no-go across every open Phase 2 decision |
| `PHASE2_WEB_SDK_INTEGRATION.md` | Web SDK API docs + how to run the local browser proof |
| `SESSION_HANDOFF_2026-07-31.md` | Phase 1 only — next steps, environment setup, carried-forward rules |
| `PHASE1_REVIEW_REPORT.md` | Phase 1 change inventory, the 5 bugs found, review order |
| `PHASE1_SCHEMA_OWNERSHIP.md` | Which repo owns `public` vs `crm`. Read before any schema work |
| `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` | Why `supabase db push` is forbidden here |
| `PHASE1_MIGRATION_MANIFEST.md` | Per-migration inventory (objects, deps, DEFINER, Realtime) |
| `PHASE1_MIGRATION_AUDIT.md` | The `public`→`crm` rewrite audit |
| `PHASE1_TEST_REPORT.md` | Full Phase 1 verification evidence, honestly scoped |
| `PHASE1_DEPLOYMENT_RUNBOOK.md` | Production apply steps (`001`–`047`, all applied) + rollback |
| `PHASE1_BACKUP_RESTORE_GATE.md` | **The fillable backup + tested-restore gate — the current blocker** |
| `PHASE1_1_GENERATED_TYPES_ADOPTION.md` | Deferred follow-up (58 pre-existing type mismatches) |

## Locked decisions

- **Single Next.js app.** No separate WeWeb frontend — `/hub` (live
  activity) and `/morning` (KPI digest) are pages in *this* app.
- **No multi-tenant scaffolding.** No `tenant_id`, no `tenants` table.
  Laddoos is the only account, matching wacrm's account-scoped model.
- **This app owns the `crm` schema only.** `public` belongs to the Yali
  brain repo (`D:\SAAS Project\Yali 2.0\Yali Build 2.0`). Never write to
  `public` from here.
- **Comez commerce webhooks** land in a Supabase Edge Function, not a
  Next.js route in either app.
- **Yali's brain plugs in via `webhook_endpoints`** on inbound messages;
  leave wacrm's own `ai_reply.autoReplyEnabled` off rather than deleting
  its AI layer.
- Target domain: `admin.laddoosdotcom.in`.

## Hard rules

### Database

- **Never run `supabase db push` against production from this repo.** The
  Supabase project is shared with the brain app and they'd fight over one
  migration ledger. Production applies go through the Supabase MCP
  `apply_migration` tool only. See
  `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`.
- **Never apply migrations to production without the runbook's backup
  gate filled in.** An unfilled field is a blocked deploy.
- Migrations are `supabase/migrations/001`–`047`, applied strictly in
  order (`043`-`046` are Phase 2A — `identity_handles`, `identity_evidence`,
  `timeline_events`, `continuation_tokens`; see `docs/PHASE2_CANONICAL_PLAN.md`).
  **All 47 are applied to production as of 2026-08-04.** `047` is the
  security hotfix (`REVOKE claim_ai_reply_slot FROM PUBLIC`), applied to
  production after `crm` was exposed in PostgREST and a read-only audit
  found the function anon-callable. The local file
  `supabase/migrations/047_revoke_claim_ai_reply_slot_public.sql` was
  written to **match** that already-applied change so a from-zero local
  run reproduces production instead of rebuilding the vulnerable state —
  do not re-apply it to production. It took the slot
  `PHASE2_CANONICAL_PLAN.md` §2 had reserved for Phase 2B, so **Phase 2B
  starts at `048`+** unless a new canonical plan says otherwise. §2 was
  corrected 2026-08-05; no doc should still claim `047` is reserved.
- **Every `CREATE TABLE` in these migrations is UNQUALIFIED** and relies
  on the `SET search_path = crm, public, extensions` at the top of each
  file. Do not remove those lines. If the search_path were ever lost,
  `CREATE TABLE IF NOT EXISTS messages` would silently bind to the
  brain's pre-existing `public.messages` — a no-op with no error, and
  every later ALTER/FK would attach to the wrong table. Verified safe
  under MCP `apply_migration` with a zero-write probe before the 2026-08-04
  apply; re-verify if the apply mechanism ever changes.
- `identity_handles` is the canonical table name — never `contact_handles`.
- `crm.messages` never gains a `channel` column — decided, not open.
  Cross-channel event history lives in `crm.timeline_events` instead.
- `timeline_events`'s primary key is composite `(id, occurred_at)`
  (future-partitioning readiness — see `045_timeline_events.sql`'s own
  header comment). A future table needing a hard FK to a specific event
  must reference both columns; a soft reference (display/audit only)
  should store the id with no FK at all.
- **Every new function declares its own `REVOKE`/`GRANT`.** Do not add a
  blanket `GRANT ... ON ALL FUNCTIONS` or a default `EXECUTE ON
  FUNCTIONS` privilege — that silently overrides every deliberate
  per-function lockout earlier in the chain (this was a real
  privilege-escalation bug in `041`, see the test report).
- New commerce/`public` tables go in `supabase/public-schema-proposals/`
  as proposals for the brain repo — never into `supabase/migrations/`.

### Local testing

```bash
npx supabase start        # ports 55321-55323, avoids a pre-existing local project
npm run db:test:reset     # stages the fixture, resets from zero, removes the fixture
```

- **`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` is still the unconfigured
  placeholder** — running `npm run dev` as-is fails every server-side
  Supabase call with `TypeError: fetch failed`. Do not edit `.env.local`
  to fix this; export the local stack's URL/keys as process-only shell
  env vars before `npm run dev` instead (the Supabase CLI's fixed public
  demo JWTs, not a real secret) — see
  `docs/SESSION_HANDOFF_2026-08-01.md`'s "Environment gotcha" for the
  exact values.
- Any Phase 2A endpoint needs one real `crm.accounts` row and one active
  `workspace_brand_map` row to exist first — neither is seeded by
  default. See `docs/PHASE2_WEB_SDK_INTEGRATION.md`'s local-proof section.

- `supabase/test-fixtures/000_public_schema_fixture.sql` stubs the brain's
  `public` tables so a from-zero run is realistic. It is **staged into
  `migrations/` only during a test run** and is gitignored there. Never
  commit it as a numbered migration.
- **After changing any migration, reset and reapply the whole chain from
  zero.** Do not patch the running test database.
- Regenerate types after a schema change: `npm run gen:types:crm`
  (reads the *local* stack — `crm` doesn't exist in production yet).

### Code

- `npm run typecheck`, `npm run build`, `npm run test` clean before
  anything is considered done. Baseline: 0 errors, 654/654 tests.
- One shared service-role client: `src/lib/supabase/admin.ts`
  (`supabaseAdmin()` = `crm`, `supabasePublicAdmin()` = `public`). Do not
  create ad-hoc `createClient(...)` singletons — six had accumulated
  before Phase 1 consolidated them.
- **Realtime subscriptions need `schema: "crm"` passed explicitly.** The
  client's `db: { schema: 'crm' }` option does *not* apply to
  `postgres_changes` filters. Getting this wrong produces zero events
  with no error anywhere — it happened to all 9 subscriptions.
- A subscription that filters on a non-PK column needs
  `REPLICA IDENTITY FULL` on that table (migration `042`), or its DELETE
  events are dropped silently.
- Never suppress a schema mismatch with `any` / `as unknown as` /
  `@ts-expect-error`. See `PHASE1_1_GENERATED_TYPES_ADOPTION.md`.

### Process

- Do not commit, push, open a PR, or deploy without being asked.
- Extend this fork; don't rewrite it. It already has a working inbox,
  contacts, pipelines, broadcasts, automations, AI-reply + knowledge
  base, a scoped public API (`/api/v1`) and outbound webhooks.

## Lessons worth not relearning

Five real bugs were found in Phase 1, **none** catchable by typecheck,
the 654-test suite, or reading the SQL:

1. A migration that only fails on a genuinely blank database (test
   realism gap, not a code defect).
2. A missing `GRANT USAGE ON SCHEMA crm` — every API request, including
   service-role, returned `42501`.
3. All 9 Realtime subscriptions hardcoding the wrong schema.
4. A blanket function grant re-opening deliberately locked-down
   functions.
5. A bug inside a test's own assertion logic, found only by writing a
   negative control for it.

The pattern: **static review and green tests do not prove runtime
behaviour.** Execute things. And when a negative test passes, check that
the thing it was supposed to detect actually happened — two false passes
in this project came from a conflict/no-op meaning nothing was ever
attempted.
