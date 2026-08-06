import { afterEach, describe, expect, it, vi } from "vitest";

import { readInitialTheme } from "./use-theme";
import { DEFAULT_THEME, STORAGE_KEY } from "@/lib/themes";

// `readInitialTheme` is the path taken when the boot script in
// src/app/layout.tsx never ran (a custom layout, a bypassed <head>).
// It has to repeat the boot script's migration: a retired theme id
// must be rewritten in place, not merely resolved for this render,
// or the dead id survives in the browser indefinitely.
//
// vitest runs in the `node` environment here (no jsdom), so the three
// browser globals are stubbed by hand — matching the vi.stubGlobal
// pattern used elsewhere in this suite.

/** Minimal localStorage double. `throwOnSet` simulates private browsing. */
function makeStorage(initial: string | null, opts: { throwOnSet?: boolean } = {}) {
  const store = { value: initial };
  return {
    store,
    setSpy: vi.fn(),
    api: {
      getItem: (k: string) => (k === STORAGE_KEY ? store.value : null),
      setItem: vi.fn((k: string, v: string) => {
        if (opts.throwOnSet) throw new DOMException("QuotaExceededError");
        if (k === STORAGE_KEY) store.value = v;
      }),
    },
  };
}

/** Boot script bypassed => no data-theme attribute on <html>. */
function stubBrowser(storage: ReturnType<typeof makeStorage>) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", storage.api);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readInitialTheme — legacy theme migration", () => {
  it("resolves a retired `cobalt` to `azul` AND persists the replacement", () => {
    const storage = makeStorage("cobalt");
    stubBrowser(storage);

    expect(readInitialTheme()).toBe("azul");

    expect(storage.api.setItem).toHaveBeenCalledWith(STORAGE_KEY, "azul");
    // The retired id must be gone from storage, not just remapped in memory.
    expect(storage.store.value).toBe("azul");
  });

  it("leaves a valid current theme untouched and does not rewrite it", () => {
    const storage = makeStorage("violet");
    stubBrowser(storage);

    expect(readInitialTheme()).toBe("violet");

    expect(storage.api.setItem).not.toHaveBeenCalled();
    expect(storage.store.value).toBe("violet");
  });

  it("falls back for an unknown value WITHOUT writing it", () => {
    const storage = makeStorage("chartreuse");
    stubBrowser(storage);

    expect(readInitialTheme()).toBe(DEFAULT_THEME);

    // Persisting here would pin this user to today's default forever,
    // so the junk is deliberately left in place instead.
    expect(storage.api.setItem).not.toHaveBeenCalled();
    expect(storage.store.value).toBe("chartreuse");
  });

  it("falls back for a malformed value WITHOUT writing it", () => {
    for (const junk of ["", "toString", "__proto__"]) {
      const storage = makeStorage(junk);
      stubBrowser(storage);

      expect(readInitialTheme()).toBe(DEFAULT_THEME);
      expect(storage.api.setItem).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    }
  });

  it("falls back when nothing is stored, without writing a default", () => {
    const storage = makeStorage(null);
    stubBrowser(storage);

    expect(readInitialTheme()).toBe(DEFAULT_THEME);
    expect(storage.api.setItem).not.toHaveBeenCalled();
  });

  it("still renders the migrated theme when the storage write throws", () => {
    const storage = makeStorage("cobalt", { throwOnSet: true });
    stubBrowser(storage);

    // The write is attempted and fails; rendering must not be affected.
    expect(() => readInitialTheme()).not.toThrow();
    expect(readInitialTheme()).toBe("azul");
    expect(storage.api.setItem).toHaveBeenCalled();
  });

  it("prefers the boot script's applied attribute over storage", () => {
    const storage = makeStorage("cobalt");
    stubBrowser(storage);
    vi.stubGlobal("document", {
      documentElement: { dataset: { theme: "emerald" } },
    });

    expect(readInitialTheme()).toBe("emerald");
    // Boot script already owns the migration on this path.
    expect(storage.api.setItem).not.toHaveBeenCalled();
  });
});
