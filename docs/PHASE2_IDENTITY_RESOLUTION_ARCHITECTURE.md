# Phase 2 — Cross-Channel Identity Resolution

**Status:** PROPOSAL. Nothing implemented, no migration written, nothing applied.
**Repo:** `laddoos-crm`, branch `phase1/fresh-migration-validation`
**Companion docs:** `PHASE2_UNIFIED_TIMELINE_SPEC.md`,
`PHASE2_FOLLOWUP_POLICY_ENGINE.md`, `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md`,
`PHASE2_IMPLEMENTATION_ROADMAP.md`

---

## The governing rule

> **The system must never assume two identities belong to the same
> customer without sufficient evidence.**

Everything in this document is a consequence of that sentence. Where a
design choice trades convenience against that rule, the rule wins and the
customer stays two records until evidence arrives.

Phase 1 already implements this rule for one channel. Migration `040`
separates *normalization* from *link eligibility*, refuses to link on a
value that merely normalizes successfully, fails closed on ambiguity, and
deliberately has **no `ORDER BY … LIMIT 1` fallback** anywhere. Phase 2
generalizes that existing pattern to every channel. It does not invent a
new one.

---

## 1. Audit — what already exists

Read before proposing anything. Verified against the working tree and the
generated `public` types.

### Reusable as-is

| Existing object | Where | Phase 2 role |
|---|---|---|
| `is_linkable_phone_e164()` + fail-closed `link_contact_to_customer()` | `040` | The confidence model, generalized to all handle types |
| `resolve_customer_candidates()` | `039` | Extend to email_hash; keep the 0/1/many semantics exactly |
| `workspace_brand_map` | `037` | Already the cross-tenant guard. Every identity operation scopes through it |
| `identity_link_conflicts` | `039` | Widen into the merge-review queue |
| `contacts.customer_link_source = 'manual'` protection | `039` | The precedent for "human decisions are never overwritten" |
| `conversations` UNIQUE `(account_id, contact_id)` | `036` | One thread per person — the Hub model |
| `messages.sender_type` (`customer`/`agent`/`bot`) | `001` | Already channel-neutral |
| `is_account_member()` RLS helper | `017` | RLS for every new table |
| `flow_runs.contact_id ON DELETE SET NULL` | `010` | The convention for preserving audit trail across deletes |
| `public.customers` (`phone_hash`, `email_hash`, `last_contact_channel`) | brain | The canonical person |
| `public.sessions.channel`, `chat_turns`, `chat_session_state.customer_id` | brain | Web chat identity and events already exist |
| `public.realtime_turns` | brain | Voice events already exist |

### Genuine gaps — nothing in the repo covers these

Verified by search; each returned zero results in `crm`:

| Gap | Evidence |
|---|---|
| Channel handles other than phone | `contacts.phone TEXT NOT NULL`, unique on `phone_normalized` |
| Confidence beyond two values | `customer_link_confidence CHECK (exact\|ambiguous)` |
| Campaign / ad attribution | zero hits for `campaign`, `utm_`, `attribution` |
| Consent / opt-out | zero hits in `crm`; brain has `leads.consent_flags` only |
| Continuation tokens | nothing |
| General-purpose event log | `flow_run_events` is flow-scoped; `automation_logs` is automation-scoped |
| Merge / split audit | `identity_link_conflicts` records ambiguity, not decisions |

**Conclusion:** the identity *policy* exists and is good. The identity
*model* is single-channel. Phase 2 widens the model and keeps the policy.

---

## 2. The three-layer identity model

The central correction: **a contact is not a person.**

```
  ┌─────────────────────────────────────────────────────────┐
  │  public.customers          THE PERSON  (brain-owned)     │
  │  canonical, DPDP-safe, phone_hash / email_hash           │
  └───────────────────────▲─────────────────────────────────┘
                          │  linked only on verified evidence
  ┌───────────────────────┴─────────────────────────────────┐
  │  crm.contacts              THE PROVISIONAL PERSON        │
  │  a cluster of handles believed to be one person          │
  │  within one workspace. May be wrong. May be split.       │
  └───────────────────────▲─────────────────────────────────┘
                          │  membership, with confidence
  ┌───────────────────────┴─────────────────────────────────┐
  │  crm.identity_handles      THE OBSERVED FACTS            │
  │  "this IGSID exists", "this wa_id exists".               │
  │  Never wrong. Never merged. Only ever re-clustered.      │
  └─────────────────────────────────────────────────────────┘
```

