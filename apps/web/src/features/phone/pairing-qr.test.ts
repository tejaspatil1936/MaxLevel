import jsQR from 'jsqr';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PairingQr } from './PairingQr';

/** Paints the rendered SVG's module squares into RGBA pixels (black on white), `scale` pixels per module. */
function rasterize(markup: string, scale = 4): { data: Uint8ClampedArray; width: number } {
  const size = Number(/viewBox="0 0 (\d+) \1"/.exec(markup)?.[1]);
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [, x, y] of markup.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const i = ((Number(y) * scale + dy) * width + Number(x) * scale + dx) * 4;
        data.fill(0, i, i + 3);
      }
  }
  return { data, width };
}

describe('PairingQr', () => {
  it('PR-13 US-ST-04 the rendered QR code decodes to exactly the pairing link', () => {
    const url = 'http://localhost:3000/pair/?token=org-a.Q2hlY2sgdGhlIGNvZGUgZGVjb2RlcyBiYWNrIHRvIHRoZQ';
    const markup = renderToStaticMarkup(createElement(PairingQr, { url }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="QR code to pair your phone"');
    const { data, width } = rasterize(markup);
    expect(jsQR(data, width, width)?.data).toBe(url);
  });
});
