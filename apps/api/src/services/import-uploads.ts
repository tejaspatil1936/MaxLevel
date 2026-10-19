import { createHmac, timingSafeEqual } from 'node:crypto';
import { IMPORT_PAGE_LINK_TTL_MS, IMPORT_SIGNATURE_BYTES, type Clock } from '@mitaoe/shared';
import type { FirebaseHandles } from '../firebase';

/** What an upload link carries besides the job ID: the organization, the expiry and the signature. */
export interface UploadLinkQuery {
  org: string;
  expires: number;
  sig: string;
}

/**
 * Signed upload links for import source files (IMP-01, DATA-09). Storage denies every client, so the browser PUTs the
 * file to `/v1/imports/{id}/upload` on the API with a link it signed: an HMAC-SHA256 over the purpose, the
 * organization, the job and the expiry (15 minutes after the job was created, on the Clock). No sign-in is needed.
 */
export function importUploadLinks(secret: string, clock: Clock) {
  const sign = (orgId: string, jobId: string, expires: number) =>
    createHmac('sha256', secret).update(`import-upload\n${orgId}\n${jobId}\n${expires}`).digest('hex');

  return {
    url(origin: string, orgId: string, jobId: string, expiresAt: number): string {
      const q = new URLSearchParams({ org: orgId, expires: String(expiresAt), sig: sign(orgId, jobId, expiresAt) });
      return `${origin}/v1/imports/${encodeURIComponent(jobId)}/upload?${q}`;
    },

    /** `ok` for a link this API signed that has not expired on the Clock. */
    verify(jobId: string, q: UploadLinkQuery): 'ok' | 'expired' | 'invalid' {
      const want = Buffer.from(sign(q.org, jobId, q.expires), 'hex');
      const got = Buffer.from(/^[0-9a-f]{64}$/.test(q.sig) ? q.sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return 'invalid';
      return clock.now() < q.expires ? 'ok' : 'expired';
    },
  };
}

/**
 * Signed links to a PDF job's source pages (IMP-03, DATA-09), for the review screen: `GET
 * /v1/imports/{id}/pages/{page}/file` serves the page the worker kept to whoever holds a link the API signed, an
 * HMAC-SHA256 over the purpose, the organization, the job, the page and the expiry (15 minutes after it was issued).
 */
export function importPageLinks(secret: string, clock: Clock) {
  const sign = (orgId: string, jobId: string, page: number, expires: number) =>
    createHmac('sha256', secret).update(`import-page\n${orgId}\n${jobId}\n${page}\n${expires}`).digest('hex');

  return {
    issue(origin: string, orgId: string, jobId: string, page: number): { url: string; expiresAt: number } {
      const expiresAt = clock.now() + IMPORT_PAGE_LINK_TTL_MS;
      const q = new URLSearchParams({
        org: orgId,
        expires: String(expiresAt),
        sig: sign(orgId, jobId, page, expiresAt),
      });
      return { url: `${origin}/v1/imports/${encodeURIComponent(jobId)}/pages/${page}/file?${q}`, expiresAt };
    },

    verify(jobId: string, page: number, q: UploadLinkQuery): 'ok' | 'expired' | 'invalid' {
      const want = Buffer.from(sign(q.org, jobId, page, q.expires), 'hex');
      const got = Buffer.from(/^[0-9a-f]{64}$/.test(q.sig) ? q.sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return 'invalid';
      return clock.now() < q.expires ? 'ok' : 'expired';
    },
  };
}

/**
 * The stored source file of a job. The API only stores it, reads its size and its first 64 KB for the signature
 * check (SEC-06); it never parses it.
 */
export function importSources(firebase: FirebaseHandles) {
  return {
    async save(path: string, bytes: Buffer, contentType: string): Promise<void> {
      await firebase.bucket.file(path).save(bytes, { contentType, resumable: false });
    },

    /** The stored object's size, or null when nothing was uploaded. */
    async size(path: string): Promise<number | null> {
      const [meta] = await firebase.bucket
        .file(path)
        .getMetadata()
        .catch(() => [null]);
      return meta ? Number(meta.size) : null;
    },

    /** A whole stored object (a source page the worker kept), or null when there is none. */
    async read(path: string): Promise<Buffer | null> {
      const [bytes] = await firebase.bucket
        .file(path)
        .download()
        .catch(() => [null]);
      return bytes;
    },

    async head(path: string): Promise<Buffer> {
      const [bytes] = await firebase.bucket.file(path).download({ start: 0, end: IMPORT_SIGNATURE_BYTES - 1 });
      return bytes;
    },
  };
}
