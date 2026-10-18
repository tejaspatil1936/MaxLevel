'use client';

import type { Page, Student, WhitelistStatus } from '@mitaoe/shared';
import {
  Button,
  Checkbox,
  EmptyState,
  InlineMessage,
  Menu,
  PageHeader,
  RadioGroup,
  StatusPill,
  Table,
  type Column,
  type SortState,
} from '@mitaoe/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { csvLine, downloadText } from '@/lib/files';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { BulkBar } from '../BulkBar';
import { Pager } from '../Pager';
import { useOpenParam } from '../useOpenParam';
import { STATUS } from '../whitelist/WhitelistParts';
import { AddStudentDialog, useDepartments } from './AddStudentDialog';
import { StudentDrawer } from './StudentDrawer';
import { StudentFilters } from './StudentFilters';

type OptionalColumn = 'email' | 'prn' | 'department' | 'graduationYear' | 'status';
const OPTIONAL: Array<{ key: OptionalColumn; label: MessageKey }> = [
  { key: 'email', label: 'field.email' },
  { key: 'prn', label: 'profile.prn' },
  { key: 'department', label: 'profile.department' },
  { key: 'graduationYear', label: 'profile.year' },
  { key: 'status', label: 'org.status' },
];

export function StudentsScreen() {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const openId = params.get('student');
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<WhitelistStatus | ''>('');
  const [sort, setSort] = useState<SortState>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [shown, setShown] = useState<Set<OptionalColumn>>(new Set(OPTIONAL.map((c) => c.key)));
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const openAdd = useCallback(() => setAdding(true), []);
  useOpenParam('add', openAdd);

  const departments = useDepartments(orgId);
  const filter = { q: q.trim(), departmentId, year, status, sort, cursor: cursors.at(-1) ?? '' };
  const list = useQuery({
    queryKey: qk.orgList(orgId, 'students', filter),
    queryFn: () => {
      const s = new URLSearchParams({ limit: '50' });
      if (filter.q) s.set('q', filter.q);
      if (departmentId) s.set('departmentId', departmentId);
      if (year) s.set('graduationYear', year);
      if (status) s.set('status', status);
      if (sort) {
        s.set('sort', sort.key);
        s.set('dir', sort.dir);
      }
      if (filter.cursor) s.set('cursor', filter.cursor);
      return api<Page<Student>>(`/v1/students?${s}`);
    },
    placeholderData: keepPreviousData,
  });
  const resetPaging = () => {
    setCursors([]);
    setSelected(new Set());
  };
  const openStudent = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('student', id);
    else next.delete('student');
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  const bulk = useMutation({
    mutationFn: (action: 'disable' | 'enable') =>
      api('/v1/whitelist/bulk', {
        method: 'POST',
        body: { action, emails: items.filter((s) => selected.has(s.id)).map((s) => s.email) },
      }),
    onSuccess: () => setSelected(new Set()),
    onSettled: () => qc.invalidateQueries({ queryKey: [orgId] }),
  });

  const items = list.data?.items ?? [];
  const filtered = !!filter.q || !!departmentId || !!year || !!status;
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const clear = () => {
    setQ('');
    setDepartmentId('');
    setYear('');
    setStatus('');
    resetPaging();
  };
  const exportSelected = () => {
    const rows = items.filter((s) => selected.has(s.id));
    downloadText(
      'students.csv',
      [
        csvLine(['name', 'email', 'prn', 'department', 'graduationYear', 'status']),
        ...rows.map((s) => csvLine([s.name, s.email, s.prn, s.departmentName, s.graduationYear, s.status])),
      ].join('\n') + '\n',
    );
  };

  const columns: Array<Column<Student>> = [
    {
      key: 'select',
      header: '',
      cell: (s) => (
        // The checkbox is its own control; a click on it never opens the drawer.
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            label={<span className="sr-only">{t('students.select', { name: s.name })}</span>}
            checked={selected.has(s.id)}
            onCheckedChange={(on) => toggle(s.id, on)}
          />
        </div>
      ),
    },
    { key: 'name', header: t('field.name'), sortable: true, cell: (s) => s.name },
  ];
  // The name button is the first cell's control: keep it first after the checkbox for keyboard users.
  const optional: Record<OptionalColumn, Column<Student>> = {
    email: { key: 'email', header: t('field.email'), sortable: true, cell: (s) => s.email },
    prn: { key: 'prn', header: t('profile.prn'), sortable: true, cell: (s) => s.prn },
    department: { key: 'department', header: t('profile.department'), sortable: true, cell: (s) => s.departmentName },
    graduationYear: {
      key: 'graduationYear',
      header: t('profile.year'),
      sortable: true,
      cell: (s) => String(s.graduationYear),
    },
    status: {
      key: 'status',
      header: t('org.status'),
      sortable: true,
      cell: (s) => <StatusPill tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</StatusPill>,
    },
  };
  for (const c of OPTIONAL) if (shown.has(c.key)) columns.push(optional[c.key]);

  const addButton = (
    <Button onClick={openAdd} disabled={readOnly}>
      {t('students.add')}
    </Button>
  );
  const depts = departments.data?.items ?? [];
  return (
    <div className={selected.size ? 'pb-24' : undefined}>
      <PageHeader title={t('nav.students')} subtitle={t('students.lead')} actions={addButton} />
      <StudentFilters
        value={{ q, departmentId, year, status }}
        departments={depts}
        onChange={(patch) => {
          if (patch.q !== undefined) setQ(patch.q);
          if (patch.departmentId !== undefined) setDepartmentId(patch.departmentId);
          if (patch.year !== undefined) setYear(patch.year);
          if (patch.status !== undefined) setStatus(patch.status);
          resetPaging();
        }}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <RadioGroup<'comfortable' | 'compact'>
          label={t('students.density')}
          value={density}
          onValueChange={setDensity}
          options={[
            { value: 'comfortable', label: t('students.comfortable') },
            { value: 'compact', label: t('students.compact') },
          ]}
        />
        <Menu
          trigger={
            <Button variant="secondary" className="gap-2">
              <Columns3 aria-hidden size={18} />
              <span>{t('students.columns')}</span>
            </Button>
          }
          items={OPTIONAL.map((c) => ({
            label: t(c.label),
            checked: shown.has(c.key),
            onSelect: () =>
              setShown((cur) => {
                const next = new Set(cur);
                if (next.has(c.key)) next.delete(c.key);
                else next.add(c.key);
                return next;
              }),
          }))}
        />
      </div>
      {list.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {list.isSuccess && items.length === 0 ? (
        filtered ? (
          <EmptyState
            message={t('students.noMatch')}
            action={
              <Button variant="secondary" onClick={clear}>
                {t('common.clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState message={t('students.empty')} action={addButton} />
        )
      ) : (
        <>
          <Table
            caption={t('nav.students')}
            busy={list.isPending}
            rows={items}
            rowKey={(s) => s.id}
            columns={columns}
            sort={sort}
            onSortChange={(s) => {
              setSort(s);
              resetPaging();
            }}
            density={density}
            selectedKey={openId}
            onRowClick={(s) => openStudent(s.id)}
            nameColumn="name"
          />
          <Pager cursors={cursors} nextCursor={list.data?.nextCursor} onChange={setCursors} />
        </>
      )}
      <BulkBar count={selected.size}>
        <Button variant="secondary" onClick={() => bulk.mutate('disable')} disabled={readOnly || bulk.isPending}>
          {t('whitelist.disable')}
        </Button>
        <Button variant="secondary" onClick={() => bulk.mutate('enable')} disabled={readOnly || bulk.isPending}>
          {t('whitelist.enable')}
        </Button>
        <Button variant="secondary" onClick={exportSelected}>
          {t('whitelist.export')}
        </Button>
      </BulkBar>
      {openId ? <StudentDrawer studentId={openId} onClose={() => openStudent(null)} /> : null}
      {adding ? <AddStudentDialog departments={depts} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
