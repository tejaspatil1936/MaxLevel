'use client';

import type { Page, Student } from '@mitaoe/shared';
import { Dialog } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useShortcut } from './Shortcuts';
import type { NavLink } from './nav';

interface Option {
  key: string;
  label: string;
  href: string;
}

const ACTIONS: Array<{ label: MessageKey; href: string }> = [
  { label: 'students.add', href: '/admin/students/?open=add' },
  { label: 'departments.add', href: '/admin/departments/?open=add' },
  { label: 'whitelist.upload', href: '/admin/whitelist/?open=upload' },
];

/** Ctrl K / Cmd K: jump to a page, a student or a common action from anywhere in the workspace (UX-06). */
export function CommandPalette({ orgId, links }: { orgId: string; links: NavLink[] }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useShortcut('Ctrl K', 'shortcuts.palette');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery('');
        setActive(0);
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const students = useQuery({
    queryKey: qk.orgList(orgId, 'students', { q, limit: 8, palette: true }),
    queryFn: () => api<Page<Student>>(`/v1/students?limit=8&q=${encodeURIComponent(q)}`),
    enabled: open && q.length > 0,
  });

  const options = useMemo<Option[]>(() => {
    const match = (label: string) => !q || label.toLowerCase().includes(q);
    const pages = links.map((l) => ({ key: l.href, label: t(l.label), href: l.href })).filter((o) => match(o.label));
    const people = q
      ? (students.data?.items ?? []).map((s) => ({
          key: `student-${s.id}`,
          label: `${s.name}, ${s.prn}`,
          href: `/admin/students/?student=${encodeURIComponent(s.id)}`,
        }))
      : [];
    const actions = ACTIONS.map((a) => ({ key: a.href, label: t(a.label), href: a.href })).filter((o) =>
      match(o.label),
    );
    return [...pages, ...people, ...actions];
  }, [links, q, students.data]);

  const current = Math.min(active, Math.max(options.length - 1, 0));
  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    router.push(o.href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} title={t('palette.title')}>
      <input
        role="combobox"
        aria-label={t('palette.input')}
        aria-expanded
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={options[current] ? `${id}-${current}` : undefined}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((current + 1) % Math.max(options.length, 1));
          else if (e.key === 'ArrowUp') setActive((current - 1 + options.length) % Math.max(options.length, 1));
          else if (e.key === 'Enter') choose(options[current]);
          else return;
          e.preventDefault();
        }}
        className="min-h-11 w-full rounded-control border border-rule bg-surface px-3"
      />
      <ul id={`${id}-list`} role="listbox" aria-label={t('palette.results')} className="mt-3 max-h-80 overflow-y-auto">
        {options.map((o, i) => (
          <li
            key={o.key}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === current}
            onClick={() => choose(o)}
            onPointerMove={() => setActive(i)}
            className="flex min-h-11 cursor-pointer items-center rounded-control px-3 aria-selected:bg-ballpoint-wash"
          >
            {o.label}
          </li>
        ))}
      </ul>
      {options.length === 0 ? <p className="mt-3 text-graphite">{t('palette.none')}</p> : null}
    </Dialog>
  );
}
