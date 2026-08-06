import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  LEGACY_THEME_ALIASES,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AE Yali - Omni",
    // "·" rather than an em dash — the brand name already contains a
    // hyphen, and "Contacts — AE Yali - Omni" reads as two separators.
    template: "%s · AE Yali - Omni",
  },
  description: "Founder operations dashboard — customers, conversations and activity in one place.",
  robots: {
    index: false,
    follow: false,
  },
  // No explicit `icons` entry: `src/app/icon.png` is a Next.js file
  // convention — the framework injects <link rel="icon"> with the right
  // type, sizes and cache-busting hash on its own. Declaring it here too
  // emits a duplicate, weaker link tag.
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#080C1A", // AE dark surface — matches --background in globals.css
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
//
// It is also where a retired theme id gets migrated. This is the first
// and only code to read `wacrm.theme` before paint, so rewriting the
// stored value here means a browser holding a retired id (`cobalt`)
// self-heals on its next load rather than carrying an unrecognised
// string forever. See LEGACY_THEME_ALIASES in `src/lib/themes.ts`.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var THEME_ALIASES = ${JSON.stringify(LEGACY_THEME_ALIASES)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    var aliased = Object.prototype.hasOwnProperty.call(THEME_ALIASES, savedTheme)
      ? THEME_ALIASES[savedTheme]
      : null;
    if (aliased) {
      d.dataset.theme = aliased;
      // Own try/catch: a setItem failure (private browsing, quota) must
      // not fall through to the outer catch and clobber the correct
      // accent we just applied.
      try { localStorage.setItem(THEME_KEY, aliased); } catch (_w) {}
    } else {
      // Unrecognised junk falls back to the default WITHOUT persisting —
      // writing here would pin the user to today's default forever.
      d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;
    }

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
