import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  LEGACY_THEME_ALIASES,
  THEME_IDS,
  THEMES,
  isThemeId,
  resolveThemeId,
} from "./themes";

// The theme id is persisted in the user's browser under `wacrm.theme`,
// so retiring an id is a data-migration problem, not just a rename.
// These cover the migration path added when `cobalt` became `azul`.

describe("resolveThemeId", () => {
  it("returns live ids unchanged", () => {
    for (const id of THEME_IDS) {
      expect(resolveThemeId(id)).toBe(id);
    }
  });

  it("maps the retired `cobalt` id to `azul`", () => {
    expect(resolveThemeId("cobalt")).toBe("azul");
  });

  it("returns null for unrecognised values so callers use the default", () => {
    expect(resolveThemeId("chartreuse")).toBeNull();
    expect(resolveThemeId("")).toBeNull();
    expect(resolveThemeId(null)).toBeNull();
    expect(resolveThemeId(undefined)).toBeNull();
    expect(resolveThemeId(42)).toBeNull();
  });

  it("does not resolve inherited Object properties through the alias map", () => {
    // Bare indexing or `in` would walk the prototype chain and hand back
    // a function here, which would then be written to <html data-theme>.
    expect(resolveThemeId("toString")).toBeNull();
    expect(resolveThemeId("constructor")).toBeNull();
    expect(resolveThemeId("__proto__")).toBeNull();
  });

  it("every alias target is a live theme id", () => {
    for (const target of Object.values(LEGACY_THEME_ALIASES)) {
      expect(isThemeId(target)).toBe(true);
    }
  });

  it("no alias key shadows a live theme id", () => {
    for (const key of Object.keys(LEGACY_THEME_ALIASES)) {
      expect(isThemeId(key)).toBe(false);
    }
  });
});

describe("theme catalog", () => {
  it("has catalog metadata for every id, in the same order", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it("defaults to a live theme", () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
  });
});
