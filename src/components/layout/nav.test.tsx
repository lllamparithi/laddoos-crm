import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../../../messages/en.json";

/**
 * Founder navigation contract — the sidebar IA and the header titles.
 *
 * Rendered with `renderToStaticMarkup` rather than a DOM testing library:
 * vitest runs on `environment: "node"` here, and the same approach already
 * pins DropdownMenuLabel and TimelineFeed. next-intl and the auth/unread
 * hooks are stubbed so the nav renders without a session or a database.
 */

const pathname = { current: "/hub" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

/** en.json nests deeper than one level in places, so model it honestly. */
type Catalogue = { [key: string]: string | Catalogue };

vi.mock("next-intl", () => ({
  // Resolve real copy from en.json so a missing key fails loudly here
  // instead of silently rendering a key name in production.
  useTranslations: (ns: "Sidebar" | "Header") => {
    const catalogue: Catalogue = en;
    const dict = catalogue[ns];
    return (key: string, values?: Record<string, unknown>) => {
      const raw = typeof dict === "object" ? dict[key] : undefined;
      if (typeof raw !== "string") {
        throw new Error(`missing string ${ns}.${key} in en.json`);
      }
      return values
        ? raw.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""))
        : raw;
    };
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    profile: { full_name: "Founder", email: "founder@example.test" },
    profileLoading: false,
    account: null,
    accountRole: "owner",
    signOut: () => {},
  }),
}));

const unread = { conversations: 0, notifications: 0 };
vi.mock("@/hooks/use-total-unread", () => ({
  useTotalUnread: () => unread.conversations,
}));
vi.mock("@/hooks/use-unread-notifications", () => ({
  useUnreadNotifications: () => unread.notifications,
}));

const { Sidebar } = await import("./sidebar");
const { Header } = await import("./header");

function renderSidebar(path = "/hub") {
  pathname.current = path;
  return renderToStaticMarkup(React.createElement(Sidebar, {}));
}
function renderHeader(path: string) {
  pathname.current = path;
  return renderToStaticMarkup(React.createElement(Header, {}));
}

// ---------------------------------------------------------------------------

describe("header page titles", () => {
  it.each([
    ["/hub", "Timeline"],
    ["/inbox", "Inbox"],
    ["/contacts", "Contacts"],
    ["/pipelines", "Pipelines"],
    ["/broadcasts", "Broadcasts"],
    ["/automations", "Automations"],
    ["/notifications", "Notifications"],
    ["/dashboard", "Dashboard"],
    ["/settings", "Settings"],
  ])("%s renders the title %s", (path, title) => {
    expect(renderHeader(path)).toContain(`>${title}</h1>`);
  });

  // The two that previously fell through to the "Dashboard" default.
  it("/flows renders 'Flows', not the Dashboard fallback", () => {
    const html = renderHeader("/flows");
    expect(html).toContain(">Flows</h1>");
    expect(html).not.toContain(">Dashboard</h1>");
  });

  it("/agents renders 'AI Agents', not the Dashboard fallback", () => {
    const html = renderHeader("/agents");
    expect(html).toContain(">AI Agents</h1>");
    expect(html).not.toContain(">Dashboard</h1>");
  });

  it("nested /flows/<id> still resolves to Flows", () => {
    expect(renderHeader("/flows/abc123")).toContain(">Flows</h1>");
  });
});

describe("sidebar information architecture", () => {
  it("renders the two section labels", () => {
    const html = renderSidebar();
    expect(html).toContain("Operate");
    expect(html).toContain("Grow");
  });

  it.each([
    "/hub",
    "/inbox",
    "/contacts",
    "/pipelines",
    "/broadcasts",
    "/automations",
    "/flows",
    "/agents",
    "/dashboard",
    "/settings",
  ])("keeps a link to %s", (href) => {
    expect(renderSidebar()).toContain(`href="${href}"`);
  });

  it("orders Operate before Grow, with Timeline first and Flows right after Automations", () => {
    const html = renderSidebar();
    const at = (s: string) => html.indexOf(s);
    expect(at("Operate")).toBeLessThan(at("Grow"));
    expect(at('href="/hub"')).toBeLessThan(at('href="/inbox"'));
    expect(at('href="/automations"')).toBeLessThan(at('href="/flows"'));
    expect(at('href="/flows"')).toBeLessThan(at('href="/agents"'));
  });

  it("marks Flows Beta and renders it as an ordinary link", () => {
    const html = renderSidebar();
    expect(html).toContain('href="/flows"');
    expect(html).toContain("Beta");
  });

  it("keeps the 44px mobile touch target and the accessible active token", () => {
    const html = renderSidebar();
    expect(html).toContain("min-h-11");
    expect(html).toContain("var(--nav-active-foreground)");
  });
});

/**
 * React emits attributes in JSX prop order, so `aria-current` and `href`
 * are not adjacent in the markup. Match the whole opening tag instead of
 * assuming attribute order.
 */
function anchorFor(html: string, href: string): string {
  // Scope to <nav>: the brand logo also links to /dashboard and is not a
  // nav row, so it must not be mistaken for one (it correctly carries no
  // aria-current).
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
  const escaped = href.replace(/[/-]/g, "\\$&");
  return nav.match(new RegExp(`<a[^>]*href="${escaped}"[^>]*>`))?.[0] ?? "";
}

describe("sidebar active state exposes aria-current", () => {
  it.each(["/hub", "/inbox", "/flows", "/agents", "/settings", "/dashboard"])(
    "%s is marked aria-current=page when active",
    (path) => {
      const html = renderSidebar(path);
      expect(anchorFor(html, path)).toContain('aria-current="page"');
      // Exactly one row may claim to be the current page.
      expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    },
  );

  it("marks the footer path too, not just the sectioned lists", () => {
    expect(anchorFor(renderSidebar("/settings"), "/settings")).toContain(
      'aria-current="page"',
    );
  });

  it("does not mark inactive rows", () => {
    const html = renderSidebar("/hub");
    expect(anchorFor(html, "/inbox")).not.toContain("aria-current");
    expect(anchorFor(html, "/settings")).not.toContain("aria-current");
  });
});

describe("notifications moved to the header affordance", () => {
  it("is absent from sidebar navigation", () => {
    expect(renderSidebar()).not.toContain('href="/notifications"');
  });

  it("is still reachable from the header", () => {
    expect(renderHeader("/hub")).toContain('href="/notifications"');
  });

  it("shows no count badge when nothing is unread", () => {
    unread.notifications = 0;
    const html = renderHeader("/hub");
    expect(html).toContain("Notifications, 0 unread");
    expect(html).not.toContain(">3<");
  });

  it("surfaces the unread count on the header bell", () => {
    unread.notifications = 3;
    const html = renderHeader("/hub");
    expect(html).toContain(">3<");
    expect(html).toContain("Notifications, 3 unread");
    unread.notifications = 0;
  });

  it("caps the displayed count at 9+", () => {
    unread.notifications = 42;
    expect(renderHeader("/hub")).toContain(">9+<");
    unread.notifications = 0;
  });

  it("still shows the inbox unread dot in the sidebar", () => {
    unread.conversations = 5;
    expect(renderSidebar("/contacts")).toContain("animate-ping");
    unread.conversations = 0;
  });
});
