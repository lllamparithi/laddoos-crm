import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
      // Deliberately a DIFFERENT literal from META_APP_SECRET: the
      // Messenger webhook tests assert the App Secret alone cannot
      // satisfy GET verification, which is only a meaningful assertion
      // while these two values differ.
      MESSENGER_WEBHOOK_VERIFY_TOKEN: "test-messenger-verify-token",
    },
    clearMocks: true,
  },
});
