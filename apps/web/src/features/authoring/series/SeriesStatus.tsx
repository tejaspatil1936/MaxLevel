import type { SeriesStatus as Status } from '@mitaoe/shared';
import { StatusPill, type Tone } from '@mitaoe/ui';
import { t } from '@/i18n';

const TONE: Record<Status, Tone> = { draft: 'neutral', active: 'success', archived: 'muted' };

/** Series status in words with an icon (UI-02): Draft, Active or Archived. */
export function SeriesStatus({ status }: { status: Status }) {
  return <StatusPill tone={TONE[status]}>{t(`series.status.${status}`)}</StatusPill>;
}
