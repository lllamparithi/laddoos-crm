# Phase 1.1 — Generated-Types Adoption

**Status:** open follow-up, not part of Phase 1
**Blocks:** nothing in Phase 1. Phase 1 ships with the types generated
and committed but not wired into the client constructors.
**Framing:** this is **pre-existing schema-contract debt exposed by
generated types** — not cosmetic frontend hygiene, and not damage caused
by the `crm` schema move.

## What exists today

Two real, tool-generated type files are **present in the working tree and
ready to be included in the Phase 1 commit** (nothing in Phase 1 is
committed yet):

| File | Generated from | Command |
|---|---|---|
| `src/lib/supabase/types/public.generated.ts` | live `ugjishankutgfegplrgq` | Supabase MCP `generate_typescript_types` |
| `src/lib/supabase/types/crm.generated.ts` | local stack with migrations `000`–`042` applied from zero | `npm run gen:types:crm` |

`src/lib/supabase/database.types.ts` merges both. `supabasePublicAdmin()`
in `src/lib/supabase/admin.ts` already uses the real `public` types.

**Not adopted:** the three `crm`-scoped client constructors
(`src/lib/supabase/client.ts`, `server.ts`, `admin.ts`'s `supabaseAdmin()`)
still type as `AnySupabaseClient`. Adopting `Database`/`'crm'` there is
what this document is about.

## Why adoption currently fails

Wiring the real types into those constructors produces **58 TypeScript
errors**. None are in migration or schema code; all are call sites where
a hand-written interface disagrees with the database's actual contract.

This codebase never had generated types before Phase 1 (confirmed in
`PHASE1_MIGRATION_AUDIT.md`), so these interfaces were written by hand
and have drifted from the schema without anything to catch it. Phase 1 is
simply the first thing to hold them against ground truth.

### Mismatch classes

**1. Nullability drift (the largest class).** Hand-written interfaces
declare non-null where the column is nullable:

```ts
// hand-written                      // actual column
created_at: string                   created_at: string | null
phone_normalized: string | undefined phone_normalized: string | null
```

`null` vs `undefined` is a second, separate axis of the same problem —
several interfaces use `| undefined` for columns that are `| null`.

**2. `Json` vs. structured types.** Columns typed `jsonb` generate as
`Json`; the hand-written interfaces claim a specific shape:

```ts
steps_executed: AutomationLogStepResult[]   // actual: Json
template_variables: Record<string, unknown> // actual: Json
audience_filter: Record<string, unknown>    // actual: Json
```

These are *probably* correct at runtime but unproven — nothing validates
the jsonb payload shape on read.

**3. String vs. union types.** `CHECK`-constrained columns generate as
`string`, while interfaces declare a narrowed union:

```ts
status: RecipientStatus  // 'pending'|'sent'|... ; actual: string
```

**4. Embedded-relation shapes.** `.select('*, contact:contacts(*)')`
results type differently than the hand-written `RawConversation` /
`BroadcastRecipient` composites expect.

### Affected domains

| Domain | Representative files |
|---|---|
| Broadcasts | `app/(dashboard)/broadcasts/page.tsx`, `broadcasts/[id]/page.tsx`, `hooks/use-broadcast-sending.ts` |
| Contacts | `app/(dashboard)/contacts/page.tsx`, `components/inbox/contact-sidebar.tsx` |
| Inbox | `app/(dashboard)/inbox/page.tsx`, `components/inbox/conversation-list.tsx`, `message-thread.tsx` |
| Pipelines | `app/(dashboard)/pipelines/page.tsx`, `components/pipelines/*` |
| Automations | `app/(dashboard)/automations/[id]/logs/page.tsx` |
| Settings | `components/settings/tag-manager.tsx`, `template-manager.tsx`, `whatsapp-config.tsx` |

Roughly 15 files, concentrated in dashboard pages and their hooks.

## Why this is real debt, not noise

Every one of these is a place where the code asserts something about the
database that the database does not guarantee. Concretely:

- A `created_at: string` that is actually nullable will throw at runtime
  the first time a row has `created_at IS NULL`
  (`row.created_at.slice(...)` on `null`).
- A `Json` claimed as `AutomationLogStepResult[]` will silently render
  wrong — or crash on `.map()` — if a log row ever holds a different
  shape.
- A `status: RecipientStatus` narrowing means exhaustive `switch`
  statements believe they've covered every case when the DB can produce
  any string.

None of these are hypothetical type-system pedantry; each is a
runtime-crash or silent-corruption path that is currently invisible.

## Recommended approach

**Do not** blanket-suppress with `any`, `as unknown as`, or
`@ts-expect-error`. That converts a visible contract violation into an
invisible one and forfeits the entire benefit of generating the types.

Work domain by domain, smallest blast radius first:

1. **Delete the hand-written interface** and re-export the generated row
   type: `type Contact = Database['crm']['Tables']['contacts']['Row']`.
2. **Fix the call sites the compiler then flags** — usually adding a
   null guard or a `?? fallback`. Each one is a real latent bug; treat
   the fix as a behaviour change, not a type annotation.
3. **For narrowed unions** (class 3): either add a runtime parse at the
   boundary (a small `asRecipientStatus()` validator), or accept `string`
   and handle the default case. Do not cast.
4. **For `Json` columns** (class 2): add a narrow parse/validate helper
   at the read boundary. This is the only class where a `zod`-style
   validator is worth the dependency — evaluate whether it's justified
   for 3–4 columns before adding one.

## Suggested sequencing

| Step | Scope | Rough size |
|---|---|---|
| 1 | Settings (tags, templates, whatsapp-config) — smallest, most isolated | ~6 errors |
| 2 | Pipelines | ~5 errors |
| 3 | Contacts | ~4 errors |
| 4 | Automations logs (`Json` class) | ~2 errors, needs a decision on validation |
| 5 | Broadcasts (largest, includes embedded relations) | ~20 errors |
| 6 | Inbox (embedded relations + realtime payload typing) | ~20 errors |
| 7 | Flip `client.ts` / `server.ts` / `admin.ts` to `Database`/`'crm'`, delete `any-client.ts` | the payoff |

Steps 1–6 can each land independently while the constructors still use
`AnySupabaseClient`; only step 7 requires all prior steps to be complete.

## Definition of done

- [ ] `src/lib/supabase/client.ts`, `server.ts`, and `admin.ts`'s
      `supabaseAdmin()` are typed `SupabaseClient<Database, 'crm'>`
- [ ] `src/lib/supabase/any-client.ts` is deleted and has no remaining
      importers
- [ ] The `as unknown as` cast in
      `src/app/api/whatsapp/webhook/route.ts` (added in Phase 1 solely
      because `crm` was untyped) is removed
- [ ] `npm run typecheck` passes with zero errors and zero new
      suppressions (`any`, `@ts-expect-error`, `as unknown as`)
- [ ] `npm run build` and `npm run test` pass
- [ ] Every nullability fix is a real guard, not a non-null assertion
      (`!`) — a `!` here just re-hides the bug
- [ ] `npm run gen:types:crm` is documented/wired so types are
      regenerated when a migration changes the schema

## Related

- `docs/PHASE1_TEST_REPORT.md` — where the 58 errors were first measured
- `docs/PHASE1_REVIEW_REPORT.md` §4.1 — the deferral decision and its
  rationale
