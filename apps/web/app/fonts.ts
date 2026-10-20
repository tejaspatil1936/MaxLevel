import localFont from 'next/font/local';

// Self-hosted through next/font (13.4): files come from the @fontsource-variable packages.
export const display = localFont({
  src: '../node_modules/@fontsource-variable/big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2',
  variable: '--font-display-face',
  weight: '700 800',
  display: 'swap',
});

export const text = localFont({
  src: '../node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  variable: '--font-text-face',
  weight: '400 700',
  display: 'swap',
});

export const code = localFont({
  src: '../node_modules/@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2',
  variable: '--font-code-face',
  weight: '400 700',
  display: 'swap',
});
