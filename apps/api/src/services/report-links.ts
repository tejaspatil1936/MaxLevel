import { createHmac, timingSafeEqual } from 'node:crypto';
import { EXPORT_LINK_TTL_MS, reportFilename, type Clock, type ReportFileKind, type SignedFile } from '@mitaoe/shared';
import type { ExportLinkQuery, ExportLinkVerdict } from './export-links';

/**
 * Signed download links for report files (EXP-06, DATA-09), like export links (EXP-03): Storage denies every client,
 * so the API serves `/v1/reports/{id}/files/{kind}` to whoever holds a link it signed, an HMAC-SHA256 over the
 * purpose, the organization, the report, the file kind and the expiry, 15 minutes after it was issued on the Clock.
 */
export function reportLinks(secret: string, clock: Clock) {
  const sign = (orgId: string, reportId: string, kind: ReportFileKind, expires: number) =>
    createHmac('sha256', secret).update(`report-file\n${orgId}\n${reportId}\n${kind}\n${expires}`).digest('hex');

  return {
    /** A fresh link valid for 15 minutes from now, absolute on `origin` (the API's own origin). */
    issue(origin: string, orgId: string, reportId: string, kind: ReportFileKind): SignedFile {
      const expiresAt = clock.now() + EXPORT_LINK_TTL_MS;
      const q = new URLSearchParams({
        org: orgId,
        expires: String(expiresAt),
        sig: sign(orgId, reportId, kind, expiresAt),
      });
      return {
        url: `${origin}/v1/reports/${encodeURIComponent(reportId)}/files/${kind}?${q}`,
        expiresAt,
        filename: reportFilename(reportId, kind),
      };
    },

    /** `ok` for a link this API signed for this file that has not expired on the Clock. */
    verify(reportId: string, kind: ReportFileKind, q: ExportLinkQuery): ExportLinkVerdict {
      const want = Buffer.from(sign(q.org, reportId, kind, q.expires), 'hex');
      const got = Buffer.from(/^[0-9a-f]{64}$/.test(q.sig) ? q.sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return 'invalid';
      return clock.now() < q.expires ? 'ok' : 'expired';
    },
  };
}
