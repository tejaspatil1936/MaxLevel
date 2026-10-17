#!/usr/bin/env node
// Serves the static export (apps/web/out) on PORT (default 3000) with the same headers as vercel.json, plus the
// local API and emulator origins in the CSP connect-src, so tests exercise the real security headers.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = new URL('../apps/web/out/', import.meta.url).pathname;
const vercel = JSON.parse(readFileSync(new URL('../apps/web/vercel.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT ?? 3000);
const LOCAL = 'http://localhost:4000 http://127.0.0.1:9099 http://127.0.0.1:9000 ws://127.0.0.1:9000';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json',
};
const rules = vercel.headers.map((h) => ({
  re: new RegExp(`^${h.source.replace('(.*)', '(.*)')}$`),
  headers: h.headers,
}));

function headersFor(path) {
  const out = {};
  for (const r of rules) if (r.re.test(path)) for (const { key, value } of r.headers) out[key] = value;
  if (out['Content-Security-Policy']) {
    out['Content-Security-Policy'] = out['Content-Security-Policy'].replace('connect-src ', `connect-src ${LOCAL} `);
  }
  delete out['Strict-Transport-Security']; // plain HTTP locally
  return out;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = normalize(decodeURIComponent(url.pathname));
  let file = join(root, path);
  if (!file.startsWith(root)) return res.writeHead(400).end();
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) return res.writeHead(308, { Location: `${path}/${url.search}` }).end();
    file = join(file, 'index.html');
  }
  const found = existsSync(file) && statSync(file).isFile();
  const target = found ? file : join(root, '404.html');
  res.writeHead(found ? 200 : 404, {
    'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
    ...headersFor(path),
  });
  createReadStream(target).pipe(res);
}).listen(port, () => console.log(`web on http://localhost:${port}`));
