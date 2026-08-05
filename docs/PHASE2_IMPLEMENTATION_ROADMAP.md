# Phase 2 — Implementation Roadmap

> **PARTIALLY SUPERSEDED.** §2.1's migration table below (six tables,
> `043`–`048`, bundling the WhatsApp merge into Phase 2A) is superseded
> by `PHASE2_SCOPE_REDUCTION.md` (which splits WhatsApp into Phase 2B)
> and `PHASE2_CANONICAL_PLAN.md` (which gives the corrected, FK-safe
> migration order for the reduced Phase 2A). The rest of this document —
> the 2B–2I increment discussion, risks, and consolidated decisions in
> §5 — is **not** superseded and remains useful context, though
> `PHASE2_ARCHITECTURE_DECISIONS.md` is now the more complete register.

**Status:** PROPOSAL. Nothing implemented, nothing applied, no migration written.
**Reads with:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` ·
`PHASE2_UNIFIED_TIMELINE_SPEC.md` · `PHASE2_FOLLOWUP_POLICY_ENGINE.md` ·
`PHASE2_FOUNDER_INTELLIGENCE_SPEC.md`

---

## 1. Hard prerequisites

Nothing in this roadmap can be **applied** until these clear. Local work
against `npm run db:test:reset` may begin immediately.

| # | Blocker | Owner | Status |
|---|---|---|---|
| 1 | Phase 1 committed and PR-reviewed | founder / reviewer | outstanding |
| 2 | **Shared migration ledger method approved** (Phase 1 blocker 3) | shared-ledger owner | **outstanding — gates every migration below** |
| 3 | `crm` added to hosted PostgREST exposed schemas | founder | outstanding |
| 4 | Production backup + verified restore | founder | outstanding |

Carried forward unchanged: never `supabase db push` from this repo; every
new function declares its own `REVOKE`/`GRANT`; after changing any
migration, reset and reapply the whole chain from zero; `public` belongs
to the brain repo — propose, never apply.

### External dependency with real lead time

**Instagram inbound messaging requires Meta app review** for
`instagram_manage_messages`, an Instagram Professional account linked to
a Facebook Page, and webhook subscription. This has historically taken
**days to weeks** and is outside our control.

> **Start the Meta app review now, in parallel with 2A.1.** It is the
> single longest-lead item in Phase 2 and it gates the demonstration
> even if all our code is finished.

---

## 2. Recommended Phase 2A — the smallest safe slice

**Goal:** prove the chain end to end, once.

```
Instagram tracked link → website session → website chat
                       → WhatsApp identity → one customer timeline
```

Deliberately excluded: voice, email, Messenger, follow-up automation,
founder intelligence, summaries, the full Hub. Those are 2B onward.

### 2.1 What ships

> **Superseded — see `PHASE2_CANONICAL_PLAN.md` §2.** The table below
> bundles the WhatsApp identity merge into Phase 2A and uses a
> non-executable migration order (`043 timeline_events` before
> `044 identity_handles`, which `timeline_events` has a foreign key to).
> The canonical plan reduces Phase 2A to four migrations
> (`043`–`046`, Instagram→website→timeline only) and moves
> `identity_merge_log` and the `contacts` alteration to Phase 2B. Left
> below for historical reference only.

**Six tables.** Migrations `043`–`048`, applied strictly in order.

| Migration | Table(s) | Why in 2A |
|---|---|---|
| `043` | `timeline_events`, `timeline_event_types` | the spine; everything else writes to it |
| `044` | `identity_handles` | contacts must stop meaning "a phone number" |
| `045` | `identity_evidence`, `identity_evidence_policy` | the confidence rules, as data |
| `046` | `identity_merge_log` | 2A performs a real merge (web → WhatsApp); it must be audited and reversible from day one |
| `047` | `contacts` alterations — `phone` nullable, five-level confidence | unblocks non-phone identities |
| `048` | `continuation_tokens` | the tracked link itself |

**Full column set now, even for unused fields.** `tenant_id`, `brand_id`,
`campaign_id`, `ad_id`, `creative_id`, `confidence`, `visibility`,
`owner_user_id`, `action_state` all ship in `043` although 2A uses only
some. Rationale: this is the one table guaranteed to become large, and
`ALTER TABLE` on a multi-million-row event log is exactly the pain Phase
2 exists to avoid. This is the "unless the underlying event model
requires their fields now" exception, and it does.

**Not in 2A:** `consent_records`, `suppression_list`, `channel_policies`,
`followup_rules`, `followup_schedule`, `customer_summaries`, `insights`,
`saved_views`, `retention_policies`.

### 2.2 Sequence

Five increments. Each is independently shippable and revertable.

```
2A.1  Timeline, WhatsApp only            ── no identity change at all
      043 + write events from the existing inbound/outbound path
      handle_id NULL for now.  Read-only timeline page.
      ✔ Ships value alone: a real cross-time view of every WhatsApp
        conversation, and a working event log to observe 2A.2 with.

