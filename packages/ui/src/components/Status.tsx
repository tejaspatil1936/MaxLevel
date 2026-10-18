import { AlertCircle, CheckCircle2, Circle, Info, MinusCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx';

export type Tone = 'neutral' | 'info' | 'success' | 'danger' | 'muted';

const TONES: Record<Tone, { cls: string; Icon: typeof Info }> = {
  neutral: { cls: 'border-rule text-ink bg-surface', Icon: Circle },
  info: { cls: 'border-ballpoint text-ballpoint bg-ballpoint-wash', Icon: Info },
  success: { cls: 'border-tick text-tick bg-tick-wash', Icon: CheckCircle2 },
  danger: { cls: 'border-redpen text-redpen bg-redpen-wash', Icon: AlertCircle },
  muted: { cls: 'border-rule text-graphite bg-surface-sunken', Icon: MinusCircle },
};

/** A status in words with an icon, never colour alone (UI-02). */
export function StatusPill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const { cls, Icon } = TONES[tone];
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-body-small font-bold', cls)}
    >
      <Icon aria-hidden size={14} />
      {children}
    </span>
  );
}

/** Inline message next to the action that caused it (UX-09). Errors use role="alert". */
export function InlineMessage({
  tone = 'danger',
  children,
  id,
}: {
  tone?: 'danger' | 'info' | 'success';
  children?: ReactNode;
  id?: string;
}) {
  const { cls, Icon } = TONES[tone];
  return (
    <div
      id={id}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(children ? 'flex items-start gap-2 rounded-control border p-3' : '', children ? cls : '')}
    >
      {children ? (
        <>
          <Icon aria-hidden size={18} className="mt-1 shrink-0" />
          <span>{children}</span>
        </>
      ) : null}
    </div>
  );
}

/** One plain sentence and one action, no illustrations (UX-08). */
export function EmptyState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-start gap-4 rounded-panel border border-rule bg-surface p-6"
    >
      <p className="max-w-measure">{message}</p>
      {action}
    </div>
  );
}

/** Loading placeholder shaped like the content (UX-07). Static, so reduced motion has nothing to stop. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('rounded-control bg-surface-sunken', className)} />;
}
