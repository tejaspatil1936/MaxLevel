import {
  bulkResultSchema,
  buildImportReport,
  importReportSchema,
  pageOf,
  whitelistBulkSchema,
  whitelistEntrySchema,
  whitelistImportSchema,
  whitelistListQuerySchema,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { normalizeEmail } from '../data/keys';
import { pageItems } from '../data/page';
import { AppError } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };

/** Whitelist (WL-01 to WL-05). Files are parsed in the admin's browser; only mapped rows arrive here (DECISIONS Q11). */
export function whitelistRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, entitlements, status } = ctx;
  const db = ctx.firebase.db;

  return async (app) => {
    app.get(
      '/v1/whitelist',
      {
        config: admin,
        schema: { querystring: whitelistListQuerySchema, response: { 200: pageOf(whitelistEntrySchema) } },
      },
      async (req) => {
        const { cursor, limit, status: st, q } = req.query;
        const needle = q?.toLowerCase();
        const all = (await data.whitelist.listWhitelist(req.orgId!))
          .filter(
            (e) =>
              (!st || e.status === st) &&
              (!needle || e.email.includes(needle) || (e.prn ?? '').toLowerCase().includes(needle)),
          )
          .sort((a, b) => a.email.localeCompare(b.email));
        return pageItems(all, cursor, limit);
      },
    );

    // WL-03: preview reports problems before anything is saved; commit saves only the valid, new rows.
    app.post(
      '/v1/whitelist/import',
      { config: admin, schema: { body: whitelistImportSchema, response: { 200: importReportSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const [existing, currentCount, ent] = await Promise.all([
          data.whitelist.existingEmails(orgId),
          data.whitelist.countWhitelist(orgId),
          entitlements.get(orgId),
        ]);
        const { accepted, ...report } = buildImportReport(req.body.rows, existing, {
          maxStudents: ent!.limits.max_students,
          currentCount,
        });
        if (req.body.mode === 'preview') return { ...report, committed: false };
        if (report.overLimit) {
          throw new AppError(
            403,
            'LIMIT_REACHED',
            `This would take the list past the limit of ${report.limit} students.`,
            { limit: 'max_students', value: report.limit },
          );
        }
        if (req.body.source === 'single' && report.existing.length) {
          throw new AppError(409, 'EMAIL_EXISTS', 'This email is already on the whitelist.', { field: 'email' });
        }
        const now = clock.now();
        const single = req.body.source === 'single' && accepted.length === 1;
        // Each entry is two writes (entry and email index); batches stay under Firestore's 500-write limit. The audit
        // entry rides in the last batch, so the log never claims an import that did not finish.
        for (let i = 0; i === 0 || i < accepted.length; i += 200) {
          const batch = db.batch();
          for (const r of accepted.slice(i, i + 200)) {
            data.whitelist.putWhitelistEntry(orgId, batch, {
              email: r.email,
              prn: r.prn ?? null,
              note: r.note ?? null,
              status: 'invited',
              source: req.body.source,
              addedBy: req.user!.uid,
              addedAt: now,
            });
          }
          if (i + 200 >= accepted.length) {
            audit(req, batch, {
              action: single ? 'whitelist.add' : 'whitelist.import',
              target: { type: 'whitelist', id: single ? accepted[0]!.email : 'bulk' },
              after: single
                ? accepted[0]
                : { added: accepted.length, source: req.body.source, skipped: report.total - accepted.length },
            });
          }
          await batch.commit();
        }
        return { ...report, committed: true };
      },
    );

    // WL-05: removing a registered student's entry disables the student and keeps their attempts and results.
    app.post(
      '/v1/whitelist/bulk',
      { config: admin, schema: { body: whitelistBulkSchema, response: { 200: bulkResultSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const { action } = req.body;
        const emails = [...new Set(req.body.emails.map(normalizeEmail))];
        const entries = await data.whitelist.getWhitelistEntries(orgId, emails);
        // Every email must be on this org's list, or nothing changes (another org's entries are 404, ORG-05).
        if (emails.some((e) => !entries.has(e)))
          throw new AppError(404, 'NOT_FOUND', 'Some of these emails are not on the whitelist.');
        const now = clock.now();
        const revoke: string[] = [];
        let updated = 0;
        // Up to three writes per email: 150 emails per batch stays under Firestore's 500-write limit.
        for (let i = 0; i < emails.length; i += 150) {
          const batch = db.batch();
          for (const email of emails.slice(i, i + 150)) {
            const e = entries.get(email)!;
            const student = e.studentId ? await data.students.getStudent(orgId, e.studentId) : null;
            if (action === 'enable') {
              if (e.status !== 'disabled') continue;
              const back = student?.consentAt && student.name ? 'registered' : 'invited';
              data.whitelist.updateWhitelistEntry(orgId, batch, email, { status: back });
              if (student) data.students.updateStudent(orgId, batch, student.id, { status: back, updatedAt: now });
            } else {
              if (action === 'disable' && e.status === 'disabled') continue;
              if (action === 'remove')
                data.whitelist.removeWhitelistEntry(
                  orgId,
                  batch,
                  email,
                  !!(await data.admins.findActiveAdminByEmail(orgId, email)),
                );
              else data.whitelist.updateWhitelistEntry(orgId, batch, email, { status: 'disabled' });
              if (student) {
                data.students.updateStudent(orgId, batch, student.id, { status: 'disabled', updatedAt: now });
                if (student.uid) revoke.push(student.uid);
              }
            }
            updated++;
          }
          if (i + 150 >= emails.length) {
            audit(req, batch, {
              action: `whitelist.${action}`,
              target: { type: 'whitelist', id: emails.length === 1 ? emails[0]! : 'bulk' },
              after: { emails, updated },
            });
          }
          await batch.commit();
        }
        await Promise.all(revoke.map((uid) => ctx.firebase.auth.revokeRefreshTokens(uid)));
        status.invalidate();
        return { updated, skipped: emails.length - updated };
      },
    );
  };
}
