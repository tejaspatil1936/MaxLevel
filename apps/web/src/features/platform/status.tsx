import type { PlatformOrg } from '@mitaoe/shared';
import { StatusPill, type Tone } from '@mitaoe/ui';
import { t, type MessageKey } from '@/i18n';

const ORG_STATUS: Record<PlatformOrg['status'], { label: MessageKey; tone: Tone }> = {
  active: { label: 'status.active', tone: 'success' },
  suspended: { label: 'status.suspended', tone: 'danger' },
  archived: { label: 'status.archived', tone: 'muted' },
};

export function OrgStatus({ status }: { status: PlatformOrg['status'] }) {
  const s = ORG_STATUS[status];
  return <StatusPill tone={s.tone}>{t(s.label)}</StatusPill>;
}
