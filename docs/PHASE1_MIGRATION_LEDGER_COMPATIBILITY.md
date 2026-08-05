# Phase 1 — Shared Migration Ledger Compatibility

> ## ✅ A1 RESOLVED — Option A approved (2026-08-01)
>
> **The application method is decided.** Production applies from this
> repo go through the Supabase MCP `apply_migration` tool **only**;
> `supabase db push` against production is **forbidden**. This is
> Proposed Option A below, now accepted. Options B, C and D are closed —
> do not reopen them without a new decision, and note that option B
> (renumbering) had to happen *before* the first apply, so choosing it
> later is no longer free.
>
> **What this approval does NOT do.** It clears production blocker 3 and
> nothing else. It is not permission to apply. The backup / restore gate
> (`PHASE1_DEPLOYMENT_RUNBOOK.md` §1) is still unfilled, and
> **PRODUCTION APPLY REMAINS NOT APPROVED**. An approved *method* is not
> an approved *deploy*.
>
> The rest of this document is the original hazard analysis that led to
> the decision. It is retained unchanged as the reasoning of record —
> where it says "proposed, not approved" below, read it as the state
> before this banner.

Not a literal version-string collision today, but a structural one that
will break the moment anyone uses the Supabase CLI's push path from this
repo.

## Why two repos cannot run independent numeric histories on one ledger

`supabase_migrations.schema_migrations` is **per-database, not
per-schema**. There is no mechanism partitioning it by owning repository.
Both `laddoos-crm` and the YALI brain repo target the same project, so
both would write rows into the same table, each unaware of the other's.
Consequences, in order of how soon they bite:

- Each repo's CLI sees the *other's* rows as unknown remote migrations
  and treats its own local set as the truth.
- `supabase migration repair`, the tool someone reaches for to unblock
  that, rewrites ledger rows — including rows belonging to the other
  repository.
- Version ordering becomes meaningless: numeric `001`–`042` sorts before
  every 14-digit timestamp, so the ledger would claim the CRM schema
  predates the brain's 2026-06 migrations.
- The ledger stops being a usable record of what was actually applied —
  which it already partly is (see "already incomplete" below).

## Evidence (production, read-only)

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

Against `ugjishankutgfegplrgq`:

| version | name |
|---|---|
| `20260610172117` | `010_product_demand_signals` |
| `20260610172251` | `011_customers_extend_for_brain` |
| `20260612073910` | `012_commerce_connections` |
| `20260726065033` | `017_realtime_turns` |

Four rows. Three facts follow:

1. **The shared ledger uses 14-digit timestamp versions.** This repo's
   migrations are `001_…` – `042_…`, so the CLI would derive versions
   `001`…`042`.
2. **The ledger is already incomplete.** The brain repo has ~21 migration
   files but only 4 ledger rows — consistent with that repo's own
   documented schema drift (its `CLAUDE.md` records tables applied via
   MCP/dashboard before their migration files existed, and now instructs
   sessions to `list_tables` rather than trust the files). **The ledger
   is not a reliable record of what has actually been applied to this
   project.**
3. **Two repositories, one ledger table.** `supabase_migrations.schema_migrations`
   is per-database, not per-schema. There is no mechanism that partitions
   it by owning repo.

## Is there a literal collision?

No. `'001'` ≠ `'20260610172117'`, and no CRM version string matches an
existing row. A CRM apply would insert new rows without violating the
ledger's primary key.

## So why is this still Outcome B?

Three concrete hazards, in descending likelihood:

**1. `supabase db push` from this repo would misbehave.** The CLI
compares local migration versions against remote ledger rows. It would
find four remote versions with no local counterpart and, depending on CLI
version, either refuse to proceed or demand `supabase migration repair`.
Worse, a `repair` run by someone trying to unblock themselves could
rewrite ledger rows that belong to the brain repo.

**2. Ordering is permanently wrong.** Versions sort lexicographically.
`001` … `042` all sort *before* `20260610172117`, so the ledger would
claim the entire CRM schema was created before the brain's 2026-06
migrations — the reverse of reality. Harmless to the database, actively
misleading to any human or tool reading apply order.

**3. Future direct collision is possible.** If the brain repo ever adds a
file with a short numeric prefix (its own naming has *both* a timestamp
and a sequence number: `20260726100000_017_realtime_turns.sql`), a
collision becomes possible. Low probability, unbounded blast radius.

## Recommendation — proposed, NOT approved

**Nothing below is a decision.** All four options remain open; one must
be selected and reviewed before any production apply (blocker 3). This
section records which one this analysis would argue for and why, so a
reviewer has something concrete to accept or reject.

**Proposed option A — coordinated ledger strategy (lowest cost):**

- Apply CRM migrations **only** via the Supabase MCP `apply_migration`
  tool, never `supabase db push`. MCP assigns its own timestamp version
  at apply time and stores the file's name — which is exactly how the
  four existing rows were created, so CRM rows would be consistent with
  brain rows in both format and ordering.
- Treat `supabase db push` against production as **forbidden from this
  repo**. The CLI remains the local-development tool only
  (`supabase start` / `db reset` against the local stack).
- This is recorded as a hard rule in `PHASE1_SCHEMA_OWNERSHIP.md` and as
  a gate item in `PHASE1_DEPLOYMENT_RUNBOOK.md`.

**Proposed options B–D, all still open:**

- **B — renumber** all still-unapplied CRM migrations with globally
  unique timestamps (see the trade-off immediately below).
- **C — move the CRM migrations into the canonical YALI/shared migration
  repository**, so one repo owns the ledger outright. Cleanest
  conceptually; costs this repo its self-contained migration history.
- **D — a reviewed production migration bundle** applied by the canonical
  migration owner, with this repo's files treated as source material
  rather than as an independently-applied chain.

**Why option A over B (renumbering)?** B is the more robust fix and it is
still available (nothing is applied to production yet, so renaming is
free from the database's perspective). A was proposed instead because:

- This is a **fork of wacrm**, and `001`–`036` are upstream filenames.
  Renaming them permanently diverges the fork and makes every future
  upstream sync a manual conflict resolution across 36 files. That is a
  recurring cost paid forever, against a hazard that the MCP-only rule
  eliminates today.
- The rename would have to be retested from zero, and the benefit only
  materialises if someone uses the CLI push path — which the primary
  recommendation forbids anyway.

**This is a proposal, and a legitimate one to overrule.** If the team
would rather have CLI push work (e.g. to add CI that pushes migrations),
option B is the right call — and it must be done *before* the first
production apply, not after. The mapping would be
`001_initial_schema.sql` → `20260731000100_initial_schema.sql`,
incrementing by 100 seconds per file to leave insertion room. If B is
chosen, the whole chain must be re-tested from zero and every doc
reference regenerated.

## Who approves

The **canonical `public`-schema / shared-database migration owner** —
i.e. whoever owns `D:\SAAS Project\Yali 2.0\Yali Build 2.0`'s migration
history — together with the reviewer of this PR. This repo cannot
unilaterally choose a strategy that writes into a ledger it shares.

## Until then

> **Superseded by the approval banner at the top of this file.** The
> method question is now settled: MCP `apply_migration` only, `db push`
> forbidden. What follows was written while all four options were open.

**Still true even after approval:** no production apply may happen until
the *remaining* gates clear — the backup/restore evidence and an approved
window (`PHASE1_DEPLOYMENT_RUNBOOK.md` §1). An approved method is not a
self-authorising deploy.

## What was NOT done

Production migration history was **not modified**. The `SELECT` quoted
above is the only interaction with `supabase_migrations` — a read.
