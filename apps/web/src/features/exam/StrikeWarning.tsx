'use client';

import type { ProctorEventType } from '@mitaoe/shared';
import { AcknowledgeDialog } from '@mitaoe/ui';
import { t, type MessageKey } from '@/i18n';
import type { StrikeWarning as Warning } from './proctor-events';

/** The reason of each strike type (docs/testids/phase-3.md); logged-only types never open a warning. */
const REASONS: Partial<Record<ProctorEventType, MessageKey>> = {
  fullscreen_exit: 'strike.reason.fullscreen_exit',
  tab_hidden: 'strike.reason.tab_hidden',
  window_blur: 'strike.reason.window_blur',
  no_face: 'strike.reason.no_face',
  multiple_faces: 'strike.reason.multiple_faces',
  devtools: 'strike.reason.devtools',
  phone_disconnected: 'strike.reason.phone_disconnected',
  phone_in_view: 'strike.reason.phone_in_view',
  dual_monitor: 'strike.reason.dual_monitor',
  virtual_camera: 'strike.reason.virtual_camera',
  automated_input: 'strike.reason.automated_input',
};

/**
 * The strike warning (PR-09, US-ST-06): `Strike <n> of <max>` with the reason and the strikes left. It shows at once
 * and must be acknowledged; Escape does not close it. A warning for leaving fullscreen offers `Return to fullscreen`.
 */
export function StrikeWarning({
  warning,
  max,
  onAcknowledge,
}: {
  warning: Warning | null;
  max: number;
  onAcknowledge: (type: ProctorEventType) => void;
}) {
  const left = Math.max(0, max - (warning?.count ?? 0));
  return (
    <AcknowledgeDialog
      open={!!warning}
      title={warning ? t('strike.title', { n: warning.count, max }) : ''}
      actionLabel={warning?.type === 'fullscreen_exit' ? t('strike.returnFullscreen') : t('strike.ok')}
      onAction={() => warning && onAcknowledge(warning.type)}
    >
      {warning && REASONS[warning.type] ? <p>{t(REASONS[warning.type]!)}</p> : null}
      <p className="text-graphite">{left === 1 ? t('strike.leftOne') : t('strike.left', { n: left })}</p>
    </AcknowledgeDialog>
  );
}
