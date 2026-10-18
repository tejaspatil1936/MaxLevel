'use client';

import { PageHeader } from '@mitaoe/ui';
import { t, type MessageKey } from '@/i18n';

export function SimpleHome({ title, lead }: { title: MessageKey; lead: MessageKey }) {
  return <PageHeader title={t(title)} subtitle={t(lead)} />;
}
