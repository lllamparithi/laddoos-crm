import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Supabase CLI local-stack artifacts. These are gitignored, but ESLint's
    // flat config does not read .gitignore, so without this a developer who
    // has run `npx supabase start` lints the CLI's own bundled edge-runtime
    // source and sees ~150 phantom errors that CI never reports (CI checks
    // out clean, so these files do not exist there).
    "supabase/.temp/**",
    "supabase/.branches/**",
  ]),
]);

export default eslintConfig;
