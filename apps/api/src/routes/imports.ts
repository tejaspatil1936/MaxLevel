import {
  docIdSchema,
  IMPORT_MAX_BYTES,
  IMPORT_MESSAGES,
  IMPORT_UPLOAD_TTL_MS,
  importCreatedSchema,
  importCreateSchema,
  importFilePath,
  importFormatOf,
  importJobViewSchema,
  importListQuerySchema,
  importListSchema,
  importPageLinkSchema,
  importPagePath,
  importPartTextSchema,
  importRetryTask,
  importStartedSchema,
  importTask,
  isAiFormat,
  monthKey,
  QUEUED_STALE_MS,
  signatureMatches,
  type ImportError,
  type ImportFormat,
  type ImportJobView,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ImportJobRecord } from '../data/imports';
import { AppError, notFound } from '../errors';
import { ORG_ID } from '../plugins/auth';
import { pendingFlags } from '../services/import-drafts';
import { importPageLinks, importSources, importUploadLinks } from '../services/import-uploads';
import type { ApiContext } from './context';
import { originOf } from './exports';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: docIdSchema });
const linkQuery = z.object({
  org: z.string().regex(ORG_ID),
  expires: z.coerce.number().int(),
  sig: z.string().max(128),
});
const ok = z.object({ ok: z.literal(true) });
const pageParams = idParams.extend({ page: z.coerce.number().int().min(1).max(1000) });
/** A part number, or a template sheet's row number (up to Excel's last row). */
const partParams = idParams.extend({ part: z.coerce.number().int().min(1).max(1_048_576) });
/** How a kept source page is stored, in the order the route looks for it. */
const PAGE_FILES = [
  { ext: 'png', contentType: 'image/png' },
  { ext: 'pdf', contentType: 'application/pdf' },
] as const;

/** A refusal the job keeps as its `error` (not retryable), with the HTTP status the request gets. */
type Refusal = { status: number; error: ImportError; details: Record<string, unknown> };
const refusal = (status: number, code: string, message: string, details: Record<string, unknown> = {}): Refusal => ({
  status,
  error: { code, message, retryable: false },
  details,
});
const refuse = (r: Refusal) => new AppError(r.status, r.error.code, r.error.message, r.details);

/**
 * Question import jobs (spec 6.2; docs/testids/phase-6.md). `POST /v1/imports` stores the job awaiting its upload and
 * answers a signed upload link; the browser PUTs the file to that link, which stores it in Storage (DATA-09); `start`
 * checks the stored object's size and signature (SEC-06) and the AI allowance (IMP-08) and queues `/tasks/import`.
 * The API never parses a file and never waits on the worker (REL-06).
 */
