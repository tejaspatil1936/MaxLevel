'use client';

import type { AuditEntry, PlatformOrg } from '@mitaoe/shared';
import { Button, EmptyState, InlineMessage, PageHeader, SelectField, Table, TextField } from '@mitaoe/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { csvLine, downloadText } from '@/lib/files';
import { dayBoundary, formatDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Pager } from '../admin/Pager';

interface Filters {
  orgId: string;
  actor: string;
  action: string;
  target: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { orgId: '', actor: '', action: '', target: '', from: '', to: '' };
type AuditPage = { items: AuditEntry[]; nextCursor: string | null };

const show = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * AUD-02, US-AD-08, US-SA-06: the audit log, filtered by actor, action, target and date (in the org's timezone), with a
 * CSV export of the matching entries. The platform version adds the organization.
 */
export function AuditScreen({
  scope,
  orgId,
  timeZone,
}: {
  scope: 'org' | 'platform';
  orgId?: string;
  timeZone: string;
}) {
  const platform = scope === 'platform';
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const orgs = useQuery({
    queryKey: qk.platformOrgs(),
    queryFn: () => api<{ items: PlatformOrg[] }>('/v1/platform/orgs'),
    enabled: platform,
  });
  const orgName = (id: string) => orgs.data?.items.find((o) => o.id === id)?.name ?? id;
  const zone = (platform && orgs.data?.items.find((o) => o.id === applied.orgId)?.timezone) || timeZone;

  const query = (f: Filters, extra: Record<string, string>) => {
    const s = new URLSearchParams(extra);
    if (platform && f.orgId) s.set('orgId', f.orgId);
    if (f.actor.trim()) s.set('actor', f.actor.trim());
    if (f.action.trim()) s.set('action', f.action.trim());
    if (f.target.trim()) s.set('target', f.target.trim());
    if (f.from) s.set('from', String(dayBoundary(f.from, zone, false)));
    if (f.to) s.set('to', String(dayBoundary(f.to, zone, true)));
    return `${platform ? '/v1/platform/audit' : '/v1/audit'}?${s}`;
  };
  const params = { ...applied, cursor: cursors.at(-1) ?? '' };
  const list = useQuery({
    queryKey: platform ? qk.platformAudit(params) : qk.orgList(orgId ?? '', 'audit', params),
    queryFn: () => api<AuditPage>(query(applied, { limit: '50', ...(params.cursor ? { cursor: params.cursor } : {}) })),
    placeholderData: keepPreviousData,
  });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setCursors([]);
  };
  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setCursors([]);
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AuditEntry[] = [];
      let cursor: string | null = null;
      do {
        const page: AuditPage = await api<AuditPage>(query(applied, { limit: '200', ...(cursor ? { cursor } : {}) }));
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const head = ['time', ...(platform ? ['organization'] : []), 'actor', 'action', 'target', 'before', 'after'];
      const lines = all.map((e) =>
        csvLine([
          new Date(e.createdAt).toISOString(),
          ...(platform ? [orgName(e.orgId)] : []),
          e.actor.email,
          e.action,
          e.target.id,
          show(e.before),
          show(e.after),
        ]),
      );
      downloadText('audit-log.csv', [csvLine(head), ...lines].join('\n') + '\n');
    } finally {
      setExporting(false);
    }
  };

  const items = list.data?.items ?? [];
  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <>
      <PageHeader
        title={t('nav.audit')}
        subtitle={t(platform ? 'audit.platformLead' : 'audit.lead')}
        actions={
          <Button onClick={() => void exportCsv()} disabled={exporting}>
            {t('audit.export')}
          </Button>
        }
      />
      <form onSubmit={apply} className="mb-6 grid gap-4 min-[900px]:grid-cols-3">
        {platform ? (
          <SelectField
            label={t('audit.organization')}
            value={draft.orgId}
            onChange={set('orgId')}
            options={[
              { value: '', label: t('audit.allOrgs') },
              ...(orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        ) : null}
        <TextField label={t('audit.actor')} value={draft.actor} onChange={set('actor')} />
        <TextField label={t('audit.action')} value={draft.action} onChange={set('action')} />
        <TextField label={t('audit.target')} value={draft.target} onChange={set('target')} />
        <TextField label={t('audit.from')} type="date" value={draft.from} onChange={set('from')} />
        <TextField label={t('audit.to')} type="date" value={draft.to} onChange={set('to')} />
        <div className="flex items-end gap-3">
          <Button type="submit">{t('audit.apply')}</Button>
          {/* With no matches the empty state offers the one Clear filters action (UX-08). */}
          {list.isSuccess && items.length === 0 ? null : (
            <Button variant="secondary" onClick={clear}>
              {t('audit.clear')}
            </Button>
          )}
        </div>
      </form>
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {/* The table stays in place; with no matches it holds the empty state (UX-08). */}
      <>
        <Table
          caption={t('nav.audit')}
          busy={list.isPending}
          rows={items}
          rowKey={(e) => e.id}
          empty={
            <EmptyState
              message={t('audit.empty')}
              action={
                <Button variant="secondary" onClick={clear}>
                  {t('audit.clear')}
                </Button>
              }
            />
          }
          columns={[
            { key: 'time', header: t('audit.time'), cell: (e) => formatDateTime(e.createdAt, timeZone) },
            ...(platform
              ? [{ key: 'org', header: t('audit.organization'), cell: (e: AuditEntry) => orgName(e.orgId) }]
              : []),
            { key: 'actor', header: t('audit.actor'), cell: (e) => e.actor.email },
            { key: 'action', header: t('audit.action'), cell: (e) => e.action },
            { key: 'target', header: t('audit.target'), cell: (e) => e.target.id },
            {
              key: 'change',
              header: t('audit.change'),
              cell: (e) => (
                <span className="block max-w-96 break-words font-code text-body-small">
                  {e.before !== undefined ? show(e.before) : ''}
                  {e.before !== undefined && e.after !== undefined ? ' → ' : ''}
                  {e.after !== undefined ? show(e.after) : ''}
                </span>
              ),
            },
          ]}
        />
        <Pager cursors={cursors} nextCursor={list.data?.nextCursor} onChange={setCursors} />
      </>
    </>
  );
}
