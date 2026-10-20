'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';

/** Shown while rows are selected, fixed to the bottom of the viewport (UX-03). */
export function BulkBar({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('common.bulkActions')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface px-6 py-3 shadow-overlay"
    >
      <div className="mx-auto flex max-w-admin flex-wrap items-center justify-end gap-3">
        <p className="mr-auto font-bold">{t('common.selected', { n: formatCount(count) })}</p>
        {children}
      </div>
    </div>
  );
}