2A.2  Handles + contact model            ── THE RISKY ONE
      044–047. Backfill one whatsapp handle per existing contact
      BEFORE dropping the 022 unique index, in the same migration.
      Replace findExistingContact → resolveContactByHandle (4 call sites).
      Backfill handle_id onto 2A.1's events.

2A.3  Tracked link, Instagram → web
      048 + token issue/resolve + HMAC + web SDK (visitor_id, session_id)
      + ingest endpoint.  Anonymous visits recorded, no contact created.

2A.4  Web → WhatsApp handoff
      wa.me prefilled [ref:…]; webhook parses it from the FIRST inbound
      message; ALSO read Meta's native `referral` / `ctwa_clid` object.
      Merge web cluster into the WhatsApp contact at `strong`.

2A.5  One timeline, demonstrated
      Meera's journey rendered as a single thread across three channels.
```

**On ordering.** Putting the timeline (2A.1) before the identity change
(2A.2) means `handle_id` is briefly unused and needs a backfill. That is
a deliberate trade: it buys a working event log to *observe* the riskiest
migration in Phase 2 while it happens. Given the Phase 1 lesson — three
of five bugs were invisible to typecheck and tests — observability before
risk is worth one backfill.

### 2.3 Code surface

| Area | Change | Files |
|---|---|---|
| Identity resolution | `findExistingContact` → `resolveContactByHandle` | `src/lib/contacts/dedupe.ts` + 4 call sites |
| Timeline writer | one helper, called from existing paths | new `src/lib/timeline/` |
| Inbound webhook | write events; parse `[ref:…]`; read `referral`/`ctwa_clid` | `src/app/api/whatsapp/webhook/route.ts` |
| Tokens | issue, resolve, revoke + HMAC | new `src/lib/continuation/` |
| Web SDK | visitor id, session id, event ingest | new, + one public route |
| Instagram webhook | new route reusing `meta-api.ts` | new |
| Timeline UI | one page, one panel | new |

The four `findExistingContact` call sites
(`webhook/route.ts:996,1034` · `resolve-conversation.ts:92,117` ·
`api/v1/contacts.ts:125,145` · `contact-form.tsx:96,207`) are the whole
identity surface. **Change the shared function, not the call sites** —
patching one path leaves the other three creating phone-only contacts.

### 2.4 Acceptance criteria for 2A

Executed, not asserted. Every negative control watched to fail first.

1. A WhatsApp message produces exactly one timeline event; replaying the
   webhook 6× still produces one (the Phase 1 Comez idempotency standard).
2. A contact exists with `phone IS NULL`.
3. Two contacts cannot share a WhatsApp handle in one account.
4. An untracked website visit creates **no contact** and records an event
   with `contact_id NULL`.
5. That anonymous event appears on Meera's timeline after 2A.4 **with no
   event fact column changed** — compared before and after.
6. A forwarded token does **not** auto-merge the recipient into the
   sender's contact.
7. Expired, revoked, exhausted and invalid tokens are indistinguishable
   (all 404).
8. A cross-tenant token is rejected.
9. `UPDATE timeline_events SET summary=…` raises; `DELETE` is refused for
   `authenticated`.
10. The merge in 2A.4 appears in `identity_merge_log` and a split fully
    reverses it.
11. RLS: a second workspace sees none of it (positive **and** negative
    control — the Phase 1 false-pass lesson).
12. Full chain reapplies from zero, 0 errors; `typecheck` / `build` /
    `test` green.
13. One rendered timeline shows Instagram, web and WhatsApp events for
    one person in one thread.

Rough effort, low confidence: 2A.1 small · 2A.2 **large** · 2A.3 medium ·
2A.4 medium · 2A.5 small. 2A.2 dominates and should not be compressed.

---

## 3. Later increments

| Increment | Contents | Depends on | Rationale for deferring |
|---|---|---|---|
| **2B** | Consent + suppression + channel policies | 2A | Needed before *any* automated outbound. Ship before 2C, not with it |
| **2C** | Follow-up rules + schedule + nine gates | 2B | Meaningless without consent and policy windows |
| **2D** | Customer summaries | 2A | Needs a populated timeline to summarise |
| **2E** | Voice identity + call events | 2A | `realtime_turns` already exists in the brain; this is mostly an ingest + the context-release gate |
| **2F** | Messenger + email channels | 2A | Email needs a threading model — genuinely new |
| **2G** | Founder intelligence + insights | 2D | Needs summaries and volume; premature before both |
| **2H** | Full Hub (saved views, snooze, search) | 2A, 2D | 2A.5 ships a basic timeline; the full Hub is a UI project |
| **2I** | Retention + DPDP export/erasure | 2A | **Do not defer past first real customer data.** Legal exposure grows with row count |

**On 2I.** It is last in dependency order but must not be last in
calendar order. The moment production holds real customer events, the
erasure and export paths become obligations. Schedule it against
go-live, not against the backlog.

**On 2E.** Voice is cheaper than it looks — the brain already writes
`realtime_turns`, so most of the work is the tiered context-release gate
(`IDENTITY §7`), which is policy, not plumbing.

---

## 4. Relationship to other outstanding work

| Work | Interaction |
|---|---|
| **Phase 1 commit + PR** | Prerequisite. Phase 2 branches from it |
| **Blocker 3, ledger** | Gates every migration `043`+ |
| **Phase 1.1 generated types** | The architecture review recommends steps **3 (Contacts) and 6 (Inbox) only** before 2A.2 — those are exactly the files 2A.2 rewrites. Doing them first means fixing nullable-column bugs once, on smaller diffs |
| **Memory consolidation** (two vector stores) | Independent of 2A. Still the fastest-compounding debt; start it in parallel |
| **Brain repo coordination** | `events_outbox` emission for web/voice/order events; possible `product_demand_signals` forwarding; possible IG/Messenger handle columns on `public.customers` |

---

## 5. Consolidated unresolved decisions

Carried up from all four companion documents. **Bold blocks 2A.**

| # | Decision | Doc | Blocks |
|---|---|---|---|
| 1 | **Migration ledger method** | Phase 1 | **all of Phase 2** |
| 2 | **Handles in `crm` or `public`?** (proposed `crm`) | Identity §13.2 | **2A.2** |
| 3 | **Token signing key: rotation, per-tenant or global?** | Identity §13.4 | **2A.3** |
| 4 | **Web visitor id: cookie, localStorage, consent-banner interaction** | Identity §13.6 | **2A.3** |
| 5 | Does `probable` ever auto-promote by accumulation? (recommend **no**) | Identity §13.7 | 2A.4 |
| 6 | Phone recycling — dormancy gap that demotes a verified phone | Identity §13.5 | 2E |
| 7 | Brain writes timeline directly or via `events_outbox`? (propose outbox) | Timeline §11.2 | 2D/2E |
| 8 | Which event classes survive a DPDP erasure — **legal** | Timeline §11.3 | 2I |
| 9 | Call-recording consent capture — **legal** | Timeline §11.4 | 2E |
| 10 | Web SDK event volume: all page views or meaningful only? (recommend meaningful) | Timeline §11.6 | 2A.3 |
| 11 | Consent basis for CTWA-initiated conversations — **legal** | Follow-up §9.1 | 2B |
| 12 | Cross-channel fallback when outside a policy window (recommend no) | Follow-up §9.4 | 2C |
| 13 | Who may edit channel policies (recommend owner only) | Follow-up §9.3 | 2B |
| 14 | Summary regeneration trigger (recommend on-open + staleness) | Intelligence §7.2 | 2D |
| 15 | One AI config or two (`crm.ai_configs` vs brain persona) | Intelligence §7.3 | 2D |
| 16 | Insight support threshold (propose 5 events / 3 contacts) | Intelligence §7.4 | 2G |
| 17 | Do aggregate insights leak `sensitive` content? (recommend team-visible only) | Intelligence §7.5 | 2G |

Four block 2A. Three of those four (#2, #3, #4) are ours to decide in an
afternoon. **#1 is not, and it is the real gate.**

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Ledger blocker unresolved | **High** | Nothing applies. Escalate now — it has blocked since Phase 1 |
| Meta app review latency | **High** | Start immediately, parallel to 2A.1. Outside our control |
| 2A.2 drops a live uniqueness guarantee | **High** | Backfill before drop, same migration; from-zero reset; negative control on duplicate handles |
| Wrong merge reaches production | **High** | `strong`+ threshold, exclusivity check, full split reversal, audited merge log |
| Timeline write path misses events silently | Medium | `dedupe_key` + reconciliation count check against `messages` |
| Event volume growth | Medium | Meaningful web events only; partitioning deferred but indexed for |
| Token key compromise | Medium | Rotation plan (decision #3); revocation exists |
| Cross-repo drift with the brain | Medium | Outbox rather than triggers; the `PHASE1_SCHEMA_OWNERSHIP` rule holds |
| Scope creep into 2B–2I during 2A | Medium | The excluded list in §2.1 is explicit; treat additions as a decision, not a detail |

---

## 7. What "done" looks like for Phase 2A

One sentence a founder can verify without reading SQL:

> **Meera clicks an Instagram ad, browses the website, chats, moves to
> WhatsApp, and the CRM shows one person with one continuous history —
> and if she had forwarded that link to her sister, the CRM would show
> two people, correctly.**

The second half is the part that matters. Any system can merge
optimistically. The proof of this design is that it declines to.