Handles are **immutable observations**. Contacts are **revisable
hypotheses**. Customers are **verified conclusions**. A merge or split
changes layer 2, never layer 3. That is what makes the timeline
append-only and a wrong merge fully reversible.

### 2.1 Handle types

| `handle_type` | Channel | Stability | Notes |
|---|---|---|---|
| `instagram_scoped_id` | Instagram | Per app+user (IGSID) | Not a username. Not portable across apps |
| `messenger_scoped_id` | Messenger | Per page+user (PSID) | Same person differs per page |
| `whatsapp_wa_id` | WhatsApp | Stable | Meta-verified; usually equals the phone |
| `phone_e164` | WhatsApp / voice | Stable | Reusable by a new subscriber after disconnection |
| `verified_phone` | any | Stable | OTP-confirmed in *this* system |
| `verified_email` | email / web | Stable | Click-through or OTP confirmed |
| `web_visitor_id` | website | Weak — per browser | First-party. Cleared by the user at will |
| `web_session_id` | website | Single session | Child of a visitor id |
| `voice_caller_number` | telephone | Weak — spoofable | ANI. Never sufficient alone for PII release |
| `customer_id` | brain | Canonical | Pointer to `public.customers` |
| `continuation_token` | cross-channel | Transient | Not an identity — an *evidence carrier* |

`continuation_token` is deliberately listed as a handle type so token
redemptions appear in the same evidence stream as everything else. It
never persists as a cluster member.

### 2.2 Confidence levels

| Level | Meaning | Auto-link? | Reversible |
|---|---|---|---|
| `verified` | Cryptographic, OTP, or completed transaction proof | Yes | Yes, audited |
| `strong` | Platform-attested or single-use signed token redemption | Yes | Yes, audited |
| `probable` | Plausible but forgeable or forwardable | **No — queue for human** | n/a |
| `unknown` | Observed, unlinked | Never | n/a |
| `rejected` | A human or the customer denied the link | **Blocks future auto-link** | Only by a human |

`rejected` is a first-class stored value, not the absence of a link. It
must survive reconciliation exactly as `customer_link_source = 'manual'`
does today (`039`). Without it, every nightly reconciliation re-proposes
a link a human already refused.

**Auto-merge threshold: `strong` or above, AND the handle is exclusive
within `(tenant_id, brand_id)`.** Both conditions. Exclusivity is
resolved through `workspace_brand_map`, reusing the Phase 1 scoping.

### 2.3 Evidence → confidence table

This table *is* the policy. It is data, not code — stored in
`crm.identity_evidence_policy` so it is auditable and changeable without
a deploy.

| Evidence type | Max confidence | Auto-link |
|---|---|---|
| OTP-verified phone | `verified` | Yes |
| Verified email click-through | `verified` | Yes |
| Completed order matched to `public.customers` | `verified` | Yes |
| Payment instrument match | `verified` | Yes |
| Agent manual link (named human) | `verified` | Yes, audited |
| Single-use signed continuation token, first redemption | `strong` | Yes |
| WhatsApp inbound carrying a valid signed ref | `strong` | Yes |
| Meta `ctwa_clid` ad referral on first WhatsApp message | `strong` | Yes |
| Caller ID unique within `(tenant, brand)` | `strong` | Context only — see §5 |
| Customer typed their own phone into chat | `probable` | **No** |
| Continuation token, second+ redemption | `probable` | **No** |
| Caller ID matching 2+ contacts | `probable` | **No** |
| Same name | `unknown` | **Never** |
| Same IP address | `unknown` | **Never** |
| Same city / region | `unknown` | **Never** |
| Similar language / dialect | `unknown` | **Never** |
| Device fingerprint | `unknown` | **Never** |
| Temporal proximity | `unknown` | **Never** |
| Customer denial, or agent unlink | `rejected` | Blocks |

The six `Never` rows are enforced structurally: no code path may write an
`identity_evidence` row whose `evidence_type` is absent from the policy
table, and the policy table's seed contains no row for name, IP, city,
language, fingerprint or timing. A weak signal may be *recorded on the
timeline* as an observation; it can never become link evidence.

