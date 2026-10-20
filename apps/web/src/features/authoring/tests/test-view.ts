import { resolveSettings, type Series, type Test } from '@mitaoe/shared';
import { t } from '@/i18n';
import { formatDay, formatWindow } from '@/lib/format';

export const testUrl = (id: string) => `/admin/tests/edit/?id=${encodeURIComponent(id)}`;

/** `Day 2: Aptitude`, or the title alone when the day label is hidden (TST-02). */
export const testHeading = (test: Pick<Test, 'dayLabel' | 'title'>) =>
  test.dayLabel ? t('tests.heading', { label: test.dayLabel, title: test.title }) : test.title;

/** When the test runs: its snapshot window once published, else the window resolved from the series (TST-07). */
export function testWhen(
  series: Pick<Series, 'defaults' | 'dailyWindow'>,
  test: Pick<Test, 'overrides' | 'scheduledDate' | 'resolved'>,
  timeZone: string,
): string {
  const window = test.resolved?.window ?? resolveSettings({ series, test, timezone: timeZone }).window;
  return window ? formatWindow(window, timeZone) : formatDay(test.scheduledDate);
}
