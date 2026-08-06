/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` under
 * `html[data-theme="..."]` blocks — that file is the one we paste
 * theme tokens into. This module only carries the metadata the UI
 * (settings picker, no-flash boot script) needs.
 *
 * Adding a new theme is a two-step change:
 *   1. Append the new `html[data-theme="<id>"]` block in globals.css
 *      with every token from an existing theme (use violet as the
 *      shape reference).
 *   2. Add an entry below. The order here drives the picker grid.
 */

export const THEME_IDS = [
  "azul",
  "violet",
  "emerald",
  "amber",
  "rose",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "azul";

export const STORAGE_KEY = "wacrm.theme";

/**
 * MODE — the light/dark dimension, orthogonal to the accent theme.
 *
 * The CSS variables live in `src/app/globals.css` under
 * `html[data-mode="..."]` blocks (neutral surfaces only). Applied
 * at runtime via `document.documentElement.dataset.mode`. Dark is
 * the historical default and stays the app's identity; light is the
 * opt-in eye-strain-friendly alternative.
 *
 * Persisted under its own localStorage key so it composes freely
 * with the accent choice (you can run Violet-light or Violet-dark).
 */
export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = "dark";

export const MODE_STORAGE_KEY = "wacrm.mode";

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /**
   * Static swatch color for the picker chip. Hard-coded so the boot
   * script / picker cards don't need a getComputedStyle round trip
   * before the page settles. Must mirror `--primary` of the same
   * theme in globals.css.
   */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "azul",
    name: "Azul",
    tagline: "The default — Azul Elefant brand blue.",
    // Must mirror --primary in globals.css: paints exactly #1A73E8.
    swatch: "oklch(0.573 0.195 258)",
  },
  {
    id: "violet",
    name: "Violet",
    tagline: "The upstream default — confident, slightly playful.",
    swatch: "oklch(0.526 0.247 293)",
  },
  {
    id: "emerald",
    name: "Emerald",
    tagline: "Growth-coded, nods at messaging without copying WhatsApp green.",
    swatch: "oklch(0.62 0.16 162)",
  },
  {
    id: "amber",
    name: "Amber",
    tagline: "Warm and friendly — feels good for SMB teams.",
    swatch: "oklch(0.745 0.16 65)",
  },
  {
    id: "rose",
    name: "Rose",
    tagline: "Bold and modern — D2C, creator-economy, lifestyle.",
    swatch: "oklch(0.645 0.22 16)",
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Retired theme ids → the theme that replaced them.
 *
 * `cobalt` was oklch(0.585 0.2 254); `azul` is oklch(0.574 0.195 258).
 * Visually the same blue, so anyone who had deliberately picked cobalt
 * wants azul — mapping is a better answer than silently dropping them
 * onto the default.
 *
 * This exists because the id is **persisted in the user's browser**
 * under `wacrm.theme`. Removing an id from THEME_IDS doesn't remove it
 * from the devices that already stored it, and without this map those
 * devices keep an unrecognised string in localStorage indefinitely.
 * The boot script rewrites the stored value on the next load, so an
 * entry only has to stay here long enough for every browser to come
 * back once — but it costs nothing to leave.
 */
export const LEGACY_THEME_ALIASES: Readonly<Record<string, ThemeId>> = {
  cobalt: "azul",
};

/**
 * Normalise a possibly-stale stored theme id. Returns the current id
 * for both live ids and retired ones, or null if the value is
 * unrecognised (caller falls back to DEFAULT_THEME).
 */
export function resolveThemeId(value: unknown): ThemeId | null {
  if (isThemeId(value)) return value;
  if (typeof value !== "string") return null;
  // hasOwnProperty, not `in` / bare indexing: `LEGACY_THEME_ALIASES["toString"]`
  // resolves up the prototype chain and would hand back a function.
  return Object.prototype.hasOwnProperty.call(LEGACY_THEME_ALIASES, value)
    ? LEGACY_THEME_ALIASES[value]
    : null;
}
