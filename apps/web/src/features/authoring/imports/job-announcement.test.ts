import type { ImportJobView } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { nextAnnouncement, type Announced } from './job-announcement';

type JobState = Pick<ImportJobView, 'status' | 'progress' | 'error'>;
const job = (status: JobState['status'], pagesDone: number, questionsFound = pagesDone * 2, pagesTotal = 12) => ({
  status,
  progress: { pagesDone, pagesTotal, questionsFound },
});

/** Feeds the polled views in order; returns what the region said. */
function said(views: JobState[]): string[] {
  let last: Announced | null = null;
  const out: string[] = [];
  for (const v of views) {
    const next = nextAnnouncement(last, v);
    last = next.last;
    if (next.text) out.push(next.text);
  }
  return out;
}

describe('import review announcements', () => {
  it('IMP-04 A11Y-12 the first view says nothing; a status change is said at once', () => {
    expect(said([job('running', 3)])).toEqual([]);
    expect(said([job('queued', 0), job('running', 0), job('running', 1)])).toEqual(['Import status: Processing']);
    expect(said([job('running', 11), job('ready', 12, 20)])).toEqual([
      'Import status: Ready for review. Questions found: 20',
    ]);
    const failed = {
      ...job('failed', 4),
      error: { code: 'X', message: "The AI service didn't answer.", retryable: true },
    };
    expect(said([job('retrying', 4), failed])).toEqual(["Import status: Failed. The AI service didn't answer."]);
  });

  it('IMP-04 A11Y-12 progress is said at most every 5 pages, and when the last page is done', () => {
    const views = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12].map((p) => job('running', p));
    expect(said(views)).toEqual([
      'Pages processed: 5 of 12. Questions found: 10',
      'Pages processed: 10 of 12. Questions found: 20',
      'Pages processed: 12 of 12. Questions found: 24',
    ]);
    // A view polled again with nothing new says nothing again.
    expect(said([job('running', 0), job('running', 5), job('running', 5)])).toHaveLength(1);
  });
});
