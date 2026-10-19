import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { Box } from '@mitaoe/shared';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Rendering of PDF pages for imports (IMP-03): each page as a PNG for the review screen's source view, and each figure
// the model located cropped from it as a PNG of its own. pdf.js draws on a @napi-rs/canvas canvas; the standard 14
// fonts come from pdfjs-dist's own font files, so nothing is loaded from the network.

/** 2× the PDF's 72 dpi, so an A4 page is 1190 × 1684 pixels and a cropped figure stays legible. */
export const RENDER_SCALE = 2;

const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = join(pdfjsDir, 'standard_fonts') + '/';

export interface RenderedPage {
  /** The whole page as a PNG. */
  png: Buffer;
  /** Crops `box` (fractions of the page from its top-left corner) out of the page as a PNG. */
  crop(box: Box): Buffer;
}

/** Renders the first page of a PDF (the worker passes the one-page PDF of the page it is reading). */
export async function renderPdfPage(pdf: Uint8Array): Promise<RenderedPage> {
  // pdf.js takes ownership of the bytes it is given, so it gets a copy.
  const task = getDocument({
    data: Uint8Array.from(pdf),
    standardFontDataUrl,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // @napi-rs/canvas stands in for the DOM canvas pdf.js was typed against.
    type Params = Parameters<typeof page.render>[0];
    await page.render({
      canvas: canvas as unknown as Params['canvas'],
      canvasContext: ctx as unknown as NonNullable<Params['canvasContext']>,
      viewport,
    }).promise;
    page.cleanup();
    return { png: canvas.toBuffer('image/png'), crop: (box) => cropCanvas(canvas, box) };
  } finally {
    await doc.destroy();
  }
}

/** The pixels of `box` within the canvas, at least 1 × 1, clamped to the page. */
function cropCanvas(page: Canvas, box: Box): Buffer {
  const x = Math.min(Math.max(Math.floor(box.x * page.width), 0), page.width - 1);
  const y = Math.min(Math.max(Math.floor(box.y * page.height), 0), page.height - 1);
  const w = Math.max(1, Math.min(Math.ceil(box.w * page.width), page.width - x));
  const h = Math.max(1, Math.min(Math.ceil(box.h * page.height), page.height - y));
  const out = createCanvas(w, h);
  out.getContext('2d').drawImage(page, x, y, w, h, 0, 0, w, h);
  return out.toBuffer('image/png');
}
