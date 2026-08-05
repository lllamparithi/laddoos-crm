# Phase 2A — CTA-click event taxonomy: decision note

**Status: decided for Phase 2A. CTA tracking stays disabled.**
Documentation only — this note writes no migration and changes no code.

**Context.** `sdk.trackCtaClick()` (`src/lib/web-sdk/events.ts`) exists as
a real, callable, tested function that always resolves `false` and logs
one `console.warn`. It is deliberately a stub: `crm.timeline_event_types`
(seeded by `045_timeline_events.sql`) has no `web.cta_click` row, so
sending one would be rejected by `timeline_events`' own foreign key on
`event_type`. The handoff's standing rule is that wiring it up requires a
real decision first, not a silent enable.

---

## The three options

### Option A — seed a new `web.cta_click` event type

A small migration inserting one row into `crm.timeline_event_types`, then
a `trackCtaClick(input)` implementation posting that type.

- **For:** semantically correct. A CTA click is genuinely its own thing —
  distinct from a page view (intent, not arrival) and from a campaign
  click (which is an *inbound* attribution event, not an on-site action).
  It is the only option that leaves the timeline honest at read time.
- **Against — and this is the blocking one:** the next migration number
  is `048` (`047` became the security hotfix on 2026-08-04; this
  paragraph originally said `047`), and **`048`+ is explicitly reserved
  for Phase 2B**
  (`identity_merge_log`, the `contacts.phone` nullable alteration, the
  `web_to_wa` token purpose) by `PHASE2_CANONICAL_PLAN.md` §2 and
  restated as a hard rule in `CLAUDE.md`. Taking `048` for a CTA seed
  collides with a reservation made precisely so 2A's numbering could not
  drift into 2B's. Phase 2B's migration set is not designed yet, so
  there is no agreed place to slot this without reopening that decision.
- Also against, more mildly: nothing consumes CTA data today. No
  timeline UI renders it, no follow-up policy reads it (the Follow-up
  engine is Phase 2D+, `PHASE2_FOLLOWUP_POLICY_ENGINE.md`, designed but
  not built). The rows would accumulate unread.

### Option B — reuse an existing seeded event type

Send `campaign.click`, or `web.page_view` with a CTA-flavoured summary.

- **For:** zero migrations. Works today.
- **Against:** this is the genuinely bad option, and it is bad in a way
  that does not undo. `campaign.click` means "someone clicked through
  from an ad or a tracked link into the site" — an inbound attribution
  signal. An on-site CTA click is the opposite direction. Conflating
  them corrupts every future query that tries to separate *how a visitor
  arrived* from *what they did once here*, which is the core question
  the unified timeline exists to answer
  (`PHASE2_UNIFIED_TIMELINE_SPEC.md`). Overloading `web.page_view` is
  the same problem in milder form, and unlike a schema mistake, written
  rows cannot be un-mixed later without a backfill that has no reliable
  discriminator to backfill *on*.

  Note this is a different judgement from `trackProductView()` mapping to
  `web.page_view`, which is fine: a product page view really *is* a page
  view, so the type stays true and only the summary specialises. A CTA
  click is not a page view.

### Option C — keep CTA tracking disabled for Phase 2A ✅

Leave the stub exactly as it is. Revisit when Phase 2B's migration range
is actually designed.

- **For:** costs nothing, forecloses nothing, and keeps `047`'s
  reservation intact. The stub already makes the gap visible in code
  rather than hiding it, and `trackCtaClick()`'s call site is the right
  one to wire up later — its signature does not need to change when
  Option A is eventually taken.
- **Against:** any CTA clicks happening on the real website between now
  and then are simply not recorded. That is a real data loss, and it is
  accepted knowingly: no website is wired to this SDK yet, so today the
  loss is zero, and it stays zero until someone integrates it.

---

## Recommendation

**Option C — stay disabled.** Then **Option A when Phase 2B's migration
set is designed**, folding the `web.cta_click` seed into that range
rather than spending the reserved `047` on it now.

The deciding factor is not effort — Option A is a one-row insert. It is
that Option A's only real cost is a numbering collision with a
reservation that exists specifically to prevent this class of drift, and
that collision disappears entirely once 2B is designed. Waiting costs
nothing that is not already zero. Option B is rejected outright: it is
the only choice here that writes rows which cannot be corrected later.

**Explicit revisit trigger:** whichever comes first —

- Phase 2B's migration numbers are assigned (fold the seed in there), or
- a real website integration is about to ship *and* someone names a
  concrete consumer for CTA data. "We might want it later" is not a
  consumer; a follow-up rule or a timeline view that reads it is.

**Until then:** `trackCtaClick()` must keep returning `false`. Do not
enable it by pointing it at an existing type — that is Option B, and it
is rejected above.
