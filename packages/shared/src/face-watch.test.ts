import { describe, expect, it } from 'vitest';
import {
  FACE_CHECK_INTERVAL_MS,
  INCIDENT_REPEAT_MS,
  initialFaceWatch,
  MULTIPLE_FACES_MS,
  nextFaceWatch,
  nextPhoneSight,
  NO_FACE_GRACE_MS,
  PHONE_CHECK_INTERVAL_MS,
  type FaceWatchState,
  type PhoneSightState,
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

  it('PR-02 a face that stays out of view is reported again every 30 seconds', () => {
    expect(INCIDENT_REPEAT_MS).toBe(30_000);
    // Samples at 0 to 70 000 ms: the first report after the grace, then one 30 s after each report.
    expect(run(times(141, 0))).toEqual([
      { type: 'no_face', at: 5500, afterMs: 5500 },
      { type: 'no_face', at: 35_500, afterMs: 35_500 },
      { type: 'no_face', at: 65_500, afterMs: 65_500 },
    ]);
  });

  it('PR-02 no second no_face within 30 seconds of the first', () => {
    expect(run(times(71, 0)).map((r) => r.at)).toEqual([5500]);
  });

  it('PR-02 the no-face incident ends when a face is seen, and a new absence is a new incident', () => {
    const reports = run([...times(20, 0), 1, ...times(12, 0)]);
    expect(reports.map((r) => r.at)).toEqual([5500, 10_500 + 5500]);
  });

  it('PR-02 a face seen within the grace period starts the count again', () => {
    expect(run([...times(10, 0), 1, ...times(10, 0)])).toEqual([]);
  });

  it('PR-02 more than one face for more than 2 seconds reports multiple_faces, again every 30 seconds', () => {
    expect(run([...times(5, 2), 1])).toEqual([]);
    expect(run([...times(66, 3)]).map((r) => r.at)).toEqual([2500, 32_500]);
    expect(run([...times(40, 3), 1, ...times(6, 2)])).toEqual([
      { type: 'multiple_faces', at: 2500, afterMs: 2500 },
      { type: 'multiple_faces', at: 20_500 + 2500, afterMs: 2500 },
    ]);
  });

  it('PR-02 going from no face to two faces ends one incident and starts the other', () => {
    expect(run([...times(4, 0), ...times(6, 2)])).toEqual([{ type: 'multiple_faces', at: 4500, afterMs: 2500 }]);
  });
});

/** Runs phone counts through the sighting watch, one check every second from t = 0. */
function sight(counts: number[]) {
  let state: PhoneSightState | null = null;
  const reports: Array<{ at: number; afterMs: number }> = [];
  counts.forEach((phones, i) => {
    const at = i * PHONE_CHECK_INTERVAL_MS;
    const next = nextPhoneSight(state, phones, at);
    state = next.state;
    if (next.report) reports.push({ at, afterMs: next.report.afterMs });
  });
  return reports;
}

describe('nextPhoneSight', () => {
  it('phones are checked every second', () => {
    expect(PHONE_CHECK_INTERVAL_MS).toBe(1000);
  });

  it('no phone never reports', () => {
    expect(sight(times(100, 0))).toEqual([]);
  });

  it('a phone seen in three checks over more than 1.5 seconds reports phone_in_view', () => {
    expect(sight(times(2, 1))).toEqual([]);
    expect(sight(times(3, 1))).toEqual([{ at: 2000, afterMs: 2000 }]);
  });

  it('one or two stray detections are never a strike', () => {
    expect(sight([1, 0, 0, 1, 0, 0, 1, 0, 0, 1])).toEqual([]);
    expect(sight([1, 0, 1, 0, 0, 0])).toEqual([]);
  });

  it('a flickering phone (one missed check at a time) is still one sighting', () => {
    expect(sight([1, 0, 1, 0, 1])).toEqual([{ at: 4000, afterMs: 4000 }]);
  });

  it('a phone missed for two checks in a row starts a new sighting', () => {
    expect(sight([1, 1, 0, 0, 1, 1])).toEqual([]);
  });

  it('a phone that stays in view is reported again every 30 seconds', () => {
    expect(sight(times(63, 1)).map((r) => r.at)).toEqual([2000, 32_000, 62_000]);
  });
});
