import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StatusPill } from './Status';
import { Table, type SortState } from './Table';

const meta: Meta = { title: 'Data/Table' };
export default meta;

const rows = [
  { id: 's1', name: 'Aarav Kulkarni', prn: '22010101', status: 'Registered' },
  { id: 's2', name: 'Ishita Deshmukh', prn: '22010102', status: 'Invited' },
  { id: 's3', name: 'Rohan Patil', prn: '22010103', status: 'Disabled' },
];
const columns = [
  { key: 'name', header: 'Name', sortable: true, cell: (r: (typeof rows)[number]) => r.name },
  { key: 'prn', header: 'PRN', sortable: true, align: 'end' as const, cell: (r: (typeof rows)[number]) => r.prn },
  {
    key: 'status',
    header: 'Status',
    cell: (r: (typeof rows)[number]) => (
      <StatusPill tone={r.status === 'Registered' ? 'success' : r.status === 'Disabled' ? 'muted' : 'info'}>
        {r.status}
      </StatusPill>
    ),
  },
];

export const States: StoryObj = {
  render: function Render() {
    const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
    const [selected, setSelected] = useState<string | null>('s2');
    return (
      <div className="grid gap-6">
        <Table
          caption="Students"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          sortLabel={(h) => `Sort by ${h}`}
          onRowClick={(r) => setSelected(r.id)}
          rowLabel={(r) => `Open ${r.name}`}
          selectedKey={selected}
        />
        <Table caption="Students, compact" density="compact" columns={columns} rows={rows} rowKey={(r) => r.id} />
        <Table
          caption="No students"
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          empty="No students match these filters."
        />
      </div>
    );
  },
};
