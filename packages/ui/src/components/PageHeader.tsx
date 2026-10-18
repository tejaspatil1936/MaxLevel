import type { ReactNode } from 'react';

/** Page title with the primary action always in the top-right spot (UX-01). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0 break-words">
        <h1 className="font-display text-display-2 font-bold">{title}</h1>
        {subtitle ? <p className="mt-2 text-graphite">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
