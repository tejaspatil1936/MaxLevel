import { t } from '@/i18n';

/** A test as students see it named: `<day label>: <title>`, or the title when the day label is hidden (TST-02). */
export const testHeading = (test: { dayLabel: string | null; title: string }) =>
  test.dayLabel ? t('studentTests.heading', { day: test.dayLabel, title: test.title }) : test.title;

export const studentTestUrl = (testId: string) => `/student/test/?id=${encodeURIComponent(testId)}`;
