import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 */
export async function findExistingContact(
  db: AnySupabaseClient,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .like("phone", `%${suffix}`);

  if (error || !data) return null;

  return (
    (data as ExistingContact[]).find((c) => phonesMatch(c.phone, phone)) ?? null
  );
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * Whether the contact form's submit button should be disabled.
 *
 * `checkingDup` is accepted but **deliberately ignored**. The phone
 * input runs the duplicate lookup on blur, and clicking Create while
 * that field still has focus fires the blur first — so gating the
 * button on the in-flight lookup disabled it during the very click
 * that started it. The click landed on a disabled button, the form's
 * submit handler never ran, and the create failed silently with no
 * insert and no error toast.
 *
 * Dropping the in-flight gate is safe because the duplicate protection
 * is layered, and the authoritative layer is the database. The submit
 * handler reads whatever `dupMatch` state it currently holds — it does
 * not re-run the lookup, so a submit that races an in-flight blur check
 * can pass that guard with stale or absent state. The unique constraint
 * on the generated `phone_normalized` column (migration 022) is what
 * actually settles the race; `isUniqueViolation` turns its rejection
 * into the same friendly duplicate notice. The lookup is an early
 * heads-up, not the guard.
 *
 * The parameter stays in the signature so the caller keeps passing the
 * real value and this stays a single pinned decision rather than a
 * silently deleted token — see the regression test in dedupe.test.ts.
 */
export function isContactSubmitDisabled(state: {
  saving: boolean;
  checkingDup: boolean;
  isEdit: boolean;
  dupMatch: { exact: boolean } | null;
}): boolean {
  return state.saving || (!state.isEdit && !!state.dupMatch?.exact);
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