---

## 3. Proposed SQL

Migration numbers continue from `042`. **None of these may be applied
until production blocker 3 (shared migration ledger) is resolved.**

```sql
-- 043_identity_handles.sql

CREATE TABLE IF NOT EXISTS identity_handles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle_type    TEXT NOT NULL,          -- FK to identity_handle_types
  channel        TEXT NOT NULL,          -- 'instagram','whatsapp','web','voice',...
  handle_value   TEXT,                   -- NULL when PII-minimised to hash only
  handle_hash    TEXT NOT NULL,          -- sha256(normalised value); the join key
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  confidence     TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (confidence IN
                     ('verified','strong','probable','unknown','rejected')),
  verified_at    TIMESTAMPTZ,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (account_id, handle_type, handle_hash)
);

-- A handle detached from its contact (a split) keeps its history:
-- ON DELETE SET NULL follows the flow_runs / automation_logs convention.
CREATE INDEX IF NOT EXISTS idx_identity_handles_contact
  ON identity_handles(contact_id);
CREATE INDEX IF NOT EXISTS idx_identity_handles_hash
  ON identity_handles(account_id, handle_hash);
```

```sql
-- 044_identity_evidence.sql

CREATE TABLE IF NOT EXISTS identity_evidence_policy (
  evidence_type   TEXT PRIMARY KEY,
  max_confidence  TEXT NOT NULL
                    CHECK (max_confidence IN
                      ('verified','strong','probable','unknown','rejected')),
  auto_link       BOOLEAN NOT NULL DEFAULT false,
  description     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seeded from §2.3. Deliberately contains NO row for name, ip, city,
-- language, device_fingerprint or timing_proximity.

CREATE TABLE IF NOT EXISTS identity_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle_id       UUID NOT NULL REFERENCES identity_handles(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  evidence_type   TEXT NOT NULL REFERENCES identity_evidence_policy(evidence_type),
  confidence      TEXT NOT NULL
                    CHECK (confidence IN
                      ('verified','strong','probable','unknown','rejected')),
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_event_id UUID,                  -- timeline_events.id
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('system','agent','customer')),
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes           TEXT,
  expires_at      TIMESTAMPTZ            -- token-derived evidence can age out
);
```

```sql
-- 045_identity_merge_log.sql   (append-only)

CREATE TABLE IF NOT EXISTS identity_merge_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation      TEXT NOT NULL CHECK (operation IN ('merge','split','link','unlink','reject')),
  source_contact_id UUID,                -- no FK: survives contact deletion
  target_contact_id UUID,
  handle_ids     UUID[] NOT NULL DEFAULT '{}',
  confidence     TEXT NOT NULL,
  evidence_ids   UUID[] NOT NULL DEFAULT '{}',
  reverses_id    UUID REFERENCES identity_merge_log(id),
  performed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason         TEXT
);

REVOKE UPDATE, DELETE ON identity_merge_log FROM authenticated, anon, service_role;
```

```sql
-- 046_contacts_multichannel.sql

ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

-- The 022 unique index is replaced by handle-level uniqueness.
-- Backfill one whatsapp handle per existing contact BEFORE dropping.
DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS identity_confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (identity_confidence IN
      ('verified','strong','probable','unknown','rejected')),
  ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT true;

-- Widen the Phase 1 two-value confidence to the five-level scale.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_customer_link_confidence_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_customer_link_confidence_check
  CHECK (customer_link_confidence IN
    ('verified','strong','probable','unknown','rejected') OR customer_link_confidence IS NULL);
```

> **Migration risk note.** `046` drops a uniqueness guarantee that four
> code paths rely on today (`findExistingContact` call sites). The
> handle-level unique index must exist and be backfilled *in the same
> migration, before the drop*, and the from-zero reset must include a
> negative control proving two contacts cannot share a WhatsApp handle
> within one account.

---

## 4. Continuation tokens

### 4.1 Why both signed *and* stateful

The requirements are: no PII, resolves server-side, signed, expiring,
revocable, carries conversation + campaign, replay-resistant,
tenant-bound.

A pure JWT satisfies *signed* and *expiring* but cannot be revoked and
leaks structure. A pure opaque database key satisfies *revocable* and
*no PII* but lets an attacker probe the database with random guesses.

