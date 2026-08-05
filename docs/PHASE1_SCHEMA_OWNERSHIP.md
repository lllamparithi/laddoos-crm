# Phase 1 — Schema Ownership

Verified live this session against Supabase project `ugjishankutgfegplrgq`
("Yali agentic chat Project") and both repos' migration directories — not
assumed.

## The situation before this doc

There was no formal ownership split because there was no collision yet:
wacrm's 36 migrations (`laddoos-crm/supabase/migrations/001`–`036`) have
**never been applied** to this project (confirmed: none of wacrm's table
names — `contacts`, `conversations`, `accounts`, `profiles`, `pipelines`,
etc. — exist in `public` today). The Yali brain repo's own migrations
already own everything that exists in `public`.

## Canonical ownership (locked)

```text
public   →  owned by D:\SAAS Project\Yali 2.0\Yali Build 2.0
             supabase/migrations/  (21 files, 20260604120000_core_schema.sql
             through 20260726100000_017_realtime_turns.sql)

crm      →  owned by D:\Antigravity repo\laddoos-crm  (this repo)
             supabase/migrations/  (001_initial_schema.sql through
             036_conversation_contact_dedup.sql, plus 037+ new)

Cross-schema integration layer (crm.contacts ↔ public.customers linking,
crm.workspace_brand_map, crm.identity_link_conflicts)
         →  owned by laddoos-crm (it's additive to crm, reads public.customers
             read-only via a SECURITY DEFINER function — never writes to
             public.* tables)
```

This isn't a new system — it's naming what's already true (Yali Build 2.0
has been the sole writer to `public` since 2026-06-04) and extending it
with the one new schema.

## How migration ordering is controlled

**There is no CI or automated migration runner in either repo today** —
confirmed by reading both repos' `.github/workflows/`, `package.json`
scripts, and `supabase/` directories. Both repos apply migrations by hand:

- Yali Build 2.0: no `supabase/config.toml`, no CLI script. Migrations are
  applied via the **Supabase MCP `apply_migration` tool**, tracked
  informally in that repo's `CLAUDE.md` session-handoff notes (e.g. "011
  is ALTER TABLE not CREATE — customers already exists", "Migrations
  APPLIED to JEM Supabase via MCP: 008, 010, 011"). That repo's own
  CLAUDE.md already documents real schema-drift incidents from this
  (tables created live before their migration file existed) and now
  instructs every session to `list_tables` via MCP before touching schema
  — **treat the live DB, not the migration files, as the source of truth
  for `public`** when planning `crm` work that touches it.
- laddoos-crm (wacrm fork): also no CI, no local Postgres stack. Migrations
  are meant to be applied via the Supabase CLI in wacrm's own upstream
  docs, but nothing in this fork has run them yet against any project.

**For `crm`, going forward:**

- **`supabase db push` against production is forbidden from this repo**,
  unconditionally. The CLI is a local-development tool here
  (`supabase start`, `npm run db:test:reset`) and nothing more.
- **No production application method is approved yet.** A local pass does
  not authorise an apply. See
  `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` — this is production
  blocker 3, and the strategy must be agreed with the owner of the
  shared ledger before the first apply.
- Whatever method is approved, migrations apply in the numbered order the
  files imply, and `crm` migration SQL is never hand-run from the
  Yali Build 2.0 repo (or vice versa).

## Keeping local / staging / production consistent

Given neither repo has CI or a local Postgres stack, "consistency" here
means process discipline, not automation, until one of these repos adds
CI:

1. **Before any `crm` migration work in a new session**: `list_tables` on
   `ugjishankutgfegplrgq` (both schemas) via the Supabase MCP first — same
   rule the brain repo already enforces on itself, extended to `crm`.
2. **Every `crm` migration is written as a file in this repo first**, then
   applied — never apply ad-hoc SQL via the dashboard/MCP without a
   corresponding committed file (this phase's rule 4: "Every migration
   must exist as a committed SQL file").
3. **A Supabase branch is the closest thing to a staging environment**
   this project has (see `PHASE1_TEST_REPORT.md` for whether one was used
   this phase) — there's no separate long-lived staging project.
4. **`public` changes needed by `crm` work** (e.g. the customers-uniqueness
   question raised in the original research) are proposed as migration
   files in the Yali Build 2.0 repo, not applied unilaterally from here —
   this repo does not have write authority over `public`'s migration
   history.

## What this resolves from the original plan

The earlier `PHASE1_DATA_FOUNDATION_PLAN.md` (previous session) treated
`abandoned_carts`/`products` as new tables to add without being explicit
about *which* repo's migration history they'd live in. Answer, now locked:
**`public` schema commerce tables (`abandoned_carts`, `comez_products_raw`)
are proposed here but belong in the Yali Build 2.0 repo's migration
history**, since that repo owns `public`. This phase writes them as
ready-to-apply SQL (deliverable, not just documentation — see rule 4), but
applying them against the live project is a Yali Build 2.0-repo action,
flagged in the deployment runbook, not bundled silently into a `crm`-repo
deploy.
