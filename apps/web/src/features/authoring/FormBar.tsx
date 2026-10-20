'use client';

import { useCallback, useRef, type FocusEvent, type ReactNode, type RefObject } from 'react';
import { t } from '@/i18n';

/**
 * A11Y-04: the fixed action bar never covers the focused field. Put `onFocus` on the form and `barRef` on the bar;
 * a field that would end up under the bar is scrolled above it.
 */
export function useKeepAboveBar() {
  const barRef = useRef<HTMLElement>(null);
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (barRef.current?.contains(el)) return;
    const barTop = barRef.current?.getBoundingClientRect().top ?? innerHeight;
    const r = el.getBoundingClientRect();
    if (r.bottom > barTop - 8) window.scrollBy({ top: r.bottom - barTop + 16 });
  }, []);
  return { barRef, onFocus };
}

/** The sticky footer `Form actions`: `Unsaved changes` while edited, then Discard and the primary button far right. */
export function FormBar({
  barRef,
  dirty,
  children,
}: {
  barRef: RefObject<HTMLElement | null>;
  dirty: boolean;
  children: ReactNode;
}) {
  return (
    <section
      ref={barRef}
      aria-label={t('common.formActions')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface px-6 py-3 shadow-overlay"
    >
      <div className="mx-auto flex max-w-admin items-center justify-end gap-3">
        <p role="status" className="mr-auto text-graphite">
          {dirty ? t('common.unsaved') : null}
        </p>
        {children}
      </div>
    </section>
  );
}
