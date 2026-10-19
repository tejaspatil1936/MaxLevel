'use client';

import type { ImportDraft } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';
import { draftArticleId } from './DraftArticle';

/**
 * A pending draft's `Approve`, `Edit` and `Discard` (IMP-12). A flagged draft's `Approve` stays focusable but disabled,
 * described by why (IMP-10).
 */
export function DraftActions({
  draft,
  readOnly,
  onApprove,
  onEdit,
  onDiscard,
}: {
  draft: ImportDraft;
  readOnly: boolean;
  onApprove: () => void;
  onEdit?: () => void;
  onDiscard: () => void;
}) {
  if (draft.status !== 'pending') return null;
  const n = formatCount(draft.order);
  const flagged = draft.flags.length > 0;
  const hintId = `${draftArticleId(draft.id)}-approve-hint`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <Button
          aria-disabled={flagged || readOnly || undefined}
          aria-describedby={flagged ? hintId : undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          onClick={() => !readOnly && onApprove()}
        >
          {t('imports.approve', { n })}
        </Button>
        {onEdit ? (
          <Button variant="secondary" disabled={readOnly} onClick={onEdit}>
            {t('imports.edit', { n })}
          </Button>
        ) : null}
        <Button variant="danger" disabled={readOnly} onClick={onDiscard}>
          {t('imports.discard', { n })}
        </Button>
      </div>
      {flagged ? (
        <p id={hintId} className="text-body-small text-graphite">
          {t('imports.fixFirst')}
        </p>
      ) : null}
    </div>
  );
}
