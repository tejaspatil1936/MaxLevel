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
export const PRINT_TIMEOUT_MS = 60_000;
/** How long closing a timed-out print's context may take before the whole browser is closed instead. */
const CLOSE_TIMEOUT_MS = 5_000;

/** A print that took longer than its timeout; its context was closed and the run counts it as a failure. */
export class PrintTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The report print took longer than ${timeoutMs} ms.`);
    this.name = 'PrintTimeoutError';
  }
}

const after = (ms: number) => new Promise<'timeout'>((resolve) => setTimeout(resolve, ms, 'timeout').unref());

/**
 * One headless Chromium, started on the first print and started again if it dies; each print gets a fresh context
 * that runs no page script (the template has none) and refuses every network request (the page needs none: its font
 * is a data: URL). A print that is not done within `timeoutMs` (the load, the fonts and the PDF together) fails with
 * PrintTimeoutError and its context is closed, so a hung page never holds the worker or the report's lease.
 * `executablePath` (CHROMIUM_PATH) names the browser; without it playwright-core uses its own install
 * (PLAYWRIGHT_BROWSERS_PATH). Chromium's sandbox is off (`--no-sandbox`, DECISIONS 2026-10-19, report print sandbox).
 */
export function chromiumPrinter(opts: { executablePath?: string; timeoutMs?: number } = {}): PdfPrinter {
  const timeoutMs = opts.timeoutMs ?? PRINT_TIMEOUT_MS;
  let browser: Promise<Browser> | null = null;
  const launch = () => {
    if (!browser) {
      const started = chromium.launch({
        headless: true,
        chromiumSandbox: false,
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
  /** Closes the browser; the next print starts another. */
  const closeBrowser = async () => {
    const open = browser;
    browser = null;
    if (open) await (await open.catch(() => null))?.close();
  };

  return {
    async print(html) {
      const context = await (await launch()).newContext({ javaScriptEnabled: false });
      const work = (async () => {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate('document.fonts.ready.then(() => true)');
        return page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
          tagged: true,
          outline: true,
        });
      })();
      // Once the timeout wins, the closed context fails the print still running; that failure is expected.
      work.catch(() => undefined);
      try {
        const done = await Promise.race([work, after(timeoutMs)]);
        if (done === 'timeout') throw new PrintTimeoutError(timeoutMs);
        return done;
      } finally {
        // A context that cannot even close in time means a hung browser: close it, the next print starts another.
        if ((await Promise.race([context.close().catch(() => undefined), after(CLOSE_TIMEOUT_MS)])) === 'timeout')
          await closeBrowser().catch(() => undefined);
      }
    },
    close: closeBrowser,
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