**Design: opaque random id, HMAC-signed.** The signature is a cheap gate
that rejects forged and enumerated tokens without a database round trip;
the row is the authority for expiry, revocation and use count.

```
yali_ref = v1.<token_id_base64url>.<hmac_sha256_sig_base64url>

  token_id  = 16 random bytes (CSPRNG). Carries no meaning.
  sig       = HMAC-SHA256(server_key, "v1." + token_id)  truncated to 16 bytes
```

Resolution order — cheapest rejection first:

1. Parse and check version prefix. Malformed → 404, no DB hit.
2. Verify HMAC in constant time. Invalid → 404, no DB hit.
3. Look up `token_hash = sha256(token_id)`. Absent → 404.
4. Check `revoked_at IS NULL`, `expires_at > now()`, `use_count < max_uses`.
5. Check `tenant_id` / `brand_id` match the serving host's binding.
6. Record redemption. Bind identity **only if this is the first use.**

The raw token is never stored — only `sha256(token_id)`, following the
`phone_hash` precedent already set by the brain.

### 4.2 Table

```sql
-- 047_continuation_tokens.sql

CREATE TABLE IF NOT EXISTS continuation_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  brand_id            UUID NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,     -- sha256(token_id). Raw never stored
  purpose             TEXT NOT NULL CHECK (purpose IN
                        ('ig_to_web','messenger_to_web','web_to_wa','email_to_web','voice_to_web')),
  origin_channel      TEXT NOT NULL,
  origin_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  origin_contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  origin_handle_id    UUID REFERENCES identity_handles(id) ON DELETE SET NULL,
  campaign_id         TEXT,
  ad_id               TEXT,
  creative_id         TEXT,
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  max_uses            INTEGER NOT NULL DEFAULT 5,
  use_count           INTEGER NOT NULL DEFAULT 0,
  first_used_at       TIMESTAMPTZ,
  binds_identity      BOOLEAN NOT NULL DEFAULT true,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_continuation_tokens_origin
  ON continuation_tokens(origin_conversation_id);
```

Default TTL by purpose (configurable, not hardcoded):
`ig_to_web` 7 days · `web_to_wa` 1 hour · `email_to_web` 30 days ·
`voice_to_web` 15 minutes.

### 4.3 The forwarding threat — and the honest answer

Meera receives the link in Instagram and forwards it to her sister. Her
sister clicks first.

A naive design binds the sister's browser to Meera's contact — precisely
the wrong-merge the governing rule forbids. Single-use tokens reduce the
window but do not close it: the sister may still be the first clicker.

**Therefore a token redemption proves attribution, not identity.**

| Claim | Confidence | Reasoning |
|---|---|---|
| "This visit originated from conversation X / campaign Y" | `strong` | The token came from that conversation. Forwarding does not change its origin |
| "This browser belongs to the person in conversation X" | `probable` | Forwardable. Never sufficient for auto-merge on its own |

So the token binds the web session to the **conversation** at `strong`
(attribution is safe and useful), and creates a `probable` identity
edge that waits for corroboration. It is promoted to `verified` only
when a stronger signal arrives on the same lineage — a WhatsApp handoff
carrying the descendant token, an OTP, or an order.

This is slightly less convenient and strictly correct.

### 4.4 Visiting without a tracked link

The visitor stays **anonymous**, and that is the designed outcome, not a
degraded one.

1. A `web_visitor_id` handle is created with `confidence = 'unknown'` and
   `contact_id = NULL`.
2. Timeline events are written against `handle_id`, with `contact_id`
   NULL.
3. No contact is created. No customer is guessed at. No name, IP, city or
   fingerprint is consulted.
4. If stronger evidence later arrives — the visitor gives a phone in
   chat and confirms an OTP, or places an order — the handle joins a
   cluster and **the earlier anonymous events resolve onto that person's
   timeline retroactively**, because events store the immutable
   `handle_id` alongside the mutable resolved `contact_id`.

That late-binding property is why the timeline keys on handle *and*
contact. It is what lets history be complete without ever being
rewritten. See `PHASE2_UNIFIED_TIMELINE_SPEC.md` §3.

---

## 5. Instagram → website (flow)

