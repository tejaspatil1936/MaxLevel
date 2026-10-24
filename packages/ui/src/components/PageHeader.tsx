import type { ReactNode } from 'react';
import { cx } from '../cx';

/** Page title with the primary action always in the top-right spot (UX-01). */
export function PageHeader({
  title,
  subtitle,
  actions,
  size = 'normal',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  size?: 'normal' | 'compact';
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0 break-words">
        <h1 className={cx('font-display font-bold', size === 'compact' ? 'text-heading-1' : 'text-display-2')}>
          {title}
        </h1>
        {subtitle ? <p className="mt-2 text-graphite">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
