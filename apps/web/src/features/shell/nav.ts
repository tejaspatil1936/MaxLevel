import type { FeatureFlag } from '@mitaoe/shared';
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  ListChecks,
  Network,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@/i18n';

export interface NavLink {
  label: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Shown but marked as not included when the org's plan turns this feature off (FF-03). */
  feature?: FeatureFlag;
}

export const ADMIN_NAV: NavLink[] = [
  { label: 'nav.overview', href: '/admin/', icon: LayoutDashboard },
  { label: 'nav.whitelist', href: '/admin/whitelist/', icon: ListChecks },
  { label: 'nav.students', href: '/admin/students/', icon: Users },
  { label: 'nav.departments', href: '/admin/departments/', icon: Network },
  { label: 'nav.reports', href: '/admin/reports/', icon: BarChart3, feature: 'analytics_reports' },
  { label: 'nav.audit', href: '/admin/audit/', icon: ScrollText },
  { label: 'nav.settings', href: '/admin/settings/', icon: Settings },
];

export const PLATFORM_NAV: NavLink[] = [
  { label: 'nav.organizations', href: '/platform/', icon: Building2 },
  { label: 'nav.audit', href: '/platform/audit/', icon: ScrollText },
];
