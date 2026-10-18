import {
  questionCreateSchema,
  questionImageSavedSchema,
  questionImageUploadSchema,
  questionImportedSchema,
  questionImportSchema,
  questionListSchema,
  questionOrderSchema,
  questionPatchSchema,
  questionProblems,
  questionSavedSchema,
  type QuestionCreate,
  type QuestionImage,
  type QuestionProblem,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { QuestionRecord, QuestionUpdate } from '../data/questions';
import type { TestRecord } from '../data/tests';
import { AppError, notFound } from '../errors';
import { questionImagePrefix } from '../services/question-images';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const questionParams = idParams.extend({ questionId: z.string().min(1).max(128) });

type Checked = Pick<QuestionRecord, 'prompt' | 'options' | 'correctOptionIds' | 'images'>;
const statusOf = (problems: QuestionProblem[]) => (problems.length ? ('draft' as const) : ('approved' as const));
/** The test's other questions in order, with the checked question's own slot blank so duplicates keep their numbers. */
const othersOf = (list: QuestionRecord[], selfId?: string) => list.map((q) => (q.id === selfId ? { prompt: '' } : q));
/** Empty option rows are dropped, and so is a correct answer that pointed at one. */
function withoutEmptyOptions<T extends Partial<Pick<QuestionCreate, 'options' | 'correctOptionIds'>>>(q: T): T {
  if (!q.options) return q;
  const options = q.options.filter((o) => o.text.trim() !== '');
  const ids = new Set(options.map((o) => o.id));
  return {
    ...q,
    options,
    ...(q.correctOptionIds ? { correctOptionIds: q.correctOptionIds.filter((id) => ids.has(id)) } : {}),
  };
}

/** Questions of a test: list, write, edit, delete, reorder, JSON import and images (Q-01, DECISIONS Q17, TST-04). */
export function questionRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, questionImages } = ctx;
  const db = ctx.firebase.db;
  const testOf = async (orgId: string, testId: string) => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test) throw notFound('Test');
    return test;
  };
  const questionOf = async (orgId: string, testId: string, questionId: string) => {
    const q = await data.questions.getQuestion(orgId, testId, questionId);
    if (!q) throw notFound('Question');
    return q;
  };
  /**
   * A question may name only images uploaded to its own test, so a path can never show another organization's file,
   * and only a section of its own test.
   */
  const refuseForeignRefs = (
    orgId: string,
    test: TestRecord,
    q: { images?: QuestionImage[]; sectionId?: string | null; options?: Array<{ image?: QuestionImage }> },
  ) => {
    const prefix = questionImagePrefix(orgId, test.id);
    const paths = [...(q.images ?? []), ...(q.options ?? []).flatMap((o) => (o.image ? [o.image] : []))];
    if (paths.some((img) => !img.path.startsWith(prefix) || img.path.includes('..')))
      throw new AppError(400, 'VALIDATION', 'Add images through the question editor.', { field: 'images' });
    if (q.sectionId && !test.sections.some((s) => s.id === q.sectionId))
      throw new AppError(400, 'VALIDATION', 'Choose a section of this test.', { field: 'sectionId' });
  };
  /** A draft shows why it is a draft, checked against the test as it is now. */
  const view = (q: QuestionRecord, list: QuestionRecord[]) => ({
    ...q,
    problems: q.status === 'draft' ? questionProblems(q, othersOf(list, q.id)) : [],
  });
  /** The first question moves a draft test to review (TST-04); every change bumps the question set version. */
  const changed = (orgId: string, batch: FirebaseFirestore.WriteBatch, test: TestRecord, added: boolean) =>
    data.tests.questionsChanged(
      orgId,
      batch,
      test.id,
      clock.now(),
      added && test.status === 'draft' ? 'in_review' : undefined,
    );

  return async (app) => {
    app.get(
      '/v1/tests/:id/questions',
      { config: admin, schema: { params: idParams, response: { 200: questionListSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const list = await data.questions.listQuestions(orgId, test.id);
        const paths = list.flatMap((q) => [...q.images, ...q.options.flatMap((o) => (o.image ? [o.image] : []))]);
        return {
          items: list.map((q) => view(q, list)),
          imageUrls: await questionImages.dataUrls(paths.map((i) => i.path)),
        };
      },
    );

    app.post(
      '/v1/tests/:id/questions',
      {
        config: admin,
        schema: { params: idParams, body: questionCreateSchema, response: { 201: questionSavedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const input = withoutEmptyOptions(req.body);
        refuseForeignRefs(orgId, test, input);
        const list = await data.questions.listQuestions(orgId, test.id);
        const status = statusOf(questionProblems(input, othersOf(list)));
        const order = (list.at(-1)?.order ?? 0) + 1;
        const batch = db.batch();
        const id = data.questions.createQuestion(
          orgId,
          batch,
          test.id,
          { ...input, order, source: { kind: 'manual' }, status },
          clock.now(),
        );
        changed(orgId, batch, test, true);
        audit(req, batch, { action: 'question.create', target: { type: 'question', id }, after: { ...input, status } });
        await batch.commit();
        return reply.status(201).send({ id, status });
      },
    );

    app.patch(
      '/v1/tests/:id/questions/:questionId',
      {
        config: admin,
        schema: { params: questionParams, body: questionPatchSchema, response: { 200: questionSavedSchema } },
      },
      async (req) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const before = await questionOf(orgId, test.id, req.params.questionId);
        const patch = withoutEmptyOptions(req.body);
        refuseForeignRefs(orgId, test, patch);
        const merged: Checked = {
          prompt: patch.prompt ?? before.prompt,
          options: patch.options ?? before.options,
          correctOptionIds: patch.correctOptionIds ?? before.correctOptionIds,
          images: patch.images ?? before.images,
        };
        // New options without a new answer keep only the answers that still name an option.
        if (patch.options && !patch.correctOptionIds)
          merged.correctOptionIds = merged.correctOptionIds.filter((id) => merged.options.some((o) => o.id === id));
        const list = await data.questions.listQuestions(orgId, test.id);
        const status = statusOf(questionProblems(merged, othersOf(list, before.id)));
        const changes: QuestionUpdate = {
          ...patch,
          correctOptionIds: merged.correctOptionIds,
          status,
          updatedAt: clock.now(),
        };
        const keys = Object.keys(req.body) as Array<keyof QuestionRecord>;
        const batch = db.batch();
        data.questions.updateQuestion(orgId, batch, test.id, before.id, changes);
        changed(orgId, batch, test, false);
        audit(req, batch, {
          action: 'question.update',
          target: { type: 'question', id: before.id },
          before: { ...Object.fromEntries(keys.map((k) => [k, before[k] ?? null])), status: before.status },
          after: { ...Object.fromEntries(keys.map((k) => [k, changes[k as keyof QuestionUpdate] ?? null])), status },
        });
        await batch.commit();
        return { id: before.id, status };
      },
    );

    app.delete(
      '/v1/tests/:id/questions/:questionId',
      { config: admin, schema: { params: questionParams, response: { 200: z.object({ deleted: z.literal(true) }) } } },
      async (req) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const q = await questionOf(orgId, test.id, req.params.questionId);
        const rest = (await data.questions.listQuestions(orgId, test.id)).filter((x) => x.id !== q.id);
        const batch = db.batch();
        data.questions.deleteQuestion(orgId, batch, test.id, q.id);
        // The others keep their relative order and are numbered 1, 2, … again.
        data.questions.setOrder(
          orgId,
          batch,
          test.id,
          rest.map((x) => x.id),
          clock.now(),
        );
        changed(orgId, batch, test, false);
        audit(req, batch, { action: 'question.delete', target: { type: 'question', id: q.id }, before: q });
        await batch.commit();
        return { deleted: true as const };
      },
    );

    // Q-01: the new order is saved at once; the list must name every question of the test exactly once.
    app.put(
      '/v1/tests/:id/questions/order',
      {
        config: admin,
        schema: {
          params: idParams,
          body: questionOrderSchema,
          response: { 200: z.object({ ids: z.array(z.string()) }) },
        },
      },
      async (req) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const current = new Set((await data.questions.listQuestions(orgId, test.id)).map((q) => q.id));
        const ids = req.body.ids;
        if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id)))
          throw new AppError(400, 'VALIDATION', 'List every question of this test once.', { field: 'ids' });
        const batch = db.batch();
        data.questions.setOrder(orgId, batch, test.id, ids, clock.now());
        changed(orgId, batch, test, false);
        audit(req, batch, { action: 'question.reorder', target: { type: 'test', id: test.id }, after: { ids } });
        await batch.commit();
        return { ids };
      },
    );

    // Q-01: questions parsed from a JSON file in the browser, appended in file order and checked like written ones.
    app.post(
      '/v1/tests/:id/questions/import',
      {
        config: admin,
        bodyLimit: 8 * 1024 * 1024,
        schema: { params: idParams, body: questionImportSchema, response: { 201: questionImportedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        const inputs = req.body.questions.map(withoutEmptyOptions);
        for (const q of inputs) refuseForeignRefs(orgId, test, q);
        const list = await data.questions.listQuestions(orgId, test.id);
        const seen: Array<{ prompt: string }> = [...list];
        const last = list.at(-1)?.order ?? 0;
        const now = clock.now();
        const batch = db.batch();
        const ids = inputs.map((q, i) => {
          const status = statusOf(questionProblems(q, seen));
          seen.push(q);
          const input = { ...q, order: last + i + 1, source: { kind: 'json' as const }, status };
          return data.questions.createQuestion(orgId, batch, test.id, input, now);
        });
        changed(orgId, batch, test, true);
        audit(req, batch, {
          action: 'question.import',
          target: { type: 'test', id: test.id },
          after: { count: ids.length, ids },
        });
        await batch.commit();
        return reply.status(201).send({ count: ids.length, ids });
      },
    );

    // A11Y-10: an image for a question of this test, stored before the question is saved and named by its path.
    app.post(
      '/v1/tests/:id/question-images',
      {
        config: admin,
        schema: { params: idParams, body: questionImageUploadSchema, response: { 201: questionImageSavedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const test = await testOf(orgId, req.params.id);
        return reply.status(201).send(await questionImages.save(orgId, test.id, req.body));
      },
    );
  };
}
