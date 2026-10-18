import { describe, expect, it } from 'vitest';
import {
  FACE_CHECK_INTERVAL_MS,
  initialFaceWatch,
  MULTIPLE_FACES_MS,
  nextFaceWatch,
  NO_FACE_GRACE_MS,
  type FaceWatchState,
} from './face-watch';

/** Runs face counts through the watch, one detection every 500 ms from t = 0; returns the reports with their times. */
function run(counts: number[]) {
  let state: FaceWatchState = initialFaceWatch;
  const reports: Array<{ type: string; at: number; afterMs: number }> = [];
  counts.forEach((faces, i) => {
    const at = i * FACE_CHECK_INTERVAL_MS;
    const next = nextFaceWatch(state, faces, at);
    state = next.state;
    if (next.report) reports.push({ ...next.report, at });
  });
  return reports;
}

const times = (n: number, faces: number) => Array<number>(n).fill(faces);

describe('nextFaceWatch', () => {
  it('PR-01 PR-02 the device checks every 500 ms with a 5 s no-face grace and a 2 s multiple-face limit', () => {
    expect(FACE_CHECK_INTERVAL_MS).toBe(500);
    expect(NO_FACE_GRACE_MS).toBe(5000);
    expect(MULTIPLE_FACES_MS).toBe(2000);
  });

  it('PR-02 one face in view never reports', () => {
    expect(run(times(100, 1))).toEqual([]);
  });

  it('PR-02 no face for exactly 5 seconds is within the grace period', () => {
    // Samples at 0 to 5000 ms: 5000 ms without a face, not more.
    expect(run([...times(11, 0), 1])).toEqual([]);
  });

  it('PR-02 no face for more than 5 seconds reports one no_face', () => {
    expect(run(times(12, 0))).toEqual([{ type: 'no_face', at: 5500, afterMs: 5500 }]);
  });

  it('PR-02 a camera that never sees a face reports exactly one no_face', () => {
    expect(run(times(1000, 0)).map((r) => r.type)).toEqual(['no_face']);
  });

  it('PR-02 the no-face incident ends when a face is seen, and a new absence is a new incident', () => {
    const reports = run([...times(20, 0), 1, ...times(12, 0)]);
    expect(reports.map((r) => r.at)).toEqual([5500, 10_500 + 5500]);
  });

  it('PR-02 a face seen within the grace period starts the count again', () => {
    expect(run([...times(10, 0), 1, ...times(10, 0)])).toEqual([]);
  });

  it('PR-02 more than one face for more than 2 seconds reports multiple_faces once per incident', () => {
    expect(run([...times(5, 2), 1])).toEqual([]);
    expect(run([...times(40, 3), 1, ...times(6, 2)])).toEqual([
      { type: 'multiple_faces', at: 2500, afterMs: 2500 },
      { type: 'multiple_faces', at: 20_500 + 2500, afterMs: 2500 },
    ]);
  });

  it('PR-02 going from no face to two faces ends one incident and starts the other', () => {
    expect(run([...times(4, 0), ...times(6, 2)])).toEqual([{ type: 'multiple_faces', at: 4500, afterMs: 2500 }]);
  });
});
