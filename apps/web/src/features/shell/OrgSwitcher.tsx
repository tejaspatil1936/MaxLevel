'use client';

import type { PlatformOrg } from '@mitaoe/shared';
import { Button, Menu } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { chooseWorkspace } from '@/lib/workspace';

/** Super admins move between the platform console and any organization's workspace (ORG-09). */
export function OrgSwitcher({
  current,
  onChange,
}: {
  current: string | null;
  onChange: (orgId: string | null) => void;
}) {
  const router = useRouter();
  const orgs = useQuery({
    queryKey: qk.platformOrgs(),
    queryFn: () => api<{ items: PlatformOrg[] }>('/v1/platform/orgs'),
  });
  const go = (orgId: string | null) => {
    chooseWorkspace(orgId);
    onChange(orgId);
    router.push(orgId ? '/admin/' : '/platform/');
  };
  return (
    <Menu
      align="start"
      trigger={
        <Button variant="secondary" className="w-full justify-start gap-2 px-2 text-left">
          <ArrowLeftRight aria-hidden size={20} className="shrink-0" />
          <span className="flex min-w-0 flex-col max-[1199px]:sr-only">
            <span className="text-body-small text-graphite">{t('switcher.label')}</span>
            <span className="truncate">{current ?? t('switcher.platform')}</span>
          </span>
        </Button>
      }
      items={[
        { label: t('switcher.platform'), onSelect: () => go(null) },
        ...(orgs.data?.items ?? []).map((o) => ({ label: o.name, onSelect: () => go(o.id) })),
      ]}
    />
  );
}
