import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright-core';

// Prints the report page to PDF with headless Chromium (EXP-06; docs/testids/phase-7.md "Report files"), through
// playwright-core (DECISIONS 2026-10-19): A4, backgrounds on, no running header or footer (displayHeaderFooter off),
// and the file is stored as Chromium wrote it, so its Producer stays `Skia/PDF …` and its Title is the page's title.

export interface PdfPrinter {
  /** The PDF of a complete HTML page; it loads nothing from the network. */
  print(html: string): Promise<Buffer>;
  /** Closes the browser (worker shutdown). */
  close(): Promise<void>;
}

/** How long one page may take to load and print before the run fails. */
const PRINT_TIMEOUT_MS = 60_000;

/**
 * One headless Chromium, started on the first print and started again if it dies; each print gets a fresh context
 * that refuses every network request (the page needs none: its font is a data: URL). `executablePath`
 * (CHROMIUM_PATH) names the browser; without it playwright-core uses its own install (PLAYWRIGHT_BROWSERS_PATH).
 */
export function chromiumPrinter(opts: { executablePath?: string } = {}): PdfPrinter {
  let browser: Promise<Browser> | null = null;
  const launch = () => {
    if (!browser) {
      const started = chromium.launch({
        headless: true,
        timeout: PRINT_TIMEOUT_MS,
        ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
      });
      browser = started;
      started.then(
        (b) => b.on('disconnected', () => browser === started && (browser = null)),
        () => browser === started && (browser = null),
      );
    }
    return browser;
  };

  return {
    async print(html) {
      const context = await (await launch()).newContext();
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(PRINT_TIMEOUT_MS);
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate('document.fonts.ready.then(() => true)');
        return await page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
        });
      } finally {
        await context.close();
      }
    },
    async close() {
      const open = browser;
      browser = null;
      if (open) await (await open.catch(() => null))?.close();
    },
  };
}

const FONT = '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2';

/** Atkinson Hyperlegible Next (the UI's font, spec 13) as a data: URL for the page, or undefined when not installed. */
export async function reportFontUrl(): Promise<string | undefined> {
  try {
    const path = createRequire(import.meta.url).resolve(FONT);
    return `data:font/woff2;base64,${(await readFile(path)).toString('base64')}`;
  } catch {
    return undefined;
  }
}
