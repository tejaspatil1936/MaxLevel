import type { BoardResponse, BoardRow } from '@mitaoe/shared';

export interface Line {
  key: string;
  row: BoardRow;
  own: boolean;
}

/**
 * The rows a board shows (LB-05): every served row, and for a student their own row marked, appended after the top 50
 * when it is not among them. The served rows carry no student ID, so the own row is the first served row equal to `me`.
 */
export function boardLines(board: Pick<BoardResponse, 'rows' | 'me'>): Line[] {
  const { me } = board;
  const same = (r: BoardRow) =>
    !!me &&
    r.rank === me.rank &&
    r.name === me.name &&
    r.department === me.department &&
    r.score === me.score &&
    r.timeSec === me.timeSec;
  const at = board.rows.findIndex(same);
  const lines = board.rows.map((row, i) => ({ key: String(i), row, own: i === at }));
  return me && at < 0 ? [...lines, { key: 'me', row: me, own: true }] : lines;
}
