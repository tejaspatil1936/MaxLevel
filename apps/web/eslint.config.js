import { base, react } from '@mitaoe/config/eslint';

// public/mediapipe/wasm is MediaPipe's own generated code, copied in by scripts/copy-mediapipe.mjs.
export default [{ ignores: ['public/mediapipe/**'] }, ...base, ...react];
