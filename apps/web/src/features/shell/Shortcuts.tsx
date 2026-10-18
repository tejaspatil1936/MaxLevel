'use client';

import { Button, Dialog } from '@mitaoe/ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { t, type MessageKey } from '@/i18n';

/** Typing in a field never triggers a shortcut. */
export function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

interface ShortcutsApi {
  /** Screens add their own shortcuts to the list while they are shown (the admin shell adds the palette). */
  register: (keys: string, label: MessageKey) => () => void;
}
const Ctx = createContext<ShortcutsApi | null>(null);

/** `?` opens the list of keyboard shortcuts on every screen (A11Y-03). */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<Array<{ keys: string; label: MessageKey }>>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || inTextField(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = useMemo<ShortcutsApi>(
    () => ({
      register(keys, label) {
        setExtra((list) => [...list, { keys, label }]);
        return () => setExtra((list) => list.filter((s) => s.keys !== keys));
      },
    }),
    [],
  );

  const list = [...extra, { keys: '?', label: 'shortcuts.show' as MessageKey }];
  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('shortcuts.title')}
        footer={<Button onClick={() => setOpen(false)}>{t('common.close')}</Button>}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
          {list.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded-control border border-rule bg-surface-sunken px-2 py-1 font-code">{s.keys}</kbd>
              </dt>
              <dd>{t(s.label)}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useShortcut(keys: string, label: MessageKey): void {
  const ctx = useContext(Ctx);
  useEffect(() => ctx?.register(keys, label), [ctx, keys, label]);
}
