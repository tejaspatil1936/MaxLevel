import { createHmac, timingSafeEqual } from 'node:crypto';
import { EXPORT_LINK_TTL_MS, type Clock } from '@mitaoe/shared';

/** What a download link carries besides the export ID: the organization, the expiry and the signature. */
export interface ExportLinkQuery {
  org: string;
  expires: number;
  sig: string;
}

export type ExportLinkVerdict = 'ok' | 'expired' | 'invalid';

/**
 * Signed download links for export files (EXP-03, DATA-09). Storage denies every client, so the API serves the file
 * at `/v1/exports/{id}/file` to whoever holds a link it signed: an HMAC-SHA256 over the organization, the export and
 * the expiry, which is 15 minutes after the link was issued on the Clock. No sign-in is needed to follow it.
 */
export function exportLinks(secret: string, clock: Clock) {
  const sign = (orgId: string, exportId: string, expires: number) =>
    createHmac('sha256', secret).update(`${orgId}\n${exportId}\n${expires}`).digest('hex');

  return {
    /** A fresh link valid for `EXPORT_LINK_TTL_MS` from now, absolute on `origin` (the API's own origin). */
    issue(origin: string, orgId: string, exportId: string): { url: string; expiresAt: number } {
      const expiresAt = clock.now() + EXPORT_LINK_TTL_MS;
      const q = new URLSearchParams({ org: orgId, expires: String(expiresAt), sig: sign(orgId, exportId, expiresAt) });
      return { url: `${origin}/v1/exports/${encodeURIComponent(exportId)}/file?${q}`, expiresAt };
    },

    /** `ok` for a link this API signed that has not expired on the Clock. */
    verify(exportId: string, q: ExportLinkQuery): ExportLinkVerdict {
      const want = Buffer.from(sign(q.org, exportId, q.expires), 'hex');
      const got = Buffer.from(/^[0-9a-f]{64}$/.test(q.sig) ? q.sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return 'invalid';
      return clock.now() < q.expires ? 'ok' : 'expired';
    },
  };
}
export type ExportLinks = ReturnType<typeof exportLinks>;
