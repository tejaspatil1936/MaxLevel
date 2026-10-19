import { importFiguresFolder, importPagePath, type DraftInput } from '@mitaoe/shared';
import type { FileStore } from '../firebase';
import { draftId } from '../import-data';
import { renderPdfPage } from '../import-render';
import type { ImportLog } from './import';

/**
 * After a PDF page was read (IMP-03): keeps the page for the review screen, rendered as a PNG, and crops each figure
 * the model located on it into a PNG under the job's `figures/` folder, attached to its draft with the model's alt
 * text (A11Y-10). Every path is the organization's and the job's own (ORG-03). A page that cannot be rendered is kept
 * as its one-page PDF and its figures are left out, so their drafts are flagged MISSING_FIGURE.
 */
export async function storePdfPage(
  deps: { files: FileStore; log?: ImportLog },
  at: { orgId: string; jobId: string; page: number },
  pdf: Uint8Array,
  drafts: DraftInput[],
): Promise<DraftInput[]> {
  const { orgId, jobId, page } = at;
  let rendered: Awaited<ReturnType<typeof renderPdfPage>> | null = null;
  try {
    rendered = await renderPdfPage(pdf);
  } catch (err) {
    deps.log?.info({ event: 'import.page.unrendered', orgId, jobId, page, err: String(err) }, 'import.page.unrendered');
  }
  if (!rendered) {
    await deps.files.save(importPagePath(orgId, jobId, page, 'pdf'), Buffer.from(pdf), 'application/pdf');
    return drafts.map(({ figure, ...d }) => (figure ? { ...d, refersToFigure: true } : d));
  }
  await deps.files.save(importPagePath(orgId, jobId, page, 'png'), rendered.png, 'image/png');
  const out: DraftInput[] = [];
  for (const { figure, ...d } of drafts) {
    if (!figure) {
      out.push(d);
      continue;
    }
    const path = `${importFiguresFolder(orgId, jobId)}${draftId(d.order)}-1.png`;
    await deps.files.save(path, rendered.crop(figure.box), 'image/png');
    out.push({ ...d, refersToFigure: true, images: [...d.images, { path, alt: figure.alt }] });
  }
  return out;
}
