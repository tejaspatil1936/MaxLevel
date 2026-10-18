#!/usr/bin/env node
// Copies MediaPipe's WASM loaders and binaries from the installed @mediapipe/tasks-vision into public/mediapipe/wasm,
// so face detection is served from the web app's own origin (PR-01) at the version the lockfile pins. The model
// (public/mediapipe/models/blaze_face_short_range.tflite) is committed; the WASM files are generated and gitignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mediapipe', 'wasm');
mkdirSync(target, { recursive: true });
// FilesetResolver picks the SIMD build, or the no-SIMD one on browsers without WebAssembly SIMD.
for (const name of ['vision_wasm_internal', 'vision_wasm_nosimd_internal'])
  for (const ext of ['js', 'wasm']) {
    const source = require.resolve(`@mediapipe/tasks-vision/${name}.${ext}`);
    copyFileSync(source, join(target, basename(source)));
  }
