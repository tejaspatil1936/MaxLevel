'use client';

import type { OrgAdmin, PlatformOrgDetail } from '@mitaoe/shared';
import { Button, ConfirmDialog, InlineMessage, Menu, PageHeader, Skeleton, Table } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { AddAdminDialog, EditOrgDialog } from './OrgDialogs';
import { Entitlements, UsageTable } from './Entitlements';
import { OrgStatus } from './status';
import { OrgStorage } from './OrgStorage';

type StatusAction = 'suspend' | 'archive' | 'restore';
const ACTION_STATUS = { suspend: 'suspended', archive: 'archived', restore: 'active' } as const;
const ACTION_LABEL: Record<StatusAction, MessageKey> = {
  suspend: 'org.suspend',
  archive: 'org.archive',
  restore: 'org.restore',
};
const ACTION_CONFIRM: Record<StatusAction, MessageKey> = {
  suspend: 'org.suspendConfirm',
  archive: 'org.archiveConfirm',
  restore: 'org.restoreConfirm',
};
const ACTION_BODY: Record<StatusAction, MessageKey> = {
  suspend: 'org.suspendBody',
  archive: 'org.archiveBody',
  restore: 'org.restoreBody',
};

export function OrgDetail() {
  const orgId = useSearchParams().get('id') ?? '';
  const org = useQuery({
    queryKey: qk.platformOrg(orgId),
    queryFn: () => api<PlatformOrgDetail>(`/v1/platform/orgs/${encodeURIComponent(orgId)}`),
    enabled: !!orgId,
  });
  if (org.isError) return <InlineMessage>{t('org.notFound')}</InlineMessage>;
  if (!org.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  return <OrgDetailView org={org.data} />;
}

function OrgDetailView({ org }: { org: PlatformOrgDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<StatusAction | null>(null);
  const [removing, setRemoving] = useState<OrgAdmin | null>(null);
  const archived = org.status === 'archived';

  const put = (o: PlatformOrgDetail) => {
    qc.setQueryData(qk.platformOrg(org.id), o);
    void qc.invalidateQueries({ queryKey: qk.platformOrgs(), exact: true });
  };
  const changeStatus = useMutation({
    mutationFn: (a: StatusAction) =>
      api<PlatformOrgDetail>(`/v1/platform/orgs/${encodeURIComponent(org.id)}`, {
        method: 'PATCH',
        body: { status: ACTION_STATUS[a] },
      }),
    onSuccess: (o) => {
      put(o);
      setConfirm(null);
    },
  });
  const removeAdmin = useMutation({
    mutationFn: (a: OrgAdmin) =>
      api(`/v1/platform/orgs/${encodeURIComponent(org.id)}/admins/${encodeURIComponent(a.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: qk.platformOrg(org.id) });
    },
  });

  const actions: StatusAction[] =
    org.status === 'active'
      ? ['suspend', 'archive']
      : org.status === 'suspended'
        ? ['archive', 'restore']
        : ['restore'];
  const admins = org.admins.filter((a) => a.status === 'active');

  return (
    <>
      {org.logoUrl ? (
        // A data URL from the API, shown as a labelled image (the static export has no image optimizer).
        <span
          role="img"
          aria-label={t('org.logoAlt', { name: org.name })}
          className="mb-4 block h-12 w-24 bg-contain bg-left bg-no-repeat"
          style={{ backgroundImage: `url(${JSON.stringify(org.logoUrl)})` }}
        />
      ) : null}
      <PageHeader
        title={org.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span data-testid="org-status">
              <OrgStatus status={org.status} />
            </span>
            <span>{org.slug}</span>
            <span>{org.timezone}</span>
          </span>
        }
        actions={
          <>
            <Menu
              trigger={
                <Button variant="secondary" aria-label={t('common.moreActions')} className="min-w-11 px-2">
                  <MoreHorizontal aria-hidden size={20} />
                </Button>
              }
              items={actions.map((a) => ({
                label: t(ACTION_LABEL[a]),
                destructive: a !== 'restore',
                onSelect: () => setConfirm(a),
              }))}
            />
            <Button onClick={() => setEditing(true)} disabled={archived}>
              {t('org.edit')}
            </Button>
          </>
        }
      />

      <section aria-labelledby="admins" className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="admins" className="text-heading-1 font-bold">
            {t('org.adminsTitle')}
          </h2>
          <Button variant="secondary" onClick={() => setAdding(true)} disabled={archived}>
            {t('org.addAdmin')}
          </Button>
        </div>
        <Table
          caption={t('org.adminsTitle')}
          rows={admins}
          rowKey={(a) => a.id}
          empty={t('org.noAdmins')}
          columns={[
            { key: 'email', header: t('field.email'), cell: (a) => a.email },
            { key: 'name', header: t('field.name'), cell: (a) => a.name ?? '' },
            {
              key: 'status',
              header: t('org.status'),
              cell: (a) => t(a.signedIn ? 'admin.signedIn' : 'admin.invited'),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('common.actions')}</span>,
              align: 'end',
              cell: (a) => (
                <Menu
                  trigger={
                    <Button
                      variant="ghost"
                      aria-label={t('common.actionsFor', { name: a.email })}
                      className="min-w-11 px-2"
                      disabled={archived}
                    >
                      <MoreHorizontal aria-hidden size={20} />
                    </Button>
                  }
                  items={[{ label: t('org.removeAdmin'), destructive: true, onSelect: () => setRemoving(a) }]}
                />
              ),
            },
          ]}
        />
      </section>

      <Entitlements org={org} onSaved={put} readOnly={archived} />

      <section aria-labelledby="usage" className="mt-10">
        <h2 id="usage" className="mb-3 text-heading-1 font-bold">
          {t('org.usageTitle')}
        </h2>
        <UsageTable org={org} />
      </section>

      <OrgStorage orgId={org.id} orgName={org.name} readOnly={archived} />

      {editing ? <EditOrgDialog org={org} onClose={() => setEditing(false)} onSaved={put} /> : null}
      {adding ? <AddAdminDialog org={org} onClose={() => setAdding(false)} /> : null}
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t(ACTION_CONFIRM[confirm], { name: org.name })}
          description={t(ACTION_BODY[confirm])}
          cancelLabel={t('common.cancel')}
          confirmLabel={t(ACTION_LABEL[confirm])}
          destructive={confirm !== 'restore'}
          confirmDisabled={changeStatus.isPending}
          onConfirm={() => changeStatus.mutate(confirm)}
        >
          {changeStatus.isError ? <InlineMessage>{changeStatus.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t('org.removeAdminConfirm', { email: removing.email })}
          description={t('org.removeAdminBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('org.removeAdmin')}
          destructive
          confirmDisabled={removeAdmin.isPending}
          onConfirm={() => removeAdmin.mutate(removing)}
        />
      ) : null}
    </>
  );
}
