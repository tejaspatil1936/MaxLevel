'use client';

import type { ClearStorageResponse, OrgStorageFile, OrgStorageSummary, StorageCategory } from '@mitaoe/shared';
import { Button, ConfirmDialog, EmptyState, InlineMessage, Skeleton, StatusPill, Table } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, HardDrive, Image as ImageIcon, Layers, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatBytes, formatCount, formatDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';

type CategoryKey = 'imports' | 'exports' | 'reports' | 'questions' | 'logos' | 'other';

const CATEGORY_NAMES: Record<CategoryKey, MessageKey> = {
  imports: 'org.storageCategoryImports',
  exports: 'org.storageCategoryExports',
  reports: 'org.storageCategoryReports',
  questions: 'org.storageCategoryQuestions',
  logos: 'org.storageCategoryLogos',
  other: 'org.storageCategoryOther',
};

const CATEGORY_ICONS: Record<CategoryKey, typeof HardDrive> = {
  imports: Layers,
  exports: FileSpreadsheet,
  reports: FileText,
  questions: ImageIcon,
  logos: ImageIcon,
  other: HardDrive,
};

const CATEGORY_TONES: Record<CategoryKey, 'info' | 'success' | 'neutral' | 'muted'> = {
  imports: 'info',
  exports: 'success',
  reports: 'neutral',
  questions: 'muted',
  logos: 'muted',
  other: 'muted',
};

function getCategoryName(cat: string): MessageKey {
  return cat in CATEGORY_NAMES ? CATEGORY_NAMES[cat as CategoryKey] : 'org.storageCategoryOther';
}

