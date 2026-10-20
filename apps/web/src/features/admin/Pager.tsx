'use client';

import { Button } from '@mitaoe/ui';
import { t } from '@/i18n';

/** Cursor paging (API-05): the cursors seen so far let the admin step back. */
export function Pager({
  cursors,
  nextCursor,
  onChange,
}: {
  cursors: string[];
  nextCursor: string | null | undefined;
  onChange: (cursors: string[]) => void;
}) {
  if (!cursors.length && !nextCursor) return null;
  return (
    <nav aria-label={t('common.pages')} className="mt-4 flex justify-end gap-3">
      <Button variant="secondary" disabled={!cursors.length} onClick={() => onChange(cursors.slice(0, -1))}>
        {t('common.previous')}
      </Button>
      <Button
        variant="secondary"
        disabled={!nextCursor}
        onClick={() => nextCursor && onChange([...cursors, nextCursor])}
      >
        {t('common.next')}
      </Button>
    </nav>
  );
}
