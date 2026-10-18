import { DIFFICULTIES, drawProblems, type Difficulty, type DrawProblem, type Section } from '@mitaoe/shared';
import { t, type MessageKey } from '@/i18n';
import type { ApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';

// The Sections tab (Q-03, Q-05, US-AD-07): the section dialog's form state, its checks against the section's pool of
// approved questions, and the table's cell texts. Numbers stay text while typed; empty means "not set".

export interface SectionDraft {
  name: string;
  instructions: string;
  durationMin: string;
  drawCount: string;
  forwardOnly: boolean;
  mix: Record<Difficulty, string>;
  marks: string;
  negativeMarks: string;
}

export type SectionField = 'name' | 'durationMin' | 'drawCount' | Difficulty | 'marks' | 'negativeMarks';
export type SectionErrors = Partial<Record<SectionField, string>>;
/** A section as PATCH /v1/tests/{id} takes it: a new one has no ID yet. */
export type SectionInput = Omit<Section, 'id'> & { id?: string };
/** The section's approved questions, as the pool checks read them. */
export type PoolQuestions = ReadonlyArray<{ id: string; difficulty?: Difficulty }>;

const text = (n: number | undefined) => (n === undefined ? '' : String(n));

export function sectionDraft(s?: Section): SectionDraft {
  return {
    name: s?.name ?? '',
    instructions: s?.instructions ?? '',
    durationMin: text(s?.durationMin),
    drawCount: text(s?.drawCount),
    forwardOnly: s?.forwardOnly ?? false,
    mix: {
      easy: text(s?.difficultyMix?.easy),
      medium: text(s?.difficultyMix?.medium),
      hard: text(s?.difficultyMix?.hard),
    },
    marks: text(s?.marks),
    negativeMarks: text(s?.negativeMarks),
  };
}

const blank = (s: string) => s.trim() === '';
const num = (s: string) => (blank(s) ? undefined : Number(s));
const whole = (s: string, min: number, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max;
};
/** No mix when all three are empty or 0; otherwise an empty count is 0. */
function mixOf(d: SectionDraft): Section['difficultyMix'] {
  const counts = DIFFICULTIES.map((k) => num(d.mix[k]) ?? 0);
  if (counts.every((n) => n === 0)) return undefined;
  const [easy, medium, hard] = counts as [number, number, number];
  return { easy, medium, hard };
}

/** The section to store: `id` and `order` come from the list it is saved into. */
export function sectionFromDraft(d: SectionDraft, place: { id?: string; order: number }): SectionInput {
  const s: SectionInput = {
    ...(place.id ? { id: place.id } : {}),
    name: d.name.trim(),
    order: place.order,
    instructions: blank(d.instructions) ? undefined : d.instructions.trim(),
    durationMin: num(d.durationMin),
    drawCount: num(d.drawCount),
    difficultyMix: mixOf(d),
    forwardOnly: d.forwardOnly,
    marks: num(d.marks),
    negativeMarks: num(d.negativeMarks),
  };
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as SectionInput;
}

const plural = (m: number, one: MessageKey, other: MessageKey, vars: Record<string, string | number>) =>
  t(m === 1 ? one : other, { m: formatCount(m), ...vars });

/** The error text of a pool problem, and the field it belongs to (docs/testids/phase-2.md, "Sections tab"). */
export function problemError(p: DrawProblem): [SectionField, string] {
  if (p.code === 'DRAW_TOO_LARGE')
    return [
      'drawCount',
      plural(p.available, 'sections.drawTooLarge.one', 'sections.drawTooLarge.other', { n: formatCount(p.drawCount) }),
    ];
  if (p.code === 'MIX_UNSATISFIABLE')
    return [
      p.difficulty,
      plural(p.available, 'sections.mixTooLarge.one', 'sections.mixTooLarge.other', {
        difficulty: p.difficulty,
        n: formatCount(p.wanted),
      }),
    ];
  return ['drawCount', t('sections.mixMismatch', { t: formatCount(p.mixTotal) })];
}

/** Field errors of the dialog: format first, then whether the section's pool can satisfy the draw and the mix. */
export function sectionErrors(d: SectionDraft, pool: PoolQuestions): SectionErrors {
  const errors: SectionErrors = {};
  if (blank(d.name)) errors.name = t('sections.nameMissing');
  if (!blank(d.durationMin) && !whole(d.durationMin, 1, 1440)) errors.durationMin = t('setting.minutesError');
  if (!blank(d.drawCount) && !whole(d.drawCount, 1, 1000)) errors.drawCount = t('sections.drawInvalid');
  for (const k of DIFFICULTIES) if (!blank(d.mix[k]) && !whole(d.mix[k], 0, 1000)) errors[k] = t('sections.mixInvalid');
  const marks = num(d.marks);
  if (marks !== undefined && !(marks > 0 && marks <= 1000)) errors.marks = t('questions.marksInvalid');
  const negative = num(d.negativeMarks);
  if (negative !== undefined && !(negative >= 0 && negative <= 1000))
    errors.negativeMarks = t('questions.negativeInvalid');
  if (errors.drawCount || DIFFICULTIES.some((k) => errors[k])) return errors;
  const s = sectionFromDraft(d, { order: 1 });
  const problems = drawProblems({
    sectionId: null,
    questions: pool,
    drawCount: s.drawCount,
    difficultyMix: s.difficultyMix,
  });
  for (const p of problems) {
    const [field, message] = problemError(p);
    errors[field] ??= message;
  }
  return errors;
}

/** The field a refused PATCH names (`drawCount`, `difficultyMix.hard`), with the server's message. */
export function serverFieldError(e: ApiError): SectionErrors | null {
  const field = e.details.field;
  if (field === 'drawCount') return { drawCount: e.message };
  const difficulty = typeof field === 'string' ? field.replace(/^difficultyMix\./, '') : '';
  return (DIFFICULTIES as readonly string[]).includes(difficulty) ? { [difficulty]: e.message } : null;
}

/** The whole-test draw: empty means all; otherwise a whole number no larger than the approved questions. */
export function testDrawError(value: string, approved: number): string | undefined {
  if (blank(value)) return undefined;
  if (!whole(value, 1, 1000)) return t('sections.drawInvalid');
  const n = Number(value);
  if (n > approved)
    return plural(approved, 'sections.testDrawTooLarge.one', 'sections.testDrawTooLarge.other', {
      n: formatCount(n),
    });
  return undefined;
}

/** Table cells: `All` or the number drawn (the mix total when only a mix is set). */
export function drawText(s: Section): string {
  if (s.drawCount !== undefined) return formatCount(s.drawCount);
  const mix = s.difficultyMix;
  const total = mix ? mix.easy + mix.medium + mix.hard : 0;
  return total > 0 ? formatCount(total) : t('sections.drawAll');
}

export function mixText(s: Section): string {
  const mix = s.difficultyMix;
  if (!mix || mix.easy + mix.medium + mix.hard === 0) return t('sections.mixNone');
  return t('sections.mixText', {
    easy: formatCount(mix.easy),
    medium: formatCount(mix.medium),
    hard: formatCount(mix.hard),
  });
}

export function durationText(s: Section): string {
  if (s.durationMin === undefined) return t('sections.testTimer');
  return t(s.durationMin === 1 ? 'tests.minute' : 'tests.minutes', { n: formatCount(s.durationMin) });
}
