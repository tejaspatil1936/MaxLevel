import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { RENDER_SCALE, renderPdfPage } from './import-render';
import { hugePagePdf } from './test-support/hostile-files';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.subarray(0, 8).equals(PNG);

/** The red, green and blue of a PNG's centre pixel. */
async function centre(png: Buffer): Promise<number[]> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return [...ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data.slice(0, 3)];
}

/** An A4 page with a line of Helvetica text and a black square filling the page's lower-right quarter. */
async function samplePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText('Question 5: the bar chart below', {
    x: 50,
    y: 780,
    size: 14,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  page.drawRectangle({ x: 297.5, y: 0, width: 297.5, height: 421, color: rgb(0, 0, 0) });
  return doc.save();
}

describe('renderPdfPage', () => {
  it('IMP-03 renders the page as a PNG at twice its PDF size', async () => {
    const page = await renderPdfPage(await samplePage());
    expect(isPng(page.png)).toBe(true);
    const img = await loadImage(page.png);
    expect([img.width, img.height]).toEqual([595 * RENDER_SCALE, 842 * RENDER_SCALE]);
  });

  it('IMP-03 crops a box given as fractions of the page from its top-left corner into a PNG of that area', async () => {
    const page = await renderPdfPage(await samplePage());
    const dark = page.crop({ x: 0.6, y: 0.6, w: 0.3, h: 0.3 });
    const light = page.crop({ x: 0.05, y: 0.6, w: 0.3, h: 0.3 });
    for (const b of [dark, light]) expect(isPng(b)).toBe(true);
    const img = await loadImage(dark);
    expect(img.width).toBe(Math.ceil(0.3 * 595 * RENDER_SCALE));
    expect(img.height).toBe(Math.ceil(0.3 * 842 * RENDER_SCALE));
    // The lower-right quarter is black, the lower-left white.
    expect(await centre(dark)).toEqual([0, 0, 0]);
    expect(await centre(light)).toEqual([255, 255, 255]);
  });

  it('IMP-03 clamps a box that runs off the page', async () => {
    const page = await renderPdfPage(await samplePage());
    const img = await loadImage(page.crop({ x: 0.9, y: 0.95, w: 0.5, h: 0.5 }));
    expect(img.width).toBe(595 * RENDER_SCALE - Math.floor(0.9 * 595 * RENDER_SCALE));
    expect(img.height).toBe(842 * RENDER_SCALE - Math.floor(0.95 * 842 * RENDER_SCALE));
  });

  it('SEC-06 IMP-03 a 14,400-point page renders within a 16-megapixel budget, keeping its shape', async () => {
    const page = await renderPdfPage(await hugePagePdf());
    const img = await loadImage(page.png);
    expect(img.width * img.height).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(img.width).toBe(img.height);
    expect(img.width).toBeGreaterThan(4000);
  });
});
