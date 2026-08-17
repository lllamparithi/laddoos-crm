import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import {
  dedupeByPhone,
  findExistingContact,
  isContactSubmitDisabled,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isContactSubmitDisabled", () => {
  const base = {
    saving: false,
    checkingDup: false,
    isEdit: false,
    dupMatch: null,
  };

  // The regression. The phone input runs the duplicate lookup on blur,
  // so clicking Create straight from that field fires blur first and
  // `checkingDup` is true at the moment the click lands. Gating the
  // button on it disabled the button mid-click: no submit handler, no
  // insert, no error toast, modal just sat there.
  it("stays enabled while the on-blur duplicate lookup is still in flight", () => {
    expect(isContactSubmitDisabled({ ...base, checkingDup: true })).toBe(false);
  });

  it("stays enabled mid-lookup even when a fuzzy match is already showing", () => {
    expect(
      isContactSubmitDisabled({
        ...base,
        checkingDup: true,
        dupMatch: { exact: false },
      }),
    ).toBe(false);
  });

  it("blocks an exact duplicate on create", () => {
    expect(
      isContactSubmitDisabled({ ...base, dupMatch: { exact: true } }),
    ).toBe(true);
  });

  it("allows a fuzzy trunk-variant match through (warn only)", () => {
    expect(
      isContactSubmitDisabled({ ...base, dupMatch: { exact: false } }),
    ).toBe(false);
  });

  it("does not block an exact match when editing that same contact", () => {
    expect(
      isContactSubmitDisabled({
        ...base,
        isEdit: true,
        dupMatch: { exact: true },
      }),
    ).toBe(false);
  });

  it("blocks while an insert is already saving", () => {
    expect(isContactSubmitDisabled({ ...base, saving: true })).toBe(true);
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // chain to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string }>): AnySupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });
});
