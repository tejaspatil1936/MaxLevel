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
        const now = clock.now();
        // Each entry is two writes (entry and email index); batches stay under Firestore's 500-write limit.
        // The audit entry rides in the last batch, so the log never claims an import that did not finish.
        for (let i = 0; i < accepted.length || i === 0; i += 200) {
          const chunk = accepted.slice(i, i + 200);
          const batch = db.batch();
          for (const r of chunk) {
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
              action: 'whitelist.import',
              target: { type: 'whitelist', id: orgId },
              after: { added: accepted.length, source: req.body.source, skipped: report.total - accepted.length },
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
        const emails = [...new Set(req.body.emails.map(normalizeEmail))];
        const entries = await data.whitelist.getWhitelistEntries(orgId, emails);
        const now = clock.now();
        const revoke: string[] = [];
        const batch = db.batch();
        let updated = 0;
        for (const email of emails) {
          const e = entries.get(email);
          if (!e) continue;
          const student = e.studentId ? await data.students.getStudent(orgId, e.studentId) : null;
          if (req.body.action === 'enable') {
            if (e.status !== 'disabled') continue;
            const back = student?.consentAt || student?.uid ? 'registered' : 'invited';
            data.whitelist.updateWhitelistEntry(orgId, batch, email, { status: back });
            if (student) data.students.updateStudent(orgId, batch, student.id, { status: back, updatedAt: now });
          } else {
            if (req.body.action === 'disable' && e.status === 'disabled') continue;
            if (req.body.action === 'remove')
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
        audit(req, batch, {
          action: `whitelist.${req.body.action}`,
          target: { type: 'whitelist', id: orgId },
          after: { emails, updated },
        });
        await batch.commit();
        await Promise.all(revoke.map((uid) => ctx.firebase.auth.revokeRefreshTokens(uid)));
        status.invalidate();
        return { updated, skipped: emails.length - updated };
      },
    );
  };
}
