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

interface Shortcut {
  keys: string;
  label: MessageKey;
}

interface ShortcutsApi {
  /** Screens add their own shortcuts to the list while they are shown (the admin shell adds the palette). */
  register: (keys: string, label: MessageKey) => () => void;
  /** A screen's own named list of keys that act only in one part of it (the import review's drafts, IMP-13). */
  registerList: (title: MessageKey, items: readonly Shortcut[]) => () => void;
}
const Ctx = createContext<ShortcutsApi | null>(null);

/** `?` opens the list of keyboard shortcuts on every screen (A11Y-03). */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<Shortcut[]>([]);
  const [lists, setLists] = useState<Array<{ title: MessageKey; items: readonly Shortcut[] }>>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A screen with its own list (the exam, EX-09) handles `?` first and marks the event handled.
      if (e.key !== '?' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || inTextField(e.target)) return;
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
      registerList(title, items) {
        setLists((all) => [...all.filter((l) => l.title !== title), { title, items }]);
        return () => setLists((all) => all.filter((l) => l.title !== title));
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
        {lists.map((l) => (
          <div key={l.title} className="mt-6">
            <p id={`shortcuts-${l.title}`} className="mb-3 font-bold">
              {t(l.title)}
            </p>
            <ul aria-labelledby={`shortcuts-${l.title}`} className="flex flex-col gap-3">
              {l.items.map((s) => (
                <li key={s.keys} className="flex items-center gap-6">
                  <kbd className="min-w-8 rounded-control border border-rule bg-surface-sunken px-2 py-1 text-center font-code">
                    {s.keys}
                  </kbd>{' '}
                  <span>{t(s.label)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useShortcut(keys: string, label: MessageKey): void {
  const ctx = useContext(Ctx);
  useEffect(() => ctx?.register(keys, label), [ctx, keys, label]);
}

/** Lists a screen's own keys under a title in the shortcuts dialog while the screen is shown (pass a stable array). */
export function useShortcutList(title: MessageKey, items: readonly Shortcut[]): void {
  const ctx = useContext(Ctx);
  useEffect(() => ctx?.registerList(title, items), [ctx, title, items]);
}
