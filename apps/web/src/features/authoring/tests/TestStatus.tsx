import type { TestStatus as Status } from '@mitaoe/shared';
import { StatusPill, type Tone } from '@mitaoe/ui';
import { t } from '@/i18n';

const TONE: Record<Status, Tone> = {
  draft: 'neutral',
  in_review: 'info',
  approved: 'success',
  scheduled: 'info',
  live: 'success',
  closed: 'muted',
};

/** Test status in words with an icon (UI-02); live and closed come from the server clock (TST-04). */
export function TestStatus({ status }: { status: Status }) {
  return <StatusPill tone={TONE[status]}>{t(`tests.status.${status}`)}</StatusPill>;
}
