import { describe, expect, it } from 'vitest';
import { boardLines } from './board-lines';

const row = (rank: number, name = `S ${rank}`) => ({ rank, name, department: 'IT', score: 10 - rank, timeSec: 60 });

describe('boardLines', () => {
  it('LB-05 US-ST-09 marks the own row among the top 50, or appends it after them', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(i + 1));
    const inside = boardLines({ rows, me: row(3) });
    expect(inside).toHaveLength(50);
    expect(inside.filter((l) => l.own).map((l) => l.row.rank)).toEqual([3]);
    const outside = boardLines({ rows, me: row(53) });
    expect(outside).toHaveLength(51);
    expect(outside[50]).toEqual({ key: 'me', row: row(53), own: true });
    expect(outside.filter((l) => l.own)).toHaveLength(1);
  });

  it('LB-05 an admin view (no own row) marks nothing; a tie on rank alone is not the own row', () => {
    expect(boardLines({ rows: [row(1), row(2)], me: null }).some((l) => l.own)).toBe(false);
    const tied = boardLines({ rows: [row(2, 'A'), row(2, 'B')], me: row(2, 'B') });
    expect(tied.map((l) => l.own)).toEqual([false, true]);
  });
});
