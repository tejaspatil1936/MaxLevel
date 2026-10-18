import { testDrawPools, type Clock, type DrawPool } from '@mitaoe/shared';
import type { Data } from '../data';
import type { QuestionRecord } from '../data/questions';
import type { TestRecord } from '../data/tests';
import type { QuestionImageStore } from './question-images';
import { TtlCache } from './ttl-cache';

/** What every start, resume and grading of a published test needs of its questions, read once per version. */
export interface PublishedQuestions {
  /** In authoring order, with the answer key (server-side only; never sent to students). */
  byId: ReadonlyMap<string, QuestionRecord>;
  pools: DrawPool[];
  /** Each question's option IDs in authoring order, for the draw. */
  options: Record<string, string[]>;
  /** Data URLs of every image path the questions name. */
  imageUrls: Record<string, string>;
}

/** Old versions simply expire; a published test's set changes only by a new questionSetVersion. */
const TTL_MS = 30 * 60_000;

/**
 * PERF-01: an in-memory cache of a test's questions, pools and image URLs, keyed by organization, test ID and
 * `questionSetVersion`. It is safe because the set is locked once attempts start (TST-06) and every question change
 * bumps the version, so a changed set is read again on the next start. Settings come from the test record's `resolved`
 * snapshot, which every start reads anyway (its release keys may still change in place).
 */
export function publishedTestCache(data: Data, images: QuestionImageStore, clock: Clock) {
  const cache = new TtlCache<PublishedQuestions>(clock, TTL_MS);

  async function load(orgId: string, test: TestRecord): Promise<PublishedQuestions> {
    const questions = await data.questions.listQuestions(orgId, test.id);
    const paths = questions.flatMap((q) => [
      ...q.images.map((i) => i.path),
      ...q.options.flatMap((o) => (o.image ? [o.image.path] : [])),
    ]);
    return {
      byId: new Map(questions.map((q) => [q.id, q])),
      pools: testDrawPools(test, questions),
      options: Object.fromEntries(questions.map((q) => [q.id, q.options.map((o) => o.id)])),
      imageUrls: await images.dataUrls(paths),
    };
  }

  return {
    questions(orgId: string, test: TestRecord): Promise<PublishedQuestions> {
      return cache.get(`${orgId}/${test.id}@${test.questionSetVersion}`, () => load(orgId, test));
    },
    clear(): void {
      cache.clear();
    },
  };
}
export type PublishedTestCache = ReturnType<typeof publishedTestCache>;
