import type { LogoUpload } from '@mitaoe/shared';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

/** Reads a chosen logo as base64 for the create and edit forms; the server checks the file's signature (SEC-06). */
export async function readLogo(file: File): Promise<LogoUpload | null> {
  const type = LOGO_TYPES.find((t) => t === file.type);
  if (!type) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { contentType: type, data: btoa(binary) };
}

/** PUTs a file to a signed upload link the API gave (no sign-in; DATA-09); throws when it is not stored. */
export async function uploadToSignedUrl(
  url: string,
  file: File,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
    ...(signal ? { signal } : {}),
  }).catch(() => null);
  if (!res?.ok) throw new Error('The upload failed.');
}

/** Fetches a file from a signed link the API gave (no sign-in; DATA-09); throws when it fails. */
export async function signedBlob(url: string): Promise<Blob> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) throw new Error('The download failed.');
  return res.blob();
}

/**
 * For an effect: gives `set` a `blob:` URL for `blob` (null without one) and returns the cleanup that revokes it, so
 * the URL lives only while the component shows that blob.
 */
export function showBlob(blob: Blob | null | undefined, set: (url: string | null) => void): () => void {
  if (!blob) {
    set(null);
    return () => undefined;
  }
  const url = URL.createObjectURL(blob);
  set(url);
  return () => URL.revokeObjectURL(url);
}

/** Starts a download of a text file made in the browser (CSV exports). */
export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** CSV cells for the browser's exports: the shared, formula-safe rule the worker's exports use too (SEC-06). */
export { csvField, csvLine } from '@mitaoe/shared';
