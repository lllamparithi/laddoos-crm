import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

// ---------------------------------------------------------------------------
// Route protection.
//
// /hub (the Timeline page added in PR #8) shipped absent from protectedPaths,
// so production served its shell with HTTP 200 to anonymous visitors while
// /dashboard correctly redirected. No customer data was reachable — the page
// fetches through the authenticated browser client and RLS blocks anon — but
// the authentication boundary was not what it appears to be from the UI.
//
// protectedPaths is a hardcoded allow-list, so every new authenticated route
// has to be added by hand and nothing fails when one is forgotten. These tests
// pin /hub and its neighbours so this specific regression cannot come back.
// ---------------------------------------------------------------------------
describe("middleware — authenticated route protection", () => {
  it("redirects an unauthenticated user off /hub to /login (the PR #8 gap)", async () => {
    mockUser = null;

    const res = await middleware(new NextRequest("https://app.test/hub"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("also protects paths beneath /hub", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/hub/anything"),
    );

    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets a signed-in user reach /hub", async () => {
    mockUser = { id: "user-1" };

    const res = await middleware(new NextRequest("https://app.test/hub"));

    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    "/dashboard",
    "/inbox",
    "/contacts",
    "/pipelines",
    "/broadcasts",
    "/automations",
    "/settings",
  ])("still redirects an unauthenticated user off %s", async (path) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${path}`));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it.each(["/login", "/signup", "/forgot-password"])(
    "leaves the public auth page %s reachable when signed out",
    async (path) => {
      mockUser = null;

      const res = await middleware(new NextRequest(`https://app.test${path}`));

      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/join/abc123", "/api/web-events"])(
    "leaves the public route %s reachable when signed out",
    async (path) => {
      mockUser = null;

      const res = await middleware(new NextRequest(`https://app.test${path}`));

      expect(res.headers.get("location")).toBeNull();
      expect(res.status).not.toBe(401);
    },
  );
});

// ---------------------------------------------------------------------------
// Legacy routes that predate /hub.
//
// /flows, /agents and /notifications are genuine founder-authenticated CRM
// pages that were never added to protectedPaths, so production served their
// shells with HTTP 200 to anonymous visitors. No customer data was reachable —
// the backing APIs return 401 and the pages fetch client-side under RLS — but
// the route-level authentication boundary was not what the UI implies.
//
// /flows is the one with nested pages (/flows/[id], /flows/[id]/runs), so the
// sub-path case is asserted explicitly rather than assumed from startsWith().
// ---------------------------------------------------------------------------
describe("middleware — legacy route protection", () => {
  it.each(["/flows", "/flows/test-id", "/agents", "/notifications"])(
    "redirects an unauthenticated user off %s to /login",
    async (path) => {
      mockUser = null;

      const res = await middleware(new NextRequest(`https://app.test${path}`));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    },
  );

  it.each(["/flows", "/flows/test-id", "/agents", "/notifications"])(
    "lets a signed-in user reach %s",
    async (path) => {
      mockUser = { id: "user-1" };

      const res = await middleware(new NextRequest(`https://app.test${path}`));

      expect(res.headers.get("location")).toBeNull();
    },
  );
});
