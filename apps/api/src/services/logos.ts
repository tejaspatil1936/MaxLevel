import type { LogoUpload } from '@mitaoe/shared';
import type { FirebaseHandles } from '../firebase';
import { AppError } from '../errors';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' } as const;

/** True when the bytes really are the declared image type (file signature, not the name; SEC-06). */
export function matchesSignature(type: LogoUpload['contentType'], bytes: Buffer): boolean {
  if (type === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  return (
    (head.startsWith('<svg') || head.startsWith('<?xml')) &&
    head.includes('<svg') &&
    !/<script/i.test(bytes.toString('utf8'))
  );
}

/** A stored file as a data URL, or null when it is missing. */
export async function readDataUrl(firebase: FirebaseHandles, path: string): Promise<string | null> {
  const file = firebase.bucket.file(path);
  return file
    .download()
    .then(async ([bytes]) => `data:${(await file.getMetadata())[0].contentType};base64,${bytes.toString('base64')}`)
    .catch(() => null);
}

/** Organization logos in Storage (organizations/{orgId}/logo.*), served to the console as data URLs. */
export function logoStore(firebase: FirebaseHandles) {
  const cache = new Map<string, string | null>();
  return {
    async save(orgId: string, logo: LogoUpload): Promise<string> {
      const bytes = Buffer.from(logo.data, 'base64');
      if (!bytes.length || bytes.length > 512 * 1024 || !matchesSignature(logo.contentType, bytes)) {
        throw new AppError(400, 'VALIDATION', 'Choose a PNG, JPEG or SVG image up to 512 KB.', { field: 'logo' });
      }
      const path = `organizations/${orgId}/logo.${EXT[logo.contentType]}`;
      await firebase.bucket.file(path).save(bytes, { contentType: logo.contentType, resumable: false });
      cache.delete(path);
      return path;
    },

    async dataUrl(path: string | null): Promise<string | null> {
      if (!path) return null;
      if (cache.has(path)) return cache.get(path)!;
      const url = await readDataUrl(firebase, path);
      cache.set(path, url);
      return url;
    },
  };
}
export type LogoStore = ReturnType<typeof logoStore>;
