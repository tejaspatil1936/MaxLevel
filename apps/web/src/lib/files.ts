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
