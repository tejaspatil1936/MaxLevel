'use client';

import type { ExamPayload, StudentQuestion } from '@mitaoe/shared';
import { Button, cx, Dialog } from '@mitaoe/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { t } from '@/i18n';
import { AnswerOptions } from './AnswerOptions';
import { questionState, shortcutFor, type ExamAction, type ExamState } from './exam-state';
import { QuestionPalette, TimingTrack, type PaletteGroup } from './QuestionPalette';
import { QuestionPrompt, QuestionText } from './QuestionView';

/** Unavailable moves stay focusable (aria-disabled), so focus never drops to the page when the last one is reached. */
const DIM = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** A question on the sheet; the preview's carry their answer key. */
export type ExamQuestion = StudentQuestion & { correctOptionIds?: string[]; explanation?: string };

export interface ExamScreenProps {
  exam: Omit<ExamPayload, 'questions'> & { questions: readonly ExamQuestion[] };
  /** The test heading, as the editor shows it. */
  title: string;
  /** The mode's controls in the top bar: the preview's note, Show answers and Exit, or an attempt's timer and Submit. */
  bar: ReactNode;
  state: ExamState;
  dispatch: Dispatch<ExamAction>;
  /** Preview only: show the correct option and the explanation (Q-13). */
  showAnswers?: boolean;
  /** The `T` key: say the time left (A11Y-06); attempts only. */
  onTimeKey?: () => void;
}

const SHORTCUT_KEYS = [
  'exam.shortcut.options',
  'exam.shortcut.next',
  'exam.shortcut.previous',
  'exam.shortcut.mark',
  'exam.shortcut.time',
  'exam.shortcut.help',
] as const;

/** Palette groups: the test's sections in order, then questions in no section; one group for a test without them. */
function paletteGroups(exam: ExamScreenProps['exam']): PaletteGroup[] {
  const indexed = exam.questions.map((q, i) => ({ q, i }));
  const groups: PaletteGroup[] = exam.sections
    .map((section) => ({ section, indexes: indexed.filter((x) => x.q.sectionId === section.id).map((x) => x.i) }))
    .filter((g) => g.indexes.length > 0);
  const listed = new Set(exam.sections.map((s) => s.id));
  const loose = indexed.filter((x) => !x.q.sectionId || !listed.has(x.q.sectionId)).map((x) => x.i);
  return loose.length ? [...groups, { section: null, indexes: loose }] : groups;
}

/** Any open dialog (shortcuts, the submit summary, a strike warning) takes the keys from the sheet behind it. */
const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/**
 * The exam screen (13.7): the top bar, the answer sheet with its timing track, the palette on the right (a drawer
 * below 1,280 px, A11Y-15) and the navigation along the bottom, with the EX-09 keys. The same screen serves the admin
 * preview and the student's attempt.
 */
