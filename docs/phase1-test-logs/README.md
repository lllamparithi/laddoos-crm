# Phase 1 / 2A test logs

Captured output from `npm run db:test:reset` (stage the `public`-schema
fixture → `npx supabase db reset` from zero → remove the fixture). Both files
are **raw captured output and must not be edited** — that is the whole point
of keeping them. This README carries the commentary instead.

| File | Run | Migrations applied | Status |
|---|---|---|---|
| `db-reset-clean-run-001-046.log` | 2026-08-01 | **47** — `000` fixture + `001`–`046` | ✅ **Current.** The authoritative from-zero evidence |
| `db-reset-clean-run.log` | earlier | **43** — `000` fixture + `001`–`042` | 📁 **Historical — superseded** |

## Which one to cite

Cite **`db-reset-clean-run-001-046.log`**. It covers everything the older run
covered, plus Phase 2A's `043`–`046`.

`db-reset-clean-run.log` stops at `042` and predates Phase 2A. It is retained
deliberately, not by accident:

- It is the evidence behind the Phase 1-only claims in
  `PHASE1_TEST_REPORT.md` and `PHASE1_REVIEW_REPORT.md`, which were written
  against that run and cite it by name.
- Deleting it would break nine live cross-references across five documents.

Treat it as an archived record of the Phase 1 state, not as a current result.
If a doc cites it for a claim about the *current* migration chain, that doc is
wrong — the chain is `001`–`047` now.

## What neither log covers

**`047_revoke_claim_ai_reply_slot_public.sql` postdates both runs.** It was
authored on 2026-08-04, after `crm` was exposed in PostgREST and the
post-exposure audit found the hole. Neither log shows it being applied.

A future from-zero run should produce **48** applied migrations
(`000` fixture + `001`–`047`). If you re-run `db:test:reset`, save the output
as a new file and add a row above rather than overwriting either of these.
