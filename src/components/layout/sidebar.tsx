"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  Activity,
  Bot,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { BrandMark } from "@/components/brand/brand-mark";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    // Foreground is a per-mode token, not a flat `text-amber-300`: that
    // shade measured 1.33:1 on the light-mode chip. See globals.css.
    className:
      "border-amber-500/40 bg-amber-500/10 text-[var(--role-owner-foreground)]",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    // `text-primary` on this tint measured 3.81 / 3.95:1 — same hue-on-hue
    // problem the active nav row has, so it uses the same token.
    className:
      "border-primary/40 bg-primary/10 text-[var(--on-primary-soft)]",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /**
   * Renders the row indented, reading as related to the row above it.
   * Flows is the advanced visual journey-builder that sits alongside the
   * everyday Automations rule-builder — both are kept, and the indent
   * says "same job, deeper tool" without demoting Flows to a submenu.
   * It stays an ordinary, focusable link to its own route.
   */
  subordinate?: boolean;
}

interface NavSection {
  /** Key in the Sidebar namespace. Rendered as a real group label. */
  labelKey: string;
  items: NavItem[];
}

// Two labelled sections mirroring what the founder actually does:
// run today (Operate), then build leverage for next week (Grow).
// Notifications deliberately has no row here — it lives on the header
// bell, which carries the same unread count. The /notifications route
// and page are untouched.
const navSections: NavSection[] = [
  {
    labelKey: "sectionOperate",
    items: [
      { href: "/hub", labelKey: "timeline", icon: Activity },
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
    ],
  },
  {
    labelKey: "sectionGrow",
    items: [
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap },
      {
        href: "/flows",
        labelKey: "flows",
        icon: Workflow,
        beta: true,
        subordinate: true,
      },
      { href: "/agents", labelKey: "aiAgents", icon: Bot },
    ],
  },
];

// Unlabelled footer group: reachable, deliberately quiet. Dashboard moved
// here because Timeline is now the founder's activity view; the logo also
// links to /dashboard.
const footerNavItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/settings", labelKey: "settings", icon: Settings },
];

/** Unchanged from the previous flat nav — same matching, same edge case. */
function isNavItemActive(pathname: string, href: string): boolean {
  return (
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
  );
}

/**
 * One nav row. Every rendering path in this sidebar goes through here,
 * which is the point: `aria-current="page"` cannot be applied to the
 * sectioned lists and forgotten on the footer list, because there is
 * only one implementation. The active state is colour-only otherwise,
 * so assistive tech had no position cue at all before this.
 */
function NavRow({
  item,
  active,
  t,
  totalUnread,
}: {
  item: NavItem;
  active: boolean;
  t: ReturnType<typeof useTranslations>;
  totalUnread: number;
}) {
  const showUnreadDot = item.href === "/inbox" && totalUnread > 0 && !active;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Taller on mobile so fingers can hit the row reliably (≥44px).
        // `min-h-11` (44px) rather than more padding: padding alone left
        // the row at 40px, and a min-height holds the target even if the
        // label wraps or font metrics shift. Reset at lg so desktop
        // density is unchanged.
        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:min-h-0 lg:py-2",
        // Indent only the content — the row stays full-width, so the
        // touch target is not shrunk by the subordinate treatment.
        item.subordinate && "pl-7",
        active
          ? // Not `text-primary`: on the `bg-primary/10` row that measures
            // 3.81:1 (dark) / 3.95:1 (light), under the 4.5:1 AA floor.
            // `--nav-active-foreground` is the same accent nudged per
            // mode — see globals.css.
            "bg-primary/10 text-[var(--nav-active-foreground)]"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
      {item.beta && (
        <span
          aria-label={t("beta")}
          // Not `text-amber-300`: on this `bg-amber-500/10` tint that
          // measured 1.33:1 in light mode — effectively invisible. Same
          // flat-colour trap the owner role chip hit; `--on-amber-soft`
          // is the per-mode token both now share. See globals.css.
          className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--on-amber-soft)]"
        >
          {t("beta")}
        </span>
      )}
      {showUnreadDot && (
        <span
          aria-label={t("unreadConversations", { count: totalUnread })}
          className="relative flex h-2 w-2 shrink-0"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
    </Link>
  );
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <BrandMark className="h-8 w-8 rounded-lg" />
            <span className="text-sm font-semibold text-foreground">
              {t("title")}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navSections.map((section, index) => (
            <div key={section.labelKey} className={cn(index > 0 && "mt-5")}>
              {/* A real heading, not a styled div, so the group is
                  reachable by landmark/heading navigation. Sized down
                  rather than coloured differently — the accent tokens
                  stay reserved for the active row. */}
              <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(section.labelKey)}
              </h2>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      active={isNavItemActive(pathname, item.href)}
                      t={t}
                      totalUnread={totalUnread}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="my-4 border-t border-border" />

          <ul className="flex flex-col gap-1">
            {footerNavItems.map((item) => (
              <li key={item.href}>
                <NavRow
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  t={t}
                  totalUnread={totalUnread}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
