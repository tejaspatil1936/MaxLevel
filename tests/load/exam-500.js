/* global __ENV, __VU, open */
// PERF-07 (spec 12.2, 12.4): 500 students sit one exam against staging. Each one bootstraps their session, starts
// within the first 2 minutes, saves an answer every 20 to 40 seconds, reports an occasional event and submits at the
// deadline. Every threshold below is a 12.2 target. Run it before the first real exam and after any change to the
// exam path (docs/MANUAL_CHECKS.md); never against production.
//
//   k6 run -e API_URL=https://api.staging.example -e TEST_ID=<published test> -e TOKENS=tokens.json \
//     tests/load/exam-500.js
//
// TOKENS is a JSON array of Firebase ID tokens of 500 registered, eligible staging students (one per virtual user);
// the test must be live for the whole run. This scenario is not part of the automated suites: the emulators say
// nothing about the 12.2 latency targets.
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

const API = __ENV.API_URL;
const TEST_ID = __ENV.TEST_ID;
const STUDENTS = Number(__ENV.STUDENTS || 500);
const tokens = JSON.parse(open(__ENV.TOKENS || 'tokens.json'));
const startErrors = new Rate('start_errors');

export const options = {
  scenarios: {
    exam: {
      executor: 'per-vu-iterations',
      vus: STUDENTS,
      iterations: 1,
      maxDuration: __ENV.MAX_DURATION || '90m',
    },
  },
  thresholds: {
    'http_req_duration{route:answers}': ['p(95)<120'],
    'http_req_duration{route:start}': ['p(95)<600'],
    start_errors: ['rate<0.001'],
    'http_req_failed{route:answers}': ['rate<0.001'],
  },
};

const json = (token, extra = {}) => ({
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
});
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export default function exam() {
  const token = tokens[(__VU - 1) % tokens.length];
  // Starts spread over the first 2 minutes (the 12.2 burst: 500 starts in 2 minutes).
  sleep(Math.random() * 120);
  http.post(`${API}/v1/session/bootstrap`, '{}', { ...json(token), tags: { route: 'bootstrap' } });
  http.get(`${API}/v1/student/dashboard`, { ...json(token), tags: { route: 'dashboard' } });

  const start = http.post(`${API}/v1/attempts`, JSON.stringify({ testId: TEST_ID }), {
    ...json(token, { 'Idempotency-Key': uuid() }),
    tags: { route: 'start' },
  });
  const started = check(start, { 'attempt started': (r) => r.status === 200 || r.status === 201 });
  startErrors.add(!started);
  if (!started) return;
  const payload = start.json();
  const attemptId = payload.attempt.id;
  const questions = payload.questions;
  const clockOffsetMs = Number(payload.serverTime) - Date.now();

  let seq = 1;
  while (Date.now() + clockOffsetMs < payload.attempt.deadlineAt - 30_000) {
    sleep(20 + Math.random() * 20);
    const q = questions[Math.floor(Math.random() * questions.length)];
    const option = q.options[Math.floor(Math.random() * q.options.length)];
    const body = {
      answers: [{ questionId: q.id, optionId: option.id, seq: seq++, clientTs: Date.now() + clockOffsetMs }],
      backlog: 0,
      clockOffsetMs,
    };
    const saved = http.put(`${API}/v1/attempts/${attemptId}/answers`, JSON.stringify(body), {
      ...json(token),
      tags: { route: 'answers' },
    });
    check(saved, { 'answer saved': (r) => r.status === 200 });
    // An occasional proctoring event (a few per minute across all students).
    if (Math.random() < 0.02) {
      http.post(
        `${API}/v1/attempts/${attemptId}/events`,
        JSON.stringify({ type: 'window_blur', clientTs: Date.now() + clockOffsetMs, details: {} }),
        { ...json(token), tags: { route: 'events' } },
      );
    }
  }

  // Submission at the deadline, as the exam screen does at zero.
  const wait = (payload.attempt.deadlineAt - (Date.now() + clockOffsetMs)) / 1000;
  if (wait > 0) sleep(wait);
  const submit = http.post(`${API}/v1/attempts/${attemptId}/submit`, JSON.stringify({ reason: 'time_up' }), {
    ...json(token, { 'Idempotency-Key': uuid() }),
    tags: { route: 'submit' },
  });
  check(submit, { submitted: (r) => r.status === 200 });
}