export function importRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, queue, entitlements, questionImages } = ctx;
  const db = ctx.firebase.db;
  const sources = importSources(ctx.firebase);
  const secret = ctx.config.exportLinkSecret;
  const signer = secret ? importUploadLinks(secret, clock) : null;
  const pageSigner = secret ? importPageLinks(secret, clock) : null;
  const pageLinks = () => {
    if (!pageSigner) throw new AppError(503, 'IMPORTS_UNAVAILABLE', 'Imports are not available right now.');
    return pageSigner;
  };
  /** Production without the link secret signs nothing, so no file can be uploaded (OWNER_SETUP 0.4). */
  const links = () => {
    if (!signer) throw new AppError(503, 'IMPORTS_UNAVAILABLE', 'Imports are not available right now.');
    return signer;
  };

  /** For an AI format: the feature must be on (FF-02) and the month's AI imports below the limit (IMP-08). */
  async function aiRefusal(orgId: string, format: ImportFormat): Promise<Refusal | null> {
    if (!isAiFormat(format)) return null;
    const e = await entitlements.get(orgId);
    if (!e) throw notFound('Organization');
    if (!e.features.ai_question_import)
      return refusal(403, 'FEATURE_DISABLED', IMPORT_MESSAGES.aiOff, { feature: 'ai_question_import' });
    const max = e.limits.ai_imports_per_month;
    const { aiImports } = await data.usage.getUsage(orgId, monthKey(clock.now(), e.timezone));
    if (aiImports >= max)
      return refusal(409, 'LIMIT_REACHED', IMPORT_MESSAGES.limitReached(max), { limit: 'ai_imports_per_month', max });
    return null;
  }

  /** The checks `start` runs on the stored object, in order: present, size, signature, AI allowance. */
  async function startRefusal(orgId: string, job: ImportJobRecord): Promise<Refusal | 'missing' | null> {
    const size = await sources.size(job.filePath);
    if (size === null) return 'missing';
    if (size > IMPORT_MAX_BYTES) return refusal(400, 'FILE_TOO_LARGE', IMPORT_MESSAGES.tooLarge);
    if (!signatureMatches(job.format, await sources.head(job.filePath)))
      return refusal(400, 'FILE_SIGNATURE_MISMATCH', IMPORT_MESSAGES.mismatch(job.format));
    return aiRefusal(orgId, job.format);
  }

  return async (app) => {
    app.post(
      '/v1/imports',
      {
        config: { ...admin, idempotent: true },
        schema: { body: importCreateSchema, response: { 201: importCreatedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const { testId, filename, contentType, sizeBytes } = req.body;
        const format = importFormatOf(filename);
        if (!format) throw new AppError(400, 'UNSUPPORTED_FORMAT', IMPORT_MESSAGES.unsupported);
        if (sizeBytes > IMPORT_MAX_BYTES) throw new AppError(400, 'FILE_TOO_LARGE', IMPORT_MESSAGES.tooLarge);
        links();
        if (!(await data.tests.getTest(orgId, testId))) throw notFound('Test');
        const refused = await aiRefusal(orgId, format);
        if (refused) throw refuse(refused);

        const id = data.imports.newImportId(orgId);
        const createdAt = clock.now();
        const batch = db.batch();
        data.imports.addImport(orgId, batch, {
          id,
          testId,
          filename,
          format,
          contentType,
          sizeBytes,
          filePath: importFilePath(orgId, id, format),
          status: 'awaiting_upload',
          progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
          createdBy: req.user!.uid,
          createdAt,
        });
        audit(req, batch, {
          action: 'import.create',
          target: { type: 'importJob', id },
          after: { testId, filename, format },
        });
        await batch.commit();
        const uploadExpiresAt = createdAt + IMPORT_UPLOAD_TTL_MS;
        return reply.status(201).send({
          id,
          status: 'awaiting_upload' as const,
          uploadUrl: links().url(originOf(req), orgId, id, uploadExpiresAt),
          uploadExpiresAt,
        });
      },
    );

    // The signed upload link (no sign-in): raw bytes of any type, at most 25 MB, only while the job awaits them.
    await app.register(async (upload) => {
      upload.removeAllContentTypeParsers();
      upload.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) =>
        done(null, body),
      );
      upload.withTypeProvider<ZodTypeProvider>().put(
        '/v1/imports/:id/upload',
        {
          bodyLimit: IMPORT_MAX_BYTES,
          config: { access: 'public' as const },
          schema: {
            params: idParams,
            querystring: linkQuery,
            body: z.custom<Buffer>((b) => Buffer.isBuffer(b)),
            response: { 200: ok },
          },
          // The link is checked before the body is read (onRequest runs before parsing), so a forged or expired
          // link costs no upload of up to 25 MB.
          onRequest: async (req) => {
            const params = idParams.safeParse(req.params);
            const query = linkQuery.safeParse(req.query);
            const verdict = params.success && query.success ? links().verify(params.data.id, query.data) : 'invalid';
            if (verdict === 'expired')
              throw new AppError(403, 'LINK_EXPIRED', 'This upload link has expired. Start the import again.');
            if (verdict !== 'ok') throw new AppError(403, 'LINK_INVALID', 'This upload link is not valid.');
          },
        },
        async (req) => {
          const job = await data.imports.getImport(req.query.org, req.params.id);
          if (!job) throw notFound('Import');
          if (job.status !== 'awaiting_upload')
            throw new AppError(409, 'IMPORT_STARTED', 'This import has started; its file can no longer change.');
          if (req.body.length > IMPORT_MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', IMPORT_MESSAGES.tooLarge);
          await sources.save(job.filePath, req.body, job.contentType);
          return { ok: true as const };
        },
      );
    });

    app.post(
      '/v1/imports/:id/start',
      {
        config: admin,
        schema: { params: idParams, body: z.object({}).strict(), response: { 202: importStartedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const job = await data.imports.getImport(orgId, req.params.id);
        if (!job) throw notFound('Import');
        if (job.status !== 'awaiting_upload') return reply.status(202).send({ id: job.id, status: job.status });
        const refused = await startRefusal(orgId, job);
        if (refused === 'missing') throw new AppError(409, 'UPLOAD_MISSING', IMPORT_MESSAGES.uploadMissing);
        if (refused) {
          await data.imports.leaveAwaitingUpload(orgId, job.id, clock.now(), {
            status: 'failed',
            error: refused.error,
          });
          throw refuse(refused);
        }
        const moved = await data.imports.leaveAwaitingUpload(orgId, job.id, clock.now(), { status: 'queued' });
        if (!moved) throw notFound('Import');
        // The job is queued: a failed enqueue is logged, and reading the job a minute later queues it (REL-04).
        if (moved.changed)
          await queue
            .enqueue(importTask(orgId, job.id))
            .catch((err: unknown) => req.log.error({ err, jobId: job.id }, 'import.enqueue_failed'));
        return reply.status(202).send({ id: job.id, status: moved.status });
      },
    );

    app.get(
      '/v1/imports',
      { config: admin, schema: { querystring: importListQuerySchema, response: { 200: importListSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        if (!(await data.tests.getTest(orgId, req.query.testId))) throw notFound('Test');
        const jobs = await data.imports.listImports(orgId, req.query.testId);
        return {
          items: jobs.map((j) => ({
            id: j.id,
            filename: j.filename,
            format: j.format,
            status: j.status,
            pendingCount: j.pendingCount,
            createdAt: j.createdAt,
          })),
        };
      },
    );

    app.get(
      '/v1/imports/:id',
      { config: admin, schema: { params: idParams, response: { 200: importJobViewSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const job = await data.imports.getImport(orgId, req.params.id);
        if (!job) throw notFound('Import');
        // REL-04: still queued a minute after it was queued, its task was lost: queue a run named for that time.
        if (job.status === 'queued' && job.queuedAt !== undefined && job.queuedAt < clock.now() - QUEUED_STALE_MS)
          await queue
            .enqueue(importRetryTask(orgId, job.id, `requeue-${job.queuedAt}`))
            .catch((err: unknown) => req.log.warn({ err, jobId: job.id }, 'import.requeue_failed'));
        let drafts = job.status === 'ready' ? await data.imports.listDrafts(orgId, job.id) : [];
        if (job.status === 'ready') {
          const testQuestions = await data.questions.listQuestions(orgId, job.testId);
          const flags = pendingFlags(drafts, testQuestions);
          drafts = drafts.map((d) =>
            d.status === 'pending' && flags.has(d.id) ? { ...d, flags: flags.get(d.id)! } : d,
          );
        }
        const view: ImportJobView = {
          id: job.id,
          testId: job.testId,
          filename: job.filename,
          format: job.format,
          status: job.status,
          progress: job.progress,
          createdAt: job.createdAt,
          drafts,
          // Once ready, the admin sees each draft's figures as data URLs, as the question editor shows images.
          ...(job.status === 'ready'
            ? { imageUrls: await questionImages.dataUrls(drafts.flatMap((d) => d.images.map((i) => i.path))) }
            : {}),
          ...(job.error ? { error: job.error } : {}),
          ...(job.retryAt !== undefined ? { retryAt: job.retryAt } : {}),
          ...(job.provider ? { provider: job.provider } : {}),
          ...(job.model ? { model: job.model } : {}),
          ...(job.tokens ? { tokens: job.tokens } : {}),
          ...(job.costEstimate !== undefined ? { costEstimate: job.costEstimate } : {}),
        };
        return view;
      },
    );

    // REL-06: an admin's retry of a job that failed retryably; pages done stay done and the import is not counted again.
    app.post(
      '/v1/imports/:id/retry',
      {
        config: admin,
        schema: { params: idParams, body: z.object({}).strict(), response: { 202: importStartedSchema } },
      },
      async (req, reply) => {
        const orgId = req.orgId!;
        const now = clock.now();
        const outcome = await db.runTransaction(async (tx) => {
          const job = await data.imports.readImport(orgId, tx, req.params.id);
          if (!job) return null;
          if (job.status !== 'failed' || !job.error?.retryable) return 'refused' as const;
          data.imports.requeue(orgId, tx, job.id, now);
          audit(req, tx, { action: 'import.retry', target: { type: 'importJob', id: job.id } });
          return 'queued' as const;
        });
        if (!outcome) throw notFound('Import');
        if (outcome === 'refused')
          throw new AppError(409, 'IMPORT_NOT_RETRYABLE', 'This import has not failed in a way that can be retried.');
        await queue
          .enqueue(importRetryTask(orgId, req.params.id, `manual-${now}`))
          .catch((err: unknown) => req.log.error({ err, jobId: req.params.id }, 'import.enqueue_failed'));
        return reply.status(202).send({ id: req.params.id, status: 'queued' as const });
      },
    );

    // IMP-03: a signed link to a source page of a PDF job, as the worker kept it (a PNG, or the one-page PDF).
    app.get(
      '/v1/imports/:id/pages/:page',
      { config: admin, schema: { params: pageParams, response: { 200: importPageLinkSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const job = await data.imports.getImport(orgId, req.params.id);
        if (!job) throw notFound('Import');
        const { page } = req.params;
        if (job.format !== 'pdf' || page > job.progress.pagesTotal) throw notFound('Page');
        for (const f of PAGE_FILES)
          if ((await sources.size(importPagePath(orgId, job.id, page, f.ext))) !== null)
            return { ...pageLinks().issue(originOf(req), orgId, job.id, page), contentType: f.contentType };
        throw notFound('Page');
      },
    );

    // IMP-11: the text of a TXT, MD or sheet job's source part (a template sheet's row), as the worker kept it.
    app.get(
      '/v1/imports/:id/parts/:part',
      { config: admin, schema: { params: partParams, response: { 200: importPartTextSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const job = await data.imports.getImport(orgId, req.params.id);
        if (!job) throw notFound('Import');
        if (job.format === 'pdf' || job.format === 'json') throw notFound('Part');
        const part = await data.imports.getPartText(orgId, job.id, req.params.part);
        if (!part) throw notFound('Part');
        return part;
      },
    );

    app.get(
      '/v1/imports/:id/pages/:page/file',
      {
        config: { access: 'public' as const },
        schema: { params: pageParams, querystring: linkQuery, response: { 200: z.custom<Buffer>() } },
      },
      async (req, reply) => {
        const { id, page } = req.params;
        const verdict = pageLinks().verify(id, page, req.query);
        if (verdict === 'expired')
          throw new AppError(403, 'LINK_EXPIRED', 'This page link has expired. Open the page again.');
        if (verdict !== 'ok') throw new AppError(403, 'LINK_INVALID', 'This page link is not valid.');
        for (const f of PAGE_FILES) {
          const body = await sources.read(importPagePath(req.query.org, id, page, f.ext));
          if (body)
            return reply.header('content-type', f.contentType).header('cache-control', 'private, no-store').send(body);
        }
        throw notFound('Page');
      },
    );
  };
}
