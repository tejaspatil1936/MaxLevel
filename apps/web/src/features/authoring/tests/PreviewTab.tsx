'use client';

import type { TestDetail } from '@mitaoe/shared';
import { Button, EmptyState, InlineMessage, Skeleton } from '@mitaoe/ui';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { t } from '@/i18n';
import { useQuestions } from '../questions/useQuestions';

/** The exam screen in preview mode for this test (Q-13, US-AD-08). */
export const previewUrl = (testId: string) => `/exam/?preview=${encodeURIComponent(testId)}`;

/**
 * The Preview tab (Q-13): opens the real exam screen with no attempt. A test without approved questions has nothing to
 * draw, so it points to the Questions tab instead. The approval checklist joins this tab with F-2.08.
 */
export function PreviewTab({ test, onGoToQuestions }: { test: TestDetail; onGoToQuestions: () => void }) {
  const questions = useQuestions(test.id);
  if (questions.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!questions.data) return <Skeleton className="h-24 w-full" />;
  if (!questions.data.items.some((q) => q.status === 'approved'))
    return (
      <EmptyState
        message={t('preview.empty')}
        action={
          <Button variant="secondary" onClick={onGoToQuestions}>
            {t('preview.goToQuestions')}
          </Button>
        }
      />
    );
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="max-w-measure text-graphite">{t('preview.intro')}</p>
      <Link
        href={previewUrl(test.id)}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-ballpoint bg-ballpoint px-4 font-bold text-on-ballpoint hover:border-ink hover:bg-ink"
      >
        <Eye aria-hidden size={20} />
        {t('preview.open')}
      </Link>
    </div>
  );
}
