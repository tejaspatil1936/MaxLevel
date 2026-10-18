import { expect, type Locator, type Page } from '@playwright/test';

// The phone pairing page, /pair/?token=<token> (docs/testids/phase-3.md, "Phone pairing page").

export class PhonePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly connection: Locator;
  readonly help: Locator;
  readonly video: Locator;
  readonly refusal: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = page.getByRole('heading', { level: 1, name: 'Phone camera', exact: true });
    this.connection = page.getByRole('status').filter({ hasText: /^\s*(Connecting|Connected|Reconnecting)\s*$/ });
    this.help = page.getByRole('heading', { level: 2, name: 'Position your phone', exact: true });
    this.video = page.locator('video');
    // In main: Next.js keeps its own empty route announcer (role alert) at the end of every page.
    this.refusal = this.main.getByRole('alert');
  }

  /** Opens a pairing link (the text of the laptop's `pairing-link`). */
  async open(link: string): Promise<void> {
    await this.page.goto(link);
    await expect(this.heading).toBeVisible();
  }

  async expectConnected(): Promise<void> {
    await expect(this.connection).toHaveText('Connected', { timeout: 20_000 });
  }

  /** The phone's preview video is playing a live camera stream. */
  async expectCameraPlaying(): Promise<void> {
    await expect(this.video).toBeVisible();
    await expect
      .poll(() =>
        this.video.evaluate((v: HTMLVideoElement) => {
          const stream = v.srcObject as MediaStream | null;
          return (
            !v.paused &&
            v.readyState >= 2 &&
            !!stream &&
            stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled)
          );
        }),
      )
      .toBe(true);
  }
}
