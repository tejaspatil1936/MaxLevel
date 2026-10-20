import { describe, expect, it } from 'vitest';
import { historyScoreState, studentHistory, studentHistorySchema, type HistoryInput } from './history';
import { SYSTEM_DEFAULTS, type Settings } from './settings';

const settings = (s: Partial<Settings> = {}): Settings => ({
  ...SYSTEM_DEFAULTS,
  window: { start: 1_000, end: 2_000 },
  resultRelease: 'immediate',
  showPastScores: true,
  ...s,
});
type SeriesIn = HistoryInput['series'][number];
const test = (id: string, scheduledDate: string, s: Partial<Settings> = {}, extra = {}): SeriesIn['tests'][number] => ({
  id,
  title: `Test ${id}`,
  scheduledDate,
  settings: settings(s),
  ...extra,
});
const attempt = (id: string, testId: string, status: HistoryInput['attempts'][number]['status'] = 'submitted') => ({
  id,
  testId,
  status,
  score: 3,
  max: 4,
});

describe('history score state', () => {
  it('RES-04 shown when released with Show past scores on, hidden with it off, else the release state', () => {
    expect(historyScoreState(settings(), {})).toBe('shown');
    expect(historyScoreState(settings({ showPastScores: false }), {})).toBe('hidden');
    expect(historyScoreState(settings({ resultRelease: 'manual' }), {})).toBe('pending');
    expect(historyScoreState(settings({ resultRelease: 'manual' }), { resultsReleasedAt: 5 })).toBe('shown');
    expect(historyScoreState(settings({ resultRelease: 'after_close' }), { resultsReleasedAt: null })).toBe('pending');
    expect(
      historyScoreState(settings({ resultRelease: 'manual' }), { resultsReleasedAt: 5, resultsWithdrawn: true }),
    ).toBe('withdrawn');
    expect(historyScoreState(settings({ resultRelease: 'never', showPastScores: true }), {})).toBe('never');
    expect(historyScoreState(null, {})).toBe('pending');
  });
});

describe('student history', () => {
  const placement: SeriesIn = {
    id: 'placement',
    title: 'Placement 2026',
    startDate: '2026-10-02',
    tests: [
      test('verbal', '2026-11-02', { showPastScores: false }),
      test('quant', '2026-11-01'),
      test('logic', '2026-11-02', { resultRelease: 'manual' }),
      test('untaken', '2026-11-03'),
    ],
  };
  const internship: SeriesIn = {
    id: 'internship',
    title: 'Internship drive 2026',
    startDate: '2026-11-01',
    tests: [
      test('coding', '2026-11-02', { resultRelease: 'never' }, { dayHidden: true }),
      test('comms', '2026-11-02', { resultRelease: 'manual' }, { resultsReleasedAt: 1, resultsWithdrawn: true }),
    ],
  };
  const empty: SeriesIn = { id: 'empty', title: 'Empty', startDate: '2026-12-01', tests: [test('e1', '2026-12-01')] };

  it('US-ST-08 RES-04 lists finished attempts by series (newest start first) in scheduled order, scores only when shown', () => {
    const history = studentHistory({
      series: [placement, internship, empty],
      attempts: [
        attempt('a-logic', 'logic', 'auto_submitted'),
        attempt('a-quant', 'quant'),
        attempt('a-verbal', 'verbal'),
        attempt('a-coding', 'coding', 'terminated'),
        attempt('a-comms', 'comms'),
        attempt('a-e1', 'e1', 'in_progress'),
      ],
    });
    expect(history.series.map((s) => s.id)).toEqual(['internship', 'placement']);
    const rows = history.series.flatMap((s) => s.tests);
    expect(rows.map((r) => [r.attemptId, r.dayLabel, r.status, r.scoreState])).toEqual([
      ['a-coding', null, 'terminated', 'never'],
      ['a-comms', 'Day 2', 'submitted', 'withdrawn'],
      ['a-quant', 'Day 1', 'submitted', 'shown'],
      ['a-verbal', 'Day 2', 'submitted', 'hidden'],
      ['a-logic', 'Day 3', 'auto_submitted', 'pending'],
    ]);
    expect(rows[2]).toMatchObject({
      testId: 'quant',
      title: 'Test quant',
      scheduledDate: '2026-11-01',
      score: 3,
      max: 4,
    });
    for (const r of rows.filter((x) => x.scoreState !== 'shown')) {
      expect('score' in r, r.attemptId).toBe(false);
      expect('max' in r, r.attemptId).toBe(false);
    }
    expect(studentHistorySchema.parse(history)).toEqual(history);
  });

  it('US-ST-08 leaves out in-progress and reset attempts, and is empty without a finished one', () => {
    const history = studentHistory({
      series: [placement],
      attempts: [attempt('a1', 'quant', 'in_progress'), attempt('a2', 'verbal', 'reset')],
    });
    expect(history).toEqual({ series: [] });
  });

  it('RES-04 a shown state without a stored result says pending, and the schema refuses a score that is not shown', () => {
    const history = studentHistory({
      series: [placement],
      attempts: [{ id: 'a1', testId: 'quant', status: 'submitted', score: null, max: null }],
    });
    expect(history.series[0]!.tests[0]).toMatchObject({ scoreState: 'pending' });
    const leaked = {
      series: [{ id: 's', title: 'S', tests: [{ ...history.series[0]!.tests[0]!, score: 1, max: 4 }] }],
    };
    expect(studentHistorySchema.safeParse(leaked).success).toBe(false);
  });
});
