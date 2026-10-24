import type { AssistantActionProposal } from '@mitaoe/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionProposalCard } from './ActionProposalCard';

function renderWithClient(ui: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActionProposalCard', () => {
  const sampleProposal: AssistantActionProposal = {
    id: 'prop-1',
    actionType: 'create_series',
    title: 'Create Test Series: Spring 2026 Campus Drive',
    summary: 'Create a new test series with flexible test schedules for Spring 2026.',
    diffs: [
      { field: 'title', label: 'Series Title', value: 'Spring 2026 Campus Drive' },
      { field: 'department', label: 'Eligible Departments', value: 'CS, IT' },
      { field: 'batch', label: 'Eligible Batches', value: '2026' },
      { field: 'cgpaMin', label: 'Minimum CGPA', value: '7.5' },
    ],
    requiresConfirmation: true,
    seriesData: {
      title: 'Spring 2026 Campus Drive',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
      defaults: {},
      eligibility: {
        departmentIds: ['cs', 'it'],
        graduationYears: [2026],
        include: [],
        exclude: [],
      },
    },
  };

  it('renders title, summary, parameter diffs and action badge', () => {
    const html = renderWithClient(<ActionProposalCard proposal={sampleProposal} />);
    expect(html).toContain('Spring 2026 Campus Drive');
    expect(html).toContain('Create a new test series with flexible test schedules');
    expect(html).toContain('Eligible Departments');
    expect(html).toContain('CS, IT');
    expect(html).toContain('Minimum CGPA');
    expect(html).toContain('7.5');
    expect(html).toContain('Proposed Action — Requires Approval');
  });

  it('renders human-in-the-loop question authoring warning', () => {
    const html = renderWithClient(<ActionProposalCard proposal={sampleProposal} />);
    expect(html).toContain('Assessment questions must be uploaded, previewed, and approved manually');
  });

  it('renders confirm and dismiss action buttons', () => {
    const html = renderWithClient(<ActionProposalCard proposal={sampleProposal} />);
    expect(html).toContain('Confirm &amp; Apply');
    expect(html).toContain('Dismiss');
  });
});
