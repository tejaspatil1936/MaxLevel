import type { QuestionImageUpload } from '@mitaoe/shared';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors';
import type { FirebaseHandles } from '../firebase';
import { matchesSignature, readDataUrl } from './logos';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' } as const;
const MAX_BYTES = 512 * 1024;
const MAX_CACHED = 500;

/** Where a test's question images live; a question may only name images under its own test's folder. */
export const questionImagePrefix = (orgId: string, testId: string) => `organizations/${orgId}/tests/${testId}/images/`;

/**
 * Question images in Storage (A11Y-10, spec 6.1), checked by file signature like the organization logos (SEC-06) and
 * shown to admins as data URLs. Each upload gets a new path, so a cached URL never goes stale.
 */
export function questionImageStore(firebase: FirebaseHandles) {
  const cache = new Map<string, string | null>();
  return {
    async save(orgId: string, testId: string, image: QuestionImageUpload): Promise<{ path: string; url: string }> {
      const bytes = Buffer.from(image.data, 'base64');
      if (!bytes.length || bytes.length > MAX_BYTES || !matchesSignature(image.contentType, bytes))
        throw new AppError(400, 'VALIDATION', 'Choose a PNG, JPEG or SVG image up to 512 KB.', { field: 'image' });
      const path = `${questionImagePrefix(orgId, testId)}${randomUUID()}.${EXT[image.contentType]}`;
      await firebase.bucket.file(path).save(bytes, { contentType: image.contentType, resumable: false });
      return { path, url: `data:${image.contentType};base64,${bytes.toString('base64')}` };
    },

    /** Data URLs of these stored paths; missing files are left out. */
    async dataUrls(paths: Iterable<string>): Promise<Record<string, string>> {
      const unique = [...new Set(paths)];
      const urls = await Promise.all(
        unique.map(async (p) => {
          if (!cache.has(p)) {
            if (cache.size >= MAX_CACHED) cache.clear();
            cache.set(p, await readDataUrl(firebase, p));
          }
          return [p, cache.get(p)] as const;
        }),
      );
      return Object.fromEntries(urls.filter((e): e is readonly [string, string] => typeof e[1] === 'string'));
    },
  };
}
export type QuestionImageStore = ReturnType<typeof questionImageStore>;