```
Meta ad  ──► Instagram DM opens ──► IGSID observed
                    │                    │
                    │        identity_handles(instagram_scoped_id, unknown)
                    │        contacts row created (provisional)
                    ▼
        Agent/bot sends product link
        token issued: purpose=ig_to_web, binds origin_conversation_id,
        campaign_id, ad_id;  TTL 7d;  max_uses 5
                    │
                    ▼
   https://laddoos.com/products/millet-laddoo?yali_ref=v1.AbC…​.9Xy…
                    │
                    ▼
        Server resolves:  verify HMAC → load row → check expiry,
        revocation, use_count, tenant/brand binding
                    │
        ┌───────────┴────────────┐
        │ first use              │ subsequent use
        ▼                        ▼
  bind web_visitor_id      serve page, record
  ↔ conversation           campaign.click event,
  attribution: strong      no identity binding
  identity edge: probable
                    │
                    ▼
        timeline: campaign.token_redeemed, web.visit
        yali_ref stripped from the URL via history.replaceState
```

The `yali_ref` parameter is removed from the address bar immediately
after resolution so it is not copied, screenshotted, shared, or leaked
in a `Referer` header to third-party assets.

---

## 6. Website → WhatsApp (flow)

Cookies do not survive the jump to WhatsApp. The reference must travel
**inside the message body**.

```
Website chat ──► "Continue on WhatsApp" ──► issue token
                  purpose=web_to_wa, TTL 1h, max_uses 1,
                  parent = the ig_to_web token (lineage preserved)
                          │
                          ▼
   https://wa.me/9198XXXXXXXX?text=Hi%2C%20I'd%20like%20to%20order%20%5Bref%3AAbC123%5D
                          │
                          ▼
        Customer sends the prefilled message
                          │
                          ▼
   Inbound webhook: parse [ref:…] from the FIRST inbound message only
                          │
        ┌─────────────────┴──────────────────┐
        │ valid, unexpired, unused           │ absent or invalid
        ▼                                    ▼
  wa_id + phone are Meta-attested     Normal new-contact path.
  → verified phone handle             No link. Customer is simply
  → merge web cluster into            a new contact. Fail closed.
    WhatsApp contact at `strong`
  → lineage attributes the whole
    journey back to the IG ad
```

Because WhatsApp's `wa_id` is platform-attested, this is the step where a
`probable` web identity becomes a `verified` phone — the corroboration
§4.3 was waiting for.

**Also capture Meta's native referral.** When the customer arrives from a
click-to-WhatsApp ad, the inbound webhook payload carries a `referral`
object with `source_id` (ad id), `source_type` and `ctwa_clid`. That is
platform-attested attribution requiring no token at all, and it should be
read whenever present — it covers the ad → WhatsApp path directly,
without a website visit.

The `[ref:…]` marker is stripped from the message text shown in the
inbox; the raw body is retained in the event payload.

---

## 7. Phone / voice identity

Caller ID is spoofable. It is `strong` evidence for *routing* and
`probable` evidence for *identity*, and it **never releases PII on its
own**.

### 7.1 Context release gate

```
Inbound call, ANI = +9198…
        │
        ▼
voice_context_for_caller(ani, tenant_id, brand_id)
        │
 ┌──────┼───────────────┬────────────────────┬──────────────────┐
 │ 1 match              │ 2+ matches         │ 0 matches        │ hidden/withheld
 ▼                      ▼                    ▼                  ▼
tier: RETURNING    tier: AMBIGUOUS      tier: ANONYMOUS    tier: ANONYMOUS
name, open order   no names, no PII;    nothing            nothing
status, last       agent must ask a
interaction        disambiguating
                   question
        │
        ▼  caller asks for anything in a higher tier
   verification challenge: order ID + registered pincode,
   or OTP to the number on file
        │
        ▼
tier: VERIFIED — full context released, `verified` evidence written
```

### 7.2 Required cases

| Case | Behaviour |
|---|---|
| **Hidden caller ID** | No handle, no match, `ANONYMOUS` tier. Verification required for anything customer-specific |
| **Alternate phone** | No match → anonymous. After verification, the new number is added to the cluster as a `verified_phone` handle |
| **Shared family number** | 2+ contacts match → `AMBIGUOUS`. **Never guess.** The agent's disambiguating answer becomes `agent_manual_link` evidence for that call only |
| **Duplicate contacts** | Same as ambiguous. Also raises an `identity_link_conflicts` row for later cleanup |
| **Manual resolution** | Agent picks the right contact in the UI → `verified` evidence, written to `identity_merge_log` with their user id |

