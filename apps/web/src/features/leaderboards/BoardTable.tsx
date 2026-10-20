'use client';

import type { BoardResponse } from '@mitaoe/shared';
import { Table, type Column } from '@mitaoe/ui';
import { t } from '@/i18n';
import { formatExamTimer, formatScore } from '@/lib/format';
import { boardLines, type Line } from './board-lines';

/**
 * The `Leaderboard` table (LB-05, US-ST-09): test boards show `Score` as `<score> / <max>` and `Time taken` like the
 * exam timer, series boards the summed `Total`. The student's own row reads `<name> (you)` and is highlighted.
 */
export function BoardTable({ board }: { board: BoardResponse }) {
  const lines = boardLines(board);
  const columns: Array<Column<Line>> = [
    { key: 'rank', header: t('leaderboards.colRank'), cell: (l) => l.row.rank },
    {
      key: 'name',
      header: t('leaderboards.colName'),
      cell: (l) => (l.own ? t('leaderboards.you', { name: l.row.name }) : l.row.name),
    },
    { key: 'department', header: t('leaderboards.colDepartment'), cell: (l) => l.row.department },
    ...(board.kind === 'test'
      ? [
          {
            key: 'score',
            header: t('leaderboards.colScore'),
            cell: (l: Line) => t('result.score', { score: formatScore(l.row.score), max: formatScore(board.max ?? 0) }),
          },
          { key: 'time', header: t('leaderboards.colTime'), cell: (l: Line) => formatExamTimer(l.row.timeSec * 1000) },
        ]
      : [{ key: 'total', header: t('leaderboards.colTotal'), cell: (l: Line) => formatScore(l.row.score) }]),
  ];
  return (
    <Table
      caption={t('leaderboards.table')}
      columns={columns}
      rows={lines}
      rowKey={(l) => l.key}
      currentKey={lines.find((l) => l.own)?.key ?? null}
      empty={t('leaderboards.noRows')}
    />
  );
}
