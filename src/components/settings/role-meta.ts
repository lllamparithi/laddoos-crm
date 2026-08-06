import {
  Crown,
  Shield,
  UserCog,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). Previously duplicated in both files; hoisted here so a label,
 * icon, or colour change lands once.
 *
 * `variant` drives the token-based <SettingsChip>; `className` is the
 * inline Tailwind string the Members tab applies to its own spans.
 */
export const ROLE_META: Record<
  AccountRole,
  { icon: LucideIcon; label: string; variant: ChipVariant; className: string }
> = {
  owner: {
    icon: Crown,
    label: 'owner',
    variant: 'owner',
    // Foreground comes from the per-mode token, not a flat `text-amber-300`:
    // that shade measured 1.33:1 on the light-mode chip. See globals.css.
    className:
      'border-amber-500/40 bg-amber-500/10 text-[var(--role-owner-foreground)]',
  },
  admin: {
    icon: Shield,
    label: 'admin',
    variant: 'admin',
    // `text-primary` on its own primary tint is the same hue-on-hue collapse
    // the sidebar chip and active nav row had — 2.15-3.95:1 across accents.
    className:
      'border-primary/40 bg-primary/10 text-[var(--on-primary-soft)]',
  },
  agent: {
    icon: UserCog,
    label: 'agent',
    variant: 'muted',
    className: 'border-border bg-muted text-muted-foreground',
  },
  viewer: {
    icon: UserIcon,
    label: 'viewer',
    variant: 'muted',
    // Outline-only so it stays quieter than the filled Agent chip in
    // both modes — bg-card would blend into a card surface in light mode.
    className: 'border-border bg-transparent text-muted-foreground',
  },
};