The "shared family number" case is the clearest illustration of the
governing rule. Two people genuinely share one phone. Any system that
auto-merges them is wrong about a real person, permanently, and silently.

---

## 8. Merge and split workflow

### Merge

```
evidence arrives
      ▼
policy lookup: identity_evidence_policy[evidence_type]
      ▼
confidence >= 'strong' AND handle exclusive in (tenant, brand)?
      │                                    │
     yes                                  no
      ▼                                    ▼
auto-merge:                     identity_link_conflicts row
 - move handles to survivor       status='open'
 - survivor = oldest contact      → Hub review queue
 - re-point child rows            → human decides
 - write identity_merge_log       → decision = `verified` evidence
 - emit identity.merged event
```

Survivor selection is **oldest contact wins**, matching the existing
`022` / `036` merge functions so all three behave alike.

### Split

Split is the reason the three-layer model exists. Because handles are
never destroyed and timeline events carry `handle_id`, a split is:

1. Detach the disputed handles from the contact (`contact_id = NULL`).
2. Create or reattach to the correct contact.
3. Write `identity_merge_log(operation='split', reverses_id=<merge id>)`.
4. Write a `rejected` evidence row so reconciliation never re-proposes it.
5. Re-resolve affected timeline events — **no event row is edited**; the
   resolved view recomputes from current handle membership.

No history is lost or rewritten in either direction.

---

## 9. Worked example — Meera

| # | Event | Handle observed | Confidence | Cluster |
|---|---|---|---|---|
| 1 | Clicks Instagram ad | — | — | — |
| 2 | Sends IG DM | `instagram_scoped_id` | `unknown` | Contact A (provisional) |
| 3 | Bot sends product link | token issued (`ig_to_web`) | — | A |
| 4 | Opens link | `web_visitor_id` | attribution `strong`; identity `probable` | A (probable) |
| 5 | Browses, no chat | `web_session_id` | `unknown` | A |
| 6 | Starts website chat | — | — | A |
| 7 | Clicks "Continue on WhatsApp" | token issued (`web_to_wa`, 1h, 1 use) | — | A |
| 8 | Sends prefilled WhatsApp message | `whatsapp_wa_id`, `phone_e164` | **`verified`** (Meta-attested) | **A confirmed** |
| 9 | Abandons cart | — | — | A |
| 10 | Calls from the same number | `voice_caller_number` | `strong`, unique | A → `RETURNING` tier |
| 11 | Places order | `customer_id` | `verified` | **A ↔ `public.customers`** |
| 12 | Fulfilment, follow-up, repeat order | — | — | one timeline |

Step 8 is the hinge: everything before it was provisional, and one
platform-attested fact retroactively resolves the whole journey — without
a single inference from name, IP, city, language, device or timing.

**The counterfactual matters equally.** If Meera had deleted the
prefilled text at step 8, she would have become a second contact, and the
Hub would show a `probable` suggestion for a human to confirm. That is
the correct outcome, not a bug.

---

## 10. Security threats

| # | Threat | Mitigation |
|---|---|---|
| T1 | Token forgery | HMAC verified before any DB access; 16-byte CSPRNG id |
| T2 | Token enumeration | Signature gate + constant-time compare; no oracle in the 404 |
| T3 | Replay | `max_uses`, `use_count`, `first_used_at`; identity binds on first use only |
| T4 | **Link forwarding → wrong merge** | Token gives `strong` *attribution*, `probable` *identity*. Never auto-merges alone (§4.3) |
| T5 | Cross-tenant token use | `tenant_id`/`brand_id` on the row, checked against the serving host |
| T6 | Caller ID spoofing | ANI never releases PII; tiered gate + verification challenge (§7) |
| T7 | Phone recycling — number reassigned to a new subscriber | `verified_phone` evidence carries `observed_at`; a dormancy gap + a contradicting name should demote to `probable`, not silently persist |
| T8 | PII in URLs / `Referer` leakage | Opaque token only; stripped via `replaceState` immediately after resolution |
| T9 | Agent malice or error | Every manual link is attributed and reversible via `identity_merge_log` |
| T10 | Timeline tampering | Append-only: `REVOKE UPDATE, DELETE`; corrections are new events |
| T11 | Token row leak via DB read | Only `sha256(token_id)` is stored; the raw token is unrecoverable |
| T12 | Merge-induced data exposure — a wrong merge shows one customer another's history | Auto-merge requires `strong`+ and exclusivity; splits fully reverse; merge log is auditable |