export function ExamScreen({ exam, title, bar, state, dispatch, showAnswers = false, onTimeKey }: ExamScreenProps) {
  const groups = useMemo(() => paletteGroups(exam), [exam]);
  const total = exam.questions.length;
  const question = exam.questions[state.index]!;
  const section = exam.sections.find((s) => s.id === question.sectionId);
  const stateOf = (i: number) => questionState(state, exam.questions[i]!.id);
  const images = question.images.map((img) => ({ src: exam.imageUrls[img.path] ?? null, alt: img.alt }));
  const heading = t('exam.question', { n: state.index + 1, total });
  const first = state.index === 0;
  const last = state.index === total - 1;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const currentBubble = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    toggleRef.current?.focus();
  }, []);
  const goTo = useCallback(
    (index: number) => {
      dispatch({ type: 'goTo', index });
      // Choosing a question in the drawer closes it (A11Y-15).
      if (drawerOpen) closeDrawer();
    },
    [dispatch, drawerOpen, closeDrawer],
  );

  // The drawer takes focus on its current question when it opens, so the focused control is never covered.
  useEffect(() => {
    if (drawerOpen) currentBubble.current?.focus();
  }, [drawerOpen]);

  const latest = useRef({ index: state.index, total, question, onTimeKey, drawerOpen });
  latest.current = { index: state.index, total, question, onTimeKey, drawerOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dialogOpen()) return;
      const now = latest.current;
      if (e.key === 'Escape' && now.drawerOpen) {
        e.preventDefault();
        closeDrawer();
        return;
      }
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      if (shortcut.type === 'option') {
        const option = now.question.options[shortcut.index];
        if (option) dispatch({ type: 'choose', optionId: option.id });
      } else if (shortcut.type === 'next') {
        if (now.index < now.total - 1) goTo(now.index + 1);
      } else if (shortcut.type === 'previous') {
        if (now.index > 0) goTo(now.index - 1);
      } else if (shortcut.type === 'mark') dispatch({ type: 'toggleMark' });
      else if (shortcut.type === 'time') now.onTimeKey?.();
      else setShortcutsOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch, goTo, closeDrawer]);

  return (
    <div className="flex min-h-dvh flex-col bg-sheet">
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-surface px-6 py-2">
        <h1 className="font-display text-heading-1 font-bold">{title}</h1>
        {bar}
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-admin flex-1 items-start gap-6 px-6 py-6">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex justify-end xl:hidden">
              <Button
                ref={toggleRef}
                variant="secondary"
                aria-expanded={drawerOpen}
                onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
              >
                {t('exam.palette')}
              </Button>
            </div>
            <article className="flex rounded-sheet border border-dropout bg-surface">
              <TimingTrack count={total} current={state.index} stateOf={stateOf} onGoTo={goTo} />
              <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
                {section ? (
                  <div className="flex flex-col gap-1">
                    <p data-testid="current-section" className="font-bold">
                      {section.name}
                    </p>
                    {section.instructions ? (
                      <p className="max-w-measure text-body-small text-graphite">{section.instructions}</p>
                    ) : null}
                  </div>
                ) : null}
                <h2 className="text-heading-2 font-bold">{heading}</h2>
                <p className="sr-only" aria-live="polite">
                  {heading}
                </p>
                <QuestionPrompt prompt={question.prompt} images={images} />
                <AnswerOptions
                  key={question.id}
                  questionId={question.id}
                  options={question.options}
                  chosen={state.answers[question.id]}
                  onChoose={(optionId) => dispatch({ type: 'choose', optionId })}
                  correctOptionIds={showAnswers ? question.correctOptionIds : undefined}
                />
                {showAnswers && question.explanation ? (
                  <section className="flex flex-col gap-2 rounded-control border border-tick bg-tick-wash p-4">
                    <h3 className="text-heading-3 font-bold">{t('exam.explanation')}</h3>
                    <QuestionText text={question.explanation} className="max-w-measure" />
                  </section>
                ) : null}
              </div>
            </article>
          </div>
          <QuestionPalette
            groups={groups}
            current={state.index}
            stateOf={stateOf}
            onGoTo={goTo}
            open={drawerOpen}
            onClose={closeDrawer}
            currentRef={currentBubble}
          />
        </div>
        {/* UX-03: the moves along the bottom, Save and next the largest, at the far right. */}
        <div className="sticky bottom-0 z-10 border-t border-rule bg-surface">
          <div className="mx-auto flex w-full max-w-admin flex-wrap items-center gap-3 px-6 py-3">
            <Button
              variant="secondary"
              className={DIM}
              aria-disabled={first}
              onClick={() => (first ? undefined : goTo(state.index - 1))}
            >
              {t('exam.previous')}
            </Button>
            <Button
              variant="secondary"
              className="aria-pressed:border-ink aria-pressed:bg-highlighter aria-pressed:text-highlighter-ink"
              aria-pressed={!!state.marked[question.id]}
              onClick={() => dispatch({ type: 'toggleMark' })}
            >
              {t('exam.markForReview')}
            </Button>
            <Button variant="secondary" onClick={() => dispatch({ type: 'clear' })}>
              {t('exam.clearAnswer')}
            </Button>
            <Button
              size="lg"
              className={cx('ml-auto min-w-48', DIM)}
              aria-disabled={last}
              onClick={() => (last ? undefined : goTo(state.index + 1))}
            >
              {t('exam.saveAndNext')}
            </Button>
          </div>
        </div>
      </main>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title={t('exam.shortcuts')}>
        <ul className="flex flex-col gap-2">
          {SHORTCUT_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
