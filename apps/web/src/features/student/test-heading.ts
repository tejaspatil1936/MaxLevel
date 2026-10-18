import type { StudentTestPage } from '@mitaoe/shared';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';

/** A test as students see it named: `<day label>: <title>`, or the title when the day label is hidden (TST-02). */
export const testHeading = (test: { dayLabel: string | null; title: string }) =>
  test.dayLabel ? t('studentTests.heading', { day: test.dayLabel, title: test.title }) : test.title;

export const studentTestUrl = (testId: string) => `/student/test/?id=${encodeURIComponent(testId)}`;

/** `Sections: Quant (3 questions), Verbal (2 questions)`, or `Sections: none`, as the test page and rules show it. */
export const sectionsLine = (sections: StudentTestPage['sections']) =>
  sections.length === 0
    ? t('studentTest.sectionsNone')
    : t('studentTest.sections', {
        list: sections
          .map((s) =>
            s.questionCount === 1
              ? t('studentTest.sectionOne', { name: s.name })
              : t('studentTest.section', { name: s.name, n: formatCount(s.questionCount) }),
          )
          .join(', '),
      });
