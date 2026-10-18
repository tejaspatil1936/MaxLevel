'use client';

import type { Department } from '@mitaoe/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  InlineMessage,
  Menu,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  TextField,
} from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { useOpenParam } from './useOpenParam';

type Modal = { kind: 'add' } | { kind: 'rename' | 'merge' | 'delete'; dept: Department } | null;

/** ORG-10, STU-06, STU-07: departments are records with stable IDs; rename, merge, archive and delete. */
export function DepartmentsScreen() {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const key = qk.orgList(orgId, 'departments');
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Department[] }>('/v1/departments') });
  const [modal, setModal] = useState<Modal>(null);
  const openAdd = useCallback(() => setModal({ kind: 'add' }), []);
  useOpenParam('add', openAdd);
  const refresh = () => qc.invalidateQueries({ queryKey: [orgId] });
  const setStatus = useMutation({
    mutationFn: (p: { dept: Department; status: Department['status'] }) =>
      api(`/v1/departments/${encodeURIComponent(p.dept.id)}`, { method: 'PATCH', body: { status: p.status } }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (d: Department) => api(`/v1/departments/${encodeURIComponent(d.id)}`, { method: 'DELETE' }),
    onSuccess: () => setModal(null),
    onSettled: refresh,
  });

  const items = list.data?.items ?? [];
  const addButton = (
    <Button onClick={openAdd} disabled={readOnly}>
      {t('departments.add')}
    </Button>
  );
  return (
    <>
      <PageHeader title={t('nav.departments')} subtitle={t('departments.lead')} actions={addButton} />
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {setStatus.isError ? <InlineMessage>{setStatus.error.message}</InlineMessage> : null}
      {list.isSuccess && items.length === 0 ? (
        <EmptyState message={t('departments.empty')} action={addButton} />
      ) : (
        <Table
          caption={t('nav.departments')}
          busy={list.isPending}
          rows={items}
          rowKey={(d) => d.id}
          columns={[
            { key: 'name', header: t('field.name'), cell: (d) => d.name },
            { key: 'students', header: t('nav.students'), align: 'end', cell: (d) => formatCount(d.studentCount) },
            {
              key: 'status',
              header: t('org.status'),
              cell: (d) =>
                d.status === 'active' ? (
                  <StatusPill tone="success">{t('status.active')}</StatusPill>
                ) : (
                  <StatusPill tone="muted">{t('status.archived')}</StatusPill>
                ),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('common.actions')}</span>,
              align: 'end',
              cell: (d) => (
                <Menu
                  trigger={
                    <Button
                      variant="ghost"
                      aria-label={t('common.actionsFor', { name: d.name })}
                      className="min-w-11 px-2"
                      disabled={readOnly}
                    >
                      <MoreHorizontal aria-hidden size={20} />
                    </Button>
                  }
                  items={[
                    { label: t('departments.rename'), onSelect: () => setModal({ kind: 'rename', dept: d }) },
                    {
                      label: t('departments.merge'),
                      disabled: d.status !== 'active',
                      onSelect: () => setModal({ kind: 'merge', dept: d }),
                    },
                    d.status === 'active'
                      ? {
                          label: t('departments.archive'),
                          onSelect: () => setStatus.mutate({ dept: d, status: 'archived' }),
                        }
                      : {
                          label: t('departments.restore'),
                          onSelect: () => setStatus.mutate({ dept: d, status: 'active' }),
                        },
                    {
                      label: t('departments.delete'),
                      destructive: true,
                      disabled: d.studentCount > 0,
                      hint: d.studentCount > 0 ? t('departments.inUse', { n: d.studentCount }) : undefined,
                      onSelect: () => setModal({ kind: 'delete', dept: d }),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      {modal?.kind === 'add' || modal?.kind === 'rename' ? (
        <NameDialog
          dept={modal.kind === 'rename' ? modal.dept : null}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      ) : null}
      {modal?.kind === 'merge' ? (
        <MergeDialog
          dept={modal.dept}
          others={items.filter((d) => d.status === 'active' && d.id !== modal.dept.id)}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      ) : null}
      {modal?.kind === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setModal(null)}
          title={t('departments.deleteConfirm', { name: modal.dept.name })}
          description={t('departments.deleteBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('departments.deleteAction')}
          destructive
          confirmDisabled={remove.isPending}
          onConfirm={() => remove.mutate(modal.dept)}
        >
          {remove.isError ? <InlineMessage>{remove.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function NameDialog({ dept, onClose, onDone }: { dept: Department | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(dept?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      dept
        ? api(`/v1/departments/${encodeURIComponent(dept.id)}`, { method: 'PATCH', body: { name: name.trim() } })
        : api('/v1/departments', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) =>
      setError(e instanceof ApiError && e.code === 'DEPARTMENT_EXISTS' ? t('departments.exists') : e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('departments.nameMissing'));
    setError(null);
    save.mutate();
  };
  const title = dept ? t('departments.renameTitle', { name: dept.name }) : t('departments.add');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('field.name')}
          requiredText={t('common.requiredMark')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {dept ? t('common.save') : t('departments.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MergeDialog({
  dept,
  others,
  onClose,
  onDone,
}: {
  dept: Department;
  others: Department[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [intoId, setIntoId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const merge = useMutation({
    mutationFn: () => api(`/v1/departments/${encodeURIComponent(dept.id)}/merge`, { method: 'POST', body: { intoId } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!intoId) return setError(t('departments.mergeMissing'));
    setError(null);
    merge.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('departments.mergeTitle', { name: dept.name })}
      description={t('departments.mergeBody', { n: dept.studentCount })}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('departments.mergeInto')}
          requiredText={t('common.requiredMark')}
          value={intoId}
          onChange={(e) => setIntoId(e.target.value)}
          placeholder={t('profile.choose')}
          options={others.map((d) => ({ value: d.id, label: d.name }))}
          error={error}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={merge.isPending}>
            {t('departments.mergeAction')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
