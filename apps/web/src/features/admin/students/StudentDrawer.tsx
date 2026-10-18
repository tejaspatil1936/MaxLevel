'use client';

import type { StudentDetail } from '@mitaoe/shared';
import { Button, ConfirmDialog, Drawer, InlineMessage, Menu, Skeleton, StatusPill, Table, TextField } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { STATUS } from '../whitelist/WhitelistParts';
import { EditForm, HistoryItem } from './StudentParts';

/** STU-10: profile, attempts and change history in a drawer, so the list stays in view (UX-05). */
export function StudentDrawer({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const { orgId } = useWorkspace();
  const detail = useQuery({
    queryKey: qk.orgList(orgId, 'student', { id: studentId }),
    queryFn: () => api<StudentDetail>(`/v1/students/${encodeURIComponent(studentId)}`),
  });
  const name = detail.data?.student.name ?? t('app.loading');
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={name}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {detail.isError ? <InlineMessage>{t('students.notFound')}</InlineMessage> : null}
      {detail.data ? (
        <DrawerBody detail={detail.data} onDeleted={onClose} />
      ) : detail.isPending ? (
        <div aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-4 h-32 w-full" />
        </div>
      ) : null}
    </Drawer>
  );
}

function DrawerBody({ detail, onDeleted }: { detail: StudentDetail; onDeleted: () => void }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const s = detail.student;
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: [orgId] });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/students/${encodeURIComponent(s.id)}`, { method: 'PATCH', body }),
    onSuccess: () => setConfirm(null),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/v1/students/${encodeURIComponent(s.id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirm(null);
      onDeleted();
    },
    onSettled: refresh,
  });
  const timeZone = org?.timezone ?? 'Asia/Kolkata';
  const history = [...detail.history].sort((a, b) => b.createdAt - a.createdAt);
  const hasAttempts = detail.attempts.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="drawer-profile">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 id="drawer-profile" className="text-heading-2 font-bold">
            {t('students.profile')}
          </h3>
          <div className="flex items-center gap-2">
            {editing ? null : (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={readOnly}>
                {t('students.editProfile')}
              </Button>
            )}
            <Menu
              trigger={
                <Button
                  variant="ghost"
                  aria-label={t('common.moreActions')}
                  className="min-w-11 px-2"
                  disabled={readOnly}
                >
                  <MoreHorizontal aria-hidden size={20} />
                </Button>
              }
              items={[
                s.status === 'disabled'
                  ? {
                      label: t('students.enable'),
                      onSelect: () => patch.mutate({ status: s.uid ? 'registered' : 'invited' }),
                    }
                  : { label: t('students.disable'), destructive: true, onSelect: () => setConfirm('disable') },
                { label: t('students.delete'), destructive: true, onSelect: () => setConfirm('delete') },
              ]}
            />
          </div>
        </div>
        {editing ? (
          <EditForm detail={detail} onDone={() => setEditing(false)} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-graphite">{t('field.email')}</dt>
            <dd>{s.email}</dd>
            <dt className="text-graphite">{t('profile.prn')}</dt>
            <dd>{s.prn}</dd>
            <dt className="text-graphite">{t('profile.department')}</dt>
            <dd>{s.departmentName}</dd>
            <dt className="text-graphite">{t('profile.year')}</dt>
            <dd>{s.graduationYear}</dd>
            <dt className="text-graphite">{t('org.status')}</dt>
            <dd>
              <StatusPill tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</StatusPill>
            </dd>
          </dl>
        )}
        {patch.isError && !confirm ? <InlineMessage>{patch.error.message}</InlineMessage> : null}
      </section>

      <section aria-labelledby="drawer-attempts">
        <h3 id="drawer-attempts" className="mb-3 text-heading-2 font-bold">
          {t('students.attempts')}
        </h3>
        {hasAttempts ? (
          <Table
            caption={t('students.attempts')}
            rows={detail.attempts}
            rowKey={(a) => a.id}
            columns={[
              { key: 'test', header: t('students.test'), cell: (a) => a.testTitle },
              {
                key: 'score',
                header: t('students.score'),
                align: 'end',
                cell: (a) =>
                  a.score === null || a.max === null ? '' : `${formatCount(a.score)} / ${formatCount(a.max)}`,
              },
              { key: 'strikes', header: t('students.strikes'), align: 'end', cell: (a) => formatCount(a.strikes) },
              {
                key: 'status',
                header: t('org.status'),
                cell: (a) => a.status.charAt(0).toUpperCase() + a.status.slice(1),
              },
            ]}
          />
        ) : (
          <p className="text-graphite">{t('students.noAttempts')}</p>
        )}
      </section>

      <section aria-labelledby="drawer-history">
        <h3 id="drawer-history" className="mb-3 text-heading-2 font-bold">
          {t('students.history')}
        </h3>
        {history.length ? (
          <ul aria-labelledby="drawer-history" className="flex flex-col gap-3">
            {history.map((e) => (
              <HistoryItem key={e.id} entry={e} timeZone={timeZone} />
            ))}
          </ul>
        ) : (
          <p className="text-graphite">{t('students.noChanges')}</p>
        )}
      </section>

      {confirm === 'disable' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('students.disableConfirm', { name: s.name })}
          description={t('students.disableBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('students.disable')}
          destructive
          confirmDisabled={patch.isPending}
          onConfirm={() => patch.mutate({ status: 'disabled' })}
        >
          {patch.isError ? <InlineMessage>{patch.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
      {confirm === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setConfirm(null);
              setTyped('');
            }
          }}
          title={t('students.deleteConfirm', { name: s.name })}
          description={t(hasAttempts ? 'students.deleteBodyAttempts' : 'students.deleteBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('students.delete')}
          destructive
          confirmDisabled={remove.isPending || (hasAttempts && typed !== s.name)}
          onConfirm={() => remove.mutate()}
        >
          {hasAttempts ? (
            <TextField
              label={t('students.typeName')}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          ) : null}
          {remove.isError ? <InlineMessage>{remove.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