---

## 11. API contracts

```http
POST /api/v1/continuation-tokens
  Auth: API key (scoped) or session
  Body: { purpose, origin_conversation_id?, campaign_id?, ad_id?,
          ttl_seconds?, max_uses?, binds_identity? }
  201 → { token, url, expires_at }        # token returned ONCE, never stored raw
```

```http
GET /api/v1/continuation-tokens/:ref/resolve
  Server-side only; not callable from the browser.
  200 → { purpose, origin_conversation_id, campaign_id, ad_id,
          first_use: bool, tenant_id, brand_id }
  404 → invalid | expired | revoked | exhausted   # deliberately indistinguishable
```

```http
POST /api/v1/continuation-tokens/:id/revoke
  204
```

```http
POST /api/v1/identity/observe
  Body: { handle_type, channel, handle_value, evidence_type,
          source_event_id?, conversation_id? }
  200 → { handle_id, contact_id | null, confidence, action:
          'linked' | 'queued_for_review' | 'recorded_only' }
```

```http
POST /api/v1/identity/merge     { source_contact_id, target_contact_id, reason }
POST /api/v1/identity/split     { contact_id, handle_ids[], reason }
POST /api/v1/identity/reject    { contact_id, handle_id, reason }
  → all write identity_merge_log; all require an authenticated human
```

```http
GET  /api/v1/voice/context?ani=<e164>
  200 → { tier: 'anonymous'|'ambiguous'|'returning'|'verified',
          context: {...} | null, requires_verification: bool,
          disambiguation_prompt?: string }
```

The resolve endpoint returning an identical 404 for invalid, expired,
revoked and exhausted tokens is deliberate — distinguishing them would
turn the endpoint into an oracle.

---

## 12. Acceptance criteria

1. A contact can exist with **no phone number**.
2. No code path can create an identity link from name, IP, city,
   language, device fingerprint or timing. Proven by a **negative
   control** that attempts each and asserts rejection.
3. A forwarded continuation token does **not** auto-merge the recipient
   into the sender's contact. Proven by an executed test.
4. A `rejected` link survives a full `reconcile_contact_customer_links()`
   run. Proven by executing reconciliation and re-asserting.
5. Two contacts sharing one phone (family) produce `AMBIGUOUS`, never a
   guess.
6. Every merge and split appears in `identity_merge_log` with an actor.
7. A split fully restores the pre-merge view without editing any
   timeline event row.
8. Expired, revoked and exhausted tokens are indistinguishable from
   invalid ones.
9. A cross-tenant token is rejected.
10. Full chain reapplies from zero, 0 errors; suite green.

Per the Phase 1 lesson — *a test that has never been observed failing is
not known to work* — every negative control above must be watched to fail
before it is trusted.

---

## 13. Unresolved decisions

1. **Migration ledger** (blocker 3). Blocks every migration here.
2. **Do channel handles belong in `crm` or `public`?** Proposed `crm`, on
   the grounds that the CRM is the channel-facing system and the brain
   owns the person. If the brain should own handles canonically, `043`
   becomes a brain-repo migration and cross-repo coordination.
3. **Does `public.customers` gain Instagram/Messenger handle columns?**
   Not blocking — IG-only people stay `customer_id NULL` — but it caps
   how complete the canonical record can be.
4. **Token signing key management.** Rotation strategy, and whether the
   key is per-tenant. Per-tenant limits blast radius; adds operational
   cost.
5. **Phone recycling (T7).** What dormancy gap should demote a
   `verified_phone`? Needs a business answer, not an engineering one.
6. **Web visitor id storage.** First-party cookie vs `localStorage` vs
   both; and the consent banner interaction.
7. **Is `probable` ever auto-promoted by accumulation?** Recommendation:
   **no.** Two `probable` signals should not equal one `strong` — that is
   inference by another name. Needs an explicit decision to close.
