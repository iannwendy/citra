import { Shield, GraduationCap, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export type Role = 'user' | 'teacher' | 'admin';

interface RoleStyle {
  bg: string;
  Icon: LucideIcon;
  key: string;
  label: string;
}

const ROLE_STYLES: Record<Role, RoleStyle> = {
  user: {
    bg: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    Icon: User,
    key: 'roleBadge.user',
    label: 'Student',
  },
  teacher: {
    bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    Icon: GraduationCap,
    key: 'roleBadge.teacher',
    label: 'Teacher',
  },
  admin: {
    bg: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800',
    Icon: Shield,
    key: 'roleBadge.admin',
    label: 'Admin',
  },
};

export interface RoleBadgeProps {
  role: Role | string;
}

/**
 * RoleBadge — color/icon-coded role indicator built on shadcn/ui Badge.
 */
export function RoleBadge({ role }: RoleBadgeProps) {
  const { t } = useTranslation();
  const style = ROLE_STYLES[role as Role] ?? ROLE_STYLES.user;
  const { Icon, key, label, bg } = style;
  return (
    <Badge variant="outline" className={`gap-1 px-2.5 py-0.5 ${bg}`}>
      <Icon className="h-3 w-3" />
      {t(key, label)}
    </Badge>
  );
}
