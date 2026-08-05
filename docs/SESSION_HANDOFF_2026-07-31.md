# Session Handoff — 2026-07-31

**Read this first in the new session, then
`docs/PHASE1_REVIEW_REPORT.md`.** This file covers *what to do next*;
that one covers *what exists and why*.

---

## Where things stand in one screen

```text
Repo             D:\Antigravity repo\laddoos-crm
GitHub           https://github.com/lllamparithi/laddoos-crm
Branch           phase1/fresh-migration-validation
Supabase (prod)  ugjishankutgfegplrgq   ← shared with the YALI brain app

Implementation        complete in working tree
Isolated verification passed — 42 migrations, 0 errors, 654/654 tests
Commit / PR           NOT committed, NOT pushed, no PR
Production            BLOCKED (8 items)
```

**Nothing has been committed.** 78 modified files, 26 untracked. The
entire Phase 1 body of work is sitting uncommitted in the working tree.
That is deliberate — no commit was authorised — but it means **the very
first thing to protect is that working tree.** Do not run `git reset`,
`git clean`, `git checkout -- .`, `git restore .`, or `git pull --rebase`.

---

## Do this first, in order

1. **Confirm the tree is intact:**
   ```bash
   git status --short          # expect 78 modified, 26 untracked
   git branch --show-current   # expect phase1/fresh-migration-validation
   ls supabase/migrations | wc -l   # expect 42
   ```
   If those numbers differ, stop and work out why before doing anything
   else.

2. **Ask what the session is for.** There are three genuinely different
   next steps and they need different setups — see below.

---

## The three plausible next steps

### A. Commit and open the PR *(most likely)*

Everything needed is done; this is a mechanical step that was simply
never authorised. Considerations:

- It's one very large commit or a handful of logical ones. Suggested
  split if the reviewer would prefer it: (1) the `001`–`036` schema move,
  (2) new migrations `037`–`042`, (3) client consolidation + generated
  types, (4) documentation.
- `.gitignore` already excludes the staged fixture copy
  (`supabase/migrations/000_public_schema_fixture.sql`) and the Supabase
  CLI's local artefacts. Check `git status` after `git add -A` anyway —
  confirm no `.env`, no keys, no `supabase/.branches` or `.temp`.
- The shareable review report for whoever reviews it:
  https://claude.ai/code/artifact/16f555ed-7004-4707-bdc7-3729fa67108d

### B. Resolve production blocker 3 — the migration ledger

This is the only remaining piece of **engineering** work before
production. `laddoos-crm` and `Yali Build 2.0` share one
`supabase_migrations.schema_migrations` ledger; the brain's rows use
14-digit timestamps, these files resolve to `001`–`042`. Four options are
written up in `docs/PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` and
**none is selected**. Needs the shared-ledger owner, not just a reviewer.

If the decision lands on renumbering: it must happen *before* the first
production apply, the whole chain must be re-tested from zero, and every
doc reference regenerated.

### C. Phase 1.1 — adopt the generated types

`docs/PHASE1_1_GENERATED_TYPES_ADOPTION.md` has the full plan. 58
mismatches, ~15 files, sequenced smallest-blast-radius first. Framed
correctly as **pre-existing schema-contract debt exposed by generated
types** — real latent runtime bugs, not cosmetic. Independent of A and B.

---

## Environment setup for the new session

Only needed for B or C, or any work touching migrations.

**Docker Desktop breaks on this machine** in a specific, recurring way —
its AI/Inference feature corrupts its own socket files and the app
crash-loops. It is currently fixed (`EnableDockerAI: false`). If it
regresses, the symptom and the *only* working fix are in memory under
`docker-desktop-ai-socket-fix`, and in this session's transcript. Do not
burn time on `rm`/`fsutil`/reboot — they all fail.

```bash
npx supabase start        # ports 55321-55323 (54322 is taken by YALI_OS_3.0)
npm run db:test:reset     # stages fixture → resets from zero → removes fixture
```

Two unrelated containers (`supabase_db_YALI_OS_3.0`, `n8n`) belong to the
user and must not be touched or pruned.

---

## Hard rules carried forward

- **Never `supabase db push` against production from this repo.** Shared
  ledger. The CLI is local-only here.
- **No production migration applied, and none may be** until blocker 3
  has an approved method *and* a fresh backup exists.
- **No paid services.** A Supabase branch at ~$0.013/hr was offered and
  declined; the local Docker stack is the approved path.
- **After changing any migration or the fixture, reset and reapply the
  whole chain from zero.** Do not patch the running test database. (This
  rule caught a real failure this session.)
- **Every new function declares its own `REVOKE`/`GRANT`.** No blanket
  `GRANT ... ON ALL FUNCTIONS`, no default `EXECUTE ON FUNCTIONS` — that
  was a real privilege-escalation bug in `041`.
- **Realtime subscriptions need `schema: "crm"` passed explicitly.** The
  client's `db.schema` option does not reach `postgres_changes` filters.

---

## Things a fresh session will get wrong without being told

1. **The 000 fixture is not a migration.** It's staged into
   `migrations/` only during a local test run and removed after. It is
   gitignored there. If you see it in `supabase/migrations/`, a run was
   interrupted — delete it.
2. **`crm` doesn't exist in production**, so `npm run gen:types:crm`
   reads the *local* stack (`--local`). `gen:types:public` reads
   production. Don't swap them.
3. **`redeem_invitation` correctly denies `anon`.** That is by design —
   it assigns the invite to `auth.uid()`, which an anonymous session
   doesn't have. Do not "fix" it by granting `anon`.
4. **The many-match identity-conflict branch is unreachable** under the
   current `public.customers` unique index, and is retained deliberately
   as a fail-closed safeguard because that constraint lives in another
   repo. Don't delete it as dead code.
5. **`public` belongs to the brain repo.** Two ready `public` tables sit
   in `supabase/public-schema-proposals/` and must never be applied from
   here.

---

## Document map

| File | Purpose |
|---|---|
| `PHASE1_REVIEW_REPORT.md` | **Cold-start entry point** — status, blockers, the five bugs, review order |
| `PHASE1_SCHEMA_OWNERSHIP.md` | Which repo owns `public` vs `crm` |
| `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md` | Blocker 3, four options, none chosen |
| `PHASE1_MIGRATION_MANIFEST.md` | Per-migration inventory |
| `PHASE1_MIGRATION_AUDIT.md` | The `public`→`crm` rewrite audit |
| `PHASE1_TEST_REPORT.md` | Full verification evidence |
| `PHASE1_DEPLOYMENT_RUNBOOK.md` | Apply steps, backup/rollback gate |
| `PHASE1_1_GENERATED_TYPES_ADOPTION.md` | Deferred follow-up |
| `phase1-test-logs/db-reset-clean-run.log` | Latest clean run |

---

## Suggested opening prompt for the new chat

> Continuing Phase 1 for the Laddoos CRM at `D:\Antigravity repo\laddoos-crm`,
> branch `phase1/fresh-migration-validation`. Read
> `docs/SESSION_HANDOFF_2026-07-31.md` first, then
> `docs/PHASE1_REVIEW_REPORT.md`. Confirm the working tree is intact
> (78 modified / 26 untracked / 42 migrations) before doing anything.
> Do not commit, push or touch production without being asked.
>
> This session I want to: **[A: commit and open the PR / B: resolve the
> migration-ledger blocker / C: start Phase 1.1 generated types]**
