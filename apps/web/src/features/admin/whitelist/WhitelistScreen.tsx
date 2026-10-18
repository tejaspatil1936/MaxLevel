'use client';

import type { WhitelistEntry, WhitelistStatus } from '@mitaoe/shared';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  InlineMessage,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
} from '@mitaoe/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { csvLine, downloadText } from '@/lib/files';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { BulkBar } from '../BulkBar';
import { Pager } from '../Pager';
import { useOpenParam } from '../useOpenParam';
import { UploadWizard } from './UploadWizard';
import { AddEntryDialog, STATUS } from './WhitelistParts';

interface ListPage {
  items: WhitelistEntry[];
  nextCursor: string | null;
  total: number;
}

/** WL-04, WL-05: search, filter and act on the whitelist in bulk. */
export function WhitelistScreen() {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<WhitelistStatus | ''>('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<'upload' | 'add' | 'remove' | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const openUpload = useCallback(() => setModal('upload'), []);
  useOpenParam('upload', openUpload);

  const params = { q: q.trim(), status, cursor: cursors.at(-1) ?? '' };
  const list = useQuery({
    queryKey: qk.orgList(orgId, 'whitelist', params),
    queryFn: () => {
      const s = new URLSearchParams({ limit: '50' });
      if (params.q) s.set('q', params.q);
      if (params.status) s.set('status', params.status);
      if (params.cursor) s.set('cursor', params.cursor);
      return api<ListPage>(`/v1/whitelist?${s}`);
    },
    placeholderData: keepPreviousData,
  });
  const resetPaging = () => {
    setCursors([]);
    setSelected(new Set());
  };
  const refresh = () => qc.invalidateQueries({ queryKey: [orgId] });

  const bulk = useMutation({
    mutationFn: (action: 'disable' | 'enable' | 'remove') =>
      api('/v1/whitelist/bulk', { method: 'POST', body: { action, emails: [...selected] } }),
    onSuccess: () => {
      setSelected(new Set());
      setModal(null);
    },
    onSettled: refresh,
  });

  const items = list.data?.items ?? [];
  const filtered = !!params.q || !!status;
  const toggle = (email: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(email);
      else next.delete(email);
      return next;
    });
  const exportSelected = () => {
    const rows = items.filter((e) => selected.has(e.email));
    const lines = [
      csvLine(['email', 'prn', 'note', 'status']),
      ...rows.map((e) => csvLine([e.email, e.prn, e.note, e.status])),
    ];
    downloadText('whitelist.csv', lines.join('\n') + '\n');
  };

  const uploadButton = (
    <Button onClick={openUpload} disabled={readOnly}>
      {t('whitelist.upload')}
    </Button>
  );
  const total = list.data?.total ?? 0;
  return (
    <div className={selected.size ? 'pb-24' : undefined}>
      <PageHeader
        title={t('nav.whitelist')}
        subtitle={
          <span data-testid="whitelist-count">
            {total === 1 ? t('whitelist.oneEntry') : t('whitelist.entries', { n: formatCount(total) })}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal('add')} disabled={readOnly}>
              {t('whitelist.addEntry')}
            </Button>
            {uploadButton}
          </>
        }
      />
      <p role="status" className="mb-4 font-bold text-tick empty:hidden">
        {added !== null ? t('whitelist.added', { n: formatCount(added) }) : null}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="wl-search" className="font-bold">
            {t('whitelist.search')}
          </label>
          <input
            id="wl-search"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPaging();
            }}
            className="min-h-11 rounded-control border border-graphite bg-surface px-3"
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t('org.status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as WhitelistStatus | '');
              resetPaging();
            }}
            options={[
              { value: '', label: t('filter.all') },
              { value: 'invited', label: t('status.invited') },
              { value: 'registered', label: t('status.registered') },
              { value: 'disabled', label: t('status.disabled') },
            ]}
          />
        </div>
      </div>
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {list.isSuccess && items.length === 0 ? (
        filtered ? (
          <EmptyState
            message={t('whitelist.noMatch')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ('');
                  setStatus('');
                  resetPaging();
                }}
              >
                {t('common.clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState message={t('whitelist.empty')} action={uploadButton} />
        )
      ) : (
        <>
          <Table
            caption={t('nav.whitelist')}
            busy={list.isPending}
            rows={items}
            rowKey={(e) => e.email}
            columns={[
              {
                key: 'select',
                header: '',
                cell: (e) => (
                  <Checkbox
                    label={<span className="sr-only">{t('whitelist.select', { email: e.email })}</span>}
                    checked={selected.has(e.email)}
                    disabled={readOnly}
                    onCheckedChange={(on) => toggle(e.email, on)}
                  />
                ),
              },
              { key: 'email', header: t('field.email'), cell: (e) => e.email },
              { key: 'prn', header: t('profile.prn'), cell: (e) => e.prn ?? '' },
              { key: 'note', header: t('whitelist.note'), cell: (e) => e.note ?? '' },
              {
                key: 'status',
                header: t('org.status'),
                cell: (e) => <StatusPill tone={STATUS[e.status].tone}>{t(STATUS[e.status].label)}</StatusPill>,
              },
            ]}
          />
          <Pager cursors={cursors} nextCursor={list.data?.nextCursor} onChange={setCursors} />
        </>
      )}
      <BulkBar count={selected.size}>
        <Button variant="secondary" onClick={() => bulk.mutate('disable')} disabled={bulk.isPending}>
          {t('whitelist.disable')}
        </Button>
        <Button variant="secondary" onClick={() => bulk.mutate('enable')} disabled={bulk.isPending}>
          {t('whitelist.enable')}
        </Button>
        <Button variant="secondary" onClick={exportSelected}>
          {t('whitelist.export')}
        </Button>
        <Button variant="destructive" onClick={() => setModal('remove')} disabled={bulk.isPending}>
          {t('whitelist.remove')}
        </Button>
      </BulkBar>
      {bulk.isError && modal !== 'remove' ? <InlineMessage>{bulk.error.message}</InlineMessage> : null}

      {modal === 'upload' ? (
        <UploadWizard
          onClose={() => setModal(null)}
          onSaved={(n) => {
            setModal(null);
            setAdded(n);
            void refresh();
          }}
        />
      ) : null}
      {modal === 'add' ? <AddEntryDialog onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal === 'remove' ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setModal(null)}
          title={
            selected.size === 1
              ? t('whitelist.removeOne')
              : t('whitelist.removeMany', { n: formatCount(selected.size) })
          }
          description={t('whitelist.removeBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('whitelist.removeAction')}
          destructive
          confirmDisabled={bulk.isPending}
          onConfirm={() => bulk.mutate('remove')}
        >
          {bulk.isError ? <InlineMessage>{bulk.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
