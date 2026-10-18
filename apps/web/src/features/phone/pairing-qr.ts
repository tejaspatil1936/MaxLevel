import { encode } from 'uqr';

/**
 * The QR code of a pairing link (PR-13) as one SVG path in module units: a 1 × 1 square per dark module, with the
 * standard 4-module quiet zone so phone cameras find it. Medium error correction keeps it readable off a screen.
 */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { ecc: 'M', border: 4 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size, d };
}