export function OrgStorage({
  orgId,
  orgName,
  readOnly = false,
}: {
  orgId: string;
  orgName: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [confirmCategory, setConfirmCategory] = useState<StorageCategory | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const storageQuery = useQuery({
    queryKey: qk.platformOrgStorage(orgId),
    queryFn: () => api<OrgStorageSummary>(`/v1/platform/orgs/${encodeURIComponent(orgId)}/storage`),
    enabled: !!orgId,
  });

  const clearMutation = useMutation({
    mutationFn: (category: StorageCategory) =>
      api<ClearStorageResponse>(`/v1/platform/orgs/${encodeURIComponent(orgId)}/storage/clear`, {
        method: 'POST',
        body: { category },
      }),
    onSuccess: (res) => {
      setConfirmCategory(null);
      setResultMessage(
        t('org.storageCleaned', {
          count: formatCount(res.deletedCount),
          bytes: formatBytes(res.deletedBytes),
        }),
      );
      void qc.invalidateQueries({ queryKey: qk.platformOrgStorage(orgId) });
      void qc.invalidateQueries({ queryKey: qk.platformOrg(orgId) });
      void qc.invalidateQueries({ queryKey: qk.platformOrgs(), exact: true });
    },
  });

  if (storageQuery.isLoading) {
    return (
      <section aria-labelledby="storage-heading" className="mt-10">
        <h2 id="storage-heading" className="mb-3 text-heading-1 font-bold">
          {t('org.storageTitle')}
        </h2>
        <div role="status" aria-busy="true" aria-label={t('app.loading')} className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </section>
    );
  }

  if (storageQuery.isError || !storageQuery.data) {
    return (
      <section aria-labelledby="storage-heading" className="mt-10">
        <h2 id="storage-heading" className="mb-3 text-heading-1 font-bold">
          {t('org.storageTitle')}
        </h2>
        <InlineMessage tone="danger">{storageQuery.error?.message ?? t('org.notFound')}</InlineMessage>
      </section>
    );
  }

  const data = storageQuery.data;
  const categories = data.categories ?? {};
  const hasJunkFiles = (data.totalFiles ?? 0) > (categories.logos?.count ?? 0);

  return (
    <section aria-labelledby="storage-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="storage-heading" className="text-heading-1 font-bold">
            {t('org.storageTitle')}
          </h2>
          <p className="mt-1 max-w-2xl text-body-small text-graphite">{t('org.storageSubtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => void storageQuery.refetch()}
            disabled={storageQuery.isFetching}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={16} className={storageQuery.isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmCategory('all')}
            disabled={readOnly || !hasJunkFiles || clearMutation.isPending}
            className="flex items-center gap-2"
          >
            <Trash2 size={16} />
            {t('org.storageClearAll')}
          </Button>
        </div>
      </div>

      {resultMessage ? (
        <div className="mb-4">
          <InlineMessage tone="success">{resultMessage}</InlineMessage>
        </div>
      ) : null}

      {clearMutation.isError ? (
        <div className="mb-4">
          <InlineMessage tone="danger">{clearMutation.error.message}</InlineMessage>
        </div>
      ) : null}

      {/* Storage Breakdown Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-body-small font-medium text-graphite">{t('org.storageTotal')}</span>
            <HardDrive size={20} className="text-ballpoint" />
          </div>
          <div className="mt-3">
            <div className="text-heading-1 font-bold text-ink">{formatBytes(data.totalBytes)}</div>
            <div className="text-body-small text-graphite">
              {formatCount(data.totalFiles)} {t('org.storageFiles').toLowerCase()}
            </div>
          </div>
        </div>

        {(['imports', 'exports', 'reports', 'questions'] as const).map((cat) => {
          const stats = categories[cat] ?? { count: 0, bytes: 0 };
          const Icon = CATEGORY_ICONS[cat];
          const label = t(CATEGORY_NAMES[cat]);
          const canClear = stats.count > 0 && !readOnly;

          return (
            <div
              key={cat}
              className="flex flex-col justify-between rounded-panel border border-rule bg-surface p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-body-small font-medium text-graphite">{label}</span>
                <Icon size={18} className="text-graphite" />
              </div>
              <div className="mt-3">
                <div className="text-heading-2 font-bold text-ink">{formatBytes(stats.bytes)}</div>
                <div className="flex items-center justify-between pt-1 text-body-small text-graphite">
                  <span>
                    {formatCount(stats.count)} {t('org.storageFiles').toLowerCase()}
                  </span>
                  {canClear ? (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmCategory(cat)}
                      disabled={clearMutation.isPending}
                      className="h-7 px-2 text-redpen hover:bg-redpen-wash"
                    >
                      <Trash2 size={13} className="mr-1" />
                      {t('org.storageClearCategory', { category: '' }).trim()}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stored Files Table */}
      <div className="rounded-panel border border-rule bg-surface">
        <Table<OrgStorageFile>
          caption={t('org.storageFiles')}
          rows={data.recentFiles}
          rowKey={(f) => f.path}
          empty={
            <EmptyState
              message={t('org.storageEmpty')}
              action={
                <Button variant="secondary" onClick={() => void storageQuery.refetch()}>
                  {t('common.refresh')}
                </Button>
              }
            />
          }
          columns={[
            {
              key: 'name',
              header: t('org.storageFile'),
              cell: (f) => (
                <div className="flex flex-col">
                  <span className="font-mono text-body-small font-medium text-ink">{f.name}</span>
                  <span className="font-mono text-[11px] text-graphite">{f.path}</span>
                </div>
              ),
            },
            {
              key: 'category',
              header: t('org.storageCategory'),
              cell: (f) => (
                <StatusPill tone={f.category in CATEGORY_TONES ? CATEGORY_TONES[f.category as CategoryKey] : 'muted'}>
                  {t(getCategoryName(f.category))}
                </StatusPill>
              ),
            },
            {
              key: 'size',
              header: t('org.storageSize'),
              align: 'end',
              cell: (f) => <span className="font-mono text-body-small">{formatBytes(f.size)}</span>,
            },
            {
              key: 'updated',
              header: t('org.storageUpdated'),
              align: 'end',
              cell: (f) => (
                <span className="text-body-small text-graphite">
                  {f.updated ? formatDateTime(new Date(f.updated).getTime()) : '—'}
                </span>
              ),
            },
          ]}
        />
      </div>

      {confirmCategory ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirmCategory(null)}
          title={
            confirmCategory === 'all'
              ? t('org.storageClearAllConfirm', { name: orgName })
              : t('org.storageClearCategoryConfirm', {
                  category: t(getCategoryName(confirmCategory)),
                  name: orgName,
                })
          }
          description={confirmCategory === 'all' ? t('org.storageClearAllBody') : t('org.storageClearCategoryBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={
            clearMutation.isPending
              ? t('org.storagePurging')
              : confirmCategory === 'all'
                ? t('org.storageClearAll')
                : t('org.storageClearCategory', {
                    category: t(getCategoryName(confirmCategory)),
                  })
          }
          destructive
          confirmDisabled={clearMutation.isPending}
          onConfirm={() => clearMutation.mutate(confirmCategory)}
        >
          {clearMutation.isError ? <InlineMessage tone="danger">{clearMutation.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
