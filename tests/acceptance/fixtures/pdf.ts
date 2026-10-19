import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Reads generated PDFs (docs/testids/phase-7.md, "Report files") with pdf.js, the copy the worker already depends on
// (DECISIONS: pdfjs-dist 5.4.624), so the tests add no dependency. Text is compared ignoring all whitespace, so line
// breaks and the spacing between text runs never matter.

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfDocument {
  numPages: number;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }> }>;
  destroy(): Promise<void>;
}

interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported: boolean; disableFontFace: boolean; useSystemFonts: boolean }): {
    promise: Promise<PdfDocument>;
  };
}

let loaded: Promise<PdfJs> | undefined;

function pdfjs(): Promise<PdfJs> {
  if (!loaded) {
    const fromWorker = createRequire(new URL('../../../apps/worker/package.json', import.meta.url));
    const entry = fromWorker.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    loaded = import(pathToFileURL(entry).href) as Promise<PdfJs>;
  }
  return loaded;
}

export interface PdfContent {
  /** The document information dictionary (Title, Producer, Creator, …). */
  info: Record<string, unknown>;
  pages: number;
  /** Every page's text in order, a line break after each line. */
  text: string;
}

/** True when the bytes start like a PDF file. */
export const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

/** Text and document information of a PDF. */
export async function readPdf(bytes: Buffer): Promise<PdfContent> {
  expect(isPdf(bytes), 'the file starts with %PDF-').toBe(true);
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  try {
    const { info } = await doc.getMetadata();
    let text = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      for (const item of content.items) text += (item.str ?? '') + (item.hasEOL ? '\n' : '');
      text += '\n';
    }
    return { info, pages: doc.numPages, text };
  } finally {
    await doc.destroy();
  }
}

/** The text with every whitespace character removed. */
export const compact = (s: string) => s.replace(/\s+/g, '');

/** Whether the PDF's text holds this text (whitespace ignored). */
export const pdfHas = (pdf: PdfContent, s: string) => compact(pdf.text).includes(compact(s));

/** Fails unless the PDF's text holds every one of these texts (whitespace ignored). */
export function expectPdfText(pdf: PdfContent, texts: readonly string[], where = 'the PDF'): void {
  const missing = texts.filter((t) => !pdfHas(pdf, t));
  expect(missing, `texts missing from ${where}; its text was:\n${pdf.text}`).toEqual([]);
}

/** Fails if the PDF's text holds any of these texts (whitespace ignored). */
export function expectPdfWithout(pdf: PdfContent, texts: readonly string[], where = 'the PDF'): void {
  const found = texts.filter((t) => pdfHas(pdf, t));
  expect(found, `texts that must not be in ${where}`).toEqual([]);
}
